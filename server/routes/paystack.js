
const router = require('express').Router();
const crypto = require('crypto');
const pool = require('../db/pool');
const {
  requireLogin,
  requireRole,
  log
} = require('../lib/auth');

const paystack = require('../lib/paystack');
const customer = requireRole('customer');
const { settlePayment } = require('../lib/payment-settlement');

router.post('/initialize', customer, async (req, res) => {
  const method = String(req.body.method || '');
  const payment = req.body.payment || {};
  const addressId = Number.parseInt(req.body.address, 10);
  const slot = String(req.body.slot || '').trim().slice(0, 40);

  if (!Number.isInteger(addressId) || addressId <= 0) {
    return res.status(400).json({ error: 'Please select a delivery address.' });
  }

  if (!slot) {
    return res.status(400).json({ error: 'Please select a delivery slot.' });
  }

  if (!['Mobile Money', 'Credit Card'].includes(method)) {
    return res.status(400).json({ error: 'Choose a supported payment method.' });
  }

  const phone = String(payment.phone || '').trim();
  const provider = String(payment.provider || 'mpesa').toLowerCase();

  if (method === 'Mobile Money') {
    if (!/^\+?[0-9]{9,15}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid mobile money number.' });
    }

    if (!['mpesa', 'atl'].includes(provider)) {
      return res.status(400).json({ error: 'Choose a supported mobile money provider.' });
    }
  }

  const client = await pool.connect();
  let orderId;
  let reference;
  let total;
  let email;

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT email FROM users WHERE id = $1 AND role = $2',
      [req.session.user.id, 'customer']
    );

    if (!userResult.rowCount || !userResult.rows[0].email) {
      throw Object.assign(new Error('Customer email address was not found.'), { status: 400 });
    }

    email = userResult.rows[0].email;

    const addressResult = await client.query(
      `SELECT address, city, country
       FROM customer_addresses
       WHERE id = $1 AND user_id = $2`,
      [addressId, req.session.user.id]
    );

    if (!addressResult.rowCount) {
      throw Object.assign(new Error('Selected delivery address was not found.'), { status: 400 });
    }

    const savedAddress = addressResult.rows[0];

    if (String(savedAddress.country).toLowerCase() !== 'kenya') {
      throw Object.assign(
        new Error("we're only available in Kenya for delivery"),
        { status: 400 }
      );
    }

    const address = `${savedAddress.address}, ${savedAddress.city}`;

    const cart = await client.query(
      `SELECT c.quantity, p.id, p.name, p.price, p.stock
       FROM cart_items c
       JOIN products p ON p.id = c.product_id
       WHERE c.user_id = $1
       FOR UPDATE OF p`,
      [req.session.user.id]
    );

    if (!cart.rowCount) {
      throw Object.assign(new Error('Your cart is empty.'), { status: 400 });
    }

    let subtotal = 0;

    for (const item of cart.rows) {
      if (Number(item.quantity) > Number(item.stock)) {
        throw Object.assign(
          new Error(`Not enough stock for ${item.name}.`),
          { status: 400 }
        );
      }

      subtotal += Number(item.price) * Number(item.quantity);
    }

    subtotal = Number(subtotal.toFixed(2));

    const feeResult = await client.query(
      'SELECT delivery_fee FROM delivery_settings ORDER BY id LIMIT 1'
    );

    if (!feeResult.rowCount) {
      throw new Error('Delivery fee settings are unavailable.');
    }

    const deliveryFee = Number(feeResult.rows[0].delivery_fee);

    const promoCode = String(req.body.promo_code || '').trim().toUpperCase();
    let discountAmount = 0;
    let appliedPromoCode = null;

    if (promoCode) {
      const promoResult = await client.query(
        `SELECT *
         FROM promo_codes
         WHERE code = $1
           AND active = TRUE
           AND (starts_at IS NULL OR starts_at <= NOW())
           AND (expires_at IS NULL OR expires_at > NOW())
           AND (usage_limit IS NULL OR usage_count < usage_limit)
         FOR UPDATE`,
        [promoCode]
      );

      if (!promoResult.rowCount) {
        throw Object.assign(
          new Error('This discount code is invalid, expired, inactive or has reached its usage limit.'),
          { status: 400 }
        );
      }

      const promo = promoResult.rows[0];

      if (subtotal < Number(promo.minimum_order)) {
        throw Object.assign(
          new Error(`This code requires a minimum order of KES ${promo.minimum_order}.`),
          { status: 400 }
        );
      }

      discountAmount = promo.discount_type === 'percent'
        ? subtotal * Number(promo.discount_value) / 100
        : Number(promo.discount_value);

      discountAmount = Number(Math.min(discountAmount, subtotal).toFixed(2));
      appliedPromoCode = promo.code;
    }

    total = Number((subtotal - discountAmount + deliveryFee).toFixed(2));

    if (!Number.isFinite(total) || total <= 0) {
      throw Object.assign(new Error('Invalid payment amount.'), { status: 400 });
    }

    const orderResult = await client.query(
      `INSERT INTO orders
       (user_id, total, delivery_fee, promo_code, discount_amount,
        delivery_address, delivery_slot, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Awaiting Payment')
       RETURNING id`,
      [
        req.session.user.id,
        total,
        deliveryFee,
        appliedPromoCode,
        discountAmount,
        address,
        slot
      ]
    );

    orderId = orderResult.rows[0].id;

    for (const item of cart.rows) {
      await client.query(
        `INSERT INTO order_items
         (order_id, product_id, product_name, unit_price, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, item.id, item.name, item.price, item.quantity]
      );
    }

    reference = `FC${crypto.randomBytes(12).toString('hex').toUpperCase()}`;

    await client.query(
      `INSERT INTO payments
       (order_id, method, amount, reference, status, gateway, channel)
       VALUES ($1, $2, $3, $4, 'Pending', 'paystack', $5)`,
      [
        orderId,
        method,
        total,
        reference,
        method === 'Credit Card' ? 'card' : 'mobile_money'
      ]
    );

    await client.query('COMMIT');

  } catch (error) {
    await client.query('ROLLBACK');

    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    throw error;
  } finally {
    client.release();
  }

  try {
    const metadata = {
      order_id: orderId,
      customer_id: req.session.user.id,
      custom_fields: [
        {
          display_name: 'FreshCart Order',
          variable_name: 'freshcart_order',
          value: String(orderId)
        }
      ]
    };

    let result;

    if (method === 'Credit Card') {
      result = await paystack.initializeTransaction({
        email,
        amount: total,
        reference,
        callbackUrl: process.env.PAYSTACK_CALLBACK_URL,
        metadata
      });
    } else {
      result = await paystack.chargeMobileMoney({
        email,
        amount: total,
        reference,
        phone,
        provider,
        metadata
      });
    }

    await pool.query(
      `UPDATE payments
       SET authorization_url = $1,
           access_code = $2,
           updated_at = NOW()
       WHERE reference = $3`,
      [
        result.authorization_url || null,
        result.access_code || null,
        reference
      ]
    );

    log(req.session.user.id, 'PAYMENT_INITIALIZED', `order ${orderId}`, req.ip);

    res.status(201).json({
      order_id: orderId,
      reference,
      total,
      method,
      status: result.status || 'pending',
      authorization_url: result.authorization_url || null,
      display_text: result.display_text || result.message || null
    });

  } catch (error) {
  console.error('Paystack initialization error:', error.message);

  return res.status(502).json({
    error: 'We could not confirm your payment request. Please check your order status before trying again.'
  });
}
});

router.post('/verify', customer, async (req, res) => {
  const reference = String(req.body.reference || '').trim();

  if (!/^FC[A-F0-9]{24}$/.test(reference)) {
    return res.status(400).json({ error: 'Invalid payment reference.' });
  }

  try {
    const ownership = await pool.query(
      `SELECT p.reference
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.reference = $1
         AND p.gateway = 'paystack'
         AND o.user_id = $2`,
      [reference, req.session.user.id]
    );

    if (!ownership.rowCount) {
      return res.status(404).json({ error: 'Payment not found.' });
    }

    const verified = await paystack.verifyTransaction(reference);

    const result = await settlePayment(reference, verified);

    return res.json(result);

  } catch (error) {
    console.error('Payment verification error:', error.message);

    return res.status(400).json({
      error: 'We could not confirm this payment yet. Please try again.'
    });
  }
});

router.post('/webhook', async (req, res) => {
  const validSignature = paystack.verifyWebhookSignature(
    req.rawBody,
    req.headers
  );

  if (!validSignature) {
    return res.sendStatus(401);
  }

  const event = req.body;

  if (event.event !== 'charge.success') {
    return res.sendStatus(200);
  }

  const reference = String(event.data?.reference || '');

  if (!/^FC[A-F0-9]{24}$/.test(reference)) {
    return res.sendStatus(200);
  }

  try {
    const paymentResult = await pool.query(
      `SELECT reference
       FROM payments
       WHERE reference = $1
         AND gateway = 'paystack'`,
      [reference]
    );

    if (!paymentResult.rowCount) {
      return res.sendStatus(200);
    }

    const verified = await paystack.verifyTransaction(reference);

    await settlePayment(reference, verified);

    return res.sendStatus(200);

   } catch (error) {
    console.error('Paystack webhook processing error:', error.message);

    return res.status(502).json({
  error: 'Payment received but order confirmation is pending. Please check your order status.'
});
  }
});

module.exports = router;
