const pool = require('../db/pool');
const { log } = require('./auth');

async function settlePayment(reference, verifiedPayment) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT
         p.id AS payment_id,
         p.order_id,
         p.amount,
         p.status AS payment_status,
         p.reference,
         o.user_id,
         o.status AS order_status,
         o.promo_code
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.reference = $1
         AND p.gateway = 'paystack'
       FOR UPDATE OF p, o`,
      [reference]
    );

    if (!result.rowCount) {
      throw new Error('Payment reference was not found.');
    }

    const payment = result.rows[0];

    if (
      verifiedPayment.status !== 'success' ||
      verifiedPayment.reference !== payment.reference ||
      Number(verifiedPayment.amount) !== Math.round(Number(payment.amount) * 100) ||
      verifiedPayment.currency !== 'KES'
    ) {
      throw new Error('Paystack payment verification failed.');
    }

    if (payment.payment_status === 'Paid') {
      await client.query('COMMIT');
      return { success: true, already_processed: true, order_id: payment.order_id };
    }

   if (
  payment.payment_status !== 'Pending' ||
  payment.order_status !== 'Awaiting Payment'
) {
  throw new Error('This payment cannot be processed.');
}

    const itemsResult = await client.query(
      `SELECT product_id, quantity, product_name
       FROM order_items
       WHERE order_id = $1`,
      [payment.order_id]
    );

    if (!itemsResult.rowCount) {
  throw new Error('Order contains no products.');
}

    let stockAvailable = true;

    for (const item of itemsResult.rows) {
      const stockResult = await client.query(
        `UPDATE products
         SET stock = stock - $1
         WHERE id = $2 AND stock >= $1`,
        [item.quantity, item.product_id]
      );

      if (!stockResult.rowCount) {
        stockAvailable = false;
        break;
      }
    }

    if (!stockAvailable) {
  await client.query('ROLLBACK');
  await client.query('BEGIN');

  const reviewResult = await client.query(
    `SELECT p.id, p.status, o.status AS order_status
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.reference = $1
     FOR UPDATE OF p, o`,
    [reference]
  );

  if (
    !reviewResult.rowCount ||
    reviewResult.rows[0].status !== 'Pending' ||
    reviewResult.rows[0].order_status !== 'Awaiting Payment'
  ) {
    throw new Error('Payment or order status changed during stock review.');
  }

  await client.query(
    `UPDATE payments
     SET status = 'Paid', paid_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [reviewResult.rows[0].id]
  );

    await client.query(
    `UPDATE orders
     SET status = 'Payment Review'
     WHERE id = $1`,
    [payment.order_id]
  );

  if (payment.promo_code) {
    await client.query(
      `UPDATE promo_codes
       SET usage_count = usage_count + 1
       WHERE code = $1`,
      [payment.promo_code]
    );
  }

  await client.query('COMMIT');

  log(
    payment.user_id,
    'PAYMENT_REVIEW_REQUIRED',
    `Paid order ${payment.order_id} requires stock review`
  );

  return {
    success: true,
    order_review: true,
    order_id: payment.order_id,
    message: 'Payment received. Your order requires stock review.'
  };
}

    await client.query(
      `UPDATE payments
       SET status = 'Paid', paid_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [payment.payment_id]
    );

    await client.query(
      `UPDATE orders
       SET status = 'Placed'
       WHERE id = $1`,
      [payment.order_id]
    );

    if (payment.promo_code) {
      await client.query(
        `UPDATE promo_codes
         SET usage_count = usage_count + 1
         WHERE code = $1`,
        [payment.promo_code]
      );
    }

    // Remove cart items that were completely purchased.
await client.query(
  `DELETE FROM cart_items c
   USING order_items oi
   WHERE oi.order_id = $1
     AND c.user_id = $2
     AND c.product_id = oi.product_id
     AND c.quantity <= oi.quantity`,
  [payment.order_id, payment.user_id]
);

// Reduce quantities for cart items that still have remaining products.
await client.query(
  `UPDATE cart_items c
   SET quantity = c.quantity - oi.quantity
   FROM order_items oi
   WHERE oi.order_id = $1
     AND c.user_id = $2
     AND c.product_id = oi.product_id
     AND c.quantity > oi.quantity`,
  [payment.order_id, payment.user_id]
);

    await client.query('COMMIT');

    try {
      log(payment.user_id, 'PAYMENT_CONFIRMED', `order ${payment.order_id}`);
    } catch (error) {
      console.error('Payment activity log error:', error.message);
    }

    return {
      success: true,
      order_id: payment.order_id,
      status: 'Paid'
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;

  } finally {
    client.release();
  }
}

module.exports = { settlePayment };