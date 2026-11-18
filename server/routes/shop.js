const router = require('express').Router();
const crypto = require('crypto');
const pool = require('../db/pool');
const v = require('../lib/validate');
const { log, requireLogin, requireRole } = require('../lib/auth');
const customer = requireRole('customer');


// ---- Customer delivery address management ----

const kenyaBounds = {
  minLat: -4.75,
  maxLat: 5.15,
  minLng: 33.85,
  maxLng: 41.95
};

function validateKenyaAddress(data) {
  const label = v.clean(data.label, 60);
  const address = v.clean(data.address, 255);
  const city = v.clean(data.city, 100);
  const country = v.clean(data.country || 'Kenya', 80);
  const instructions = v.clean(data.instructions, 255);

  if (!label || address.length < 5 || !city) {
    return { error: 'Enter an address label, physical address and city.' };
  }

  if (country.toLowerCase() !== 'kenya') {
    return { error: "We're only available in Kenya for delivery." };
  }

  let latitude = null;
  let longitude = null;

  if (data.latitude !== undefined && data.latitude !== null && data.latitude !== '') {
    latitude = Number(data.latitude);
    longitude = Number(data.longitude);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < kenyaBounds.minLat ||
      latitude > kenyaBounds.maxLat ||
      longitude < kenyaBounds.minLng ||
      longitude > kenyaBounds.maxLng
    ) {
      return { error: "We're only available in Kenya for delivery. Please select a location within Kenya." };
    }
  } else if (data.longitude !== undefined && data.longitude !== null && data.longitude !== '') {
    return { error: 'Please provide both map coordinates.' };
  }

  return {
    value: {
      label,
      address,
      city,
      country: 'Kenya',
      instructions: instructions || null,
      latitude,
      longitude
    }
  };
}

// Get all saved addresses belonging to the logged-in customer
router.get('/addresses', customer, async (req, res) => {
  const result = await pool.query(
    `SELECT id, label, address, city, country, instructions,
            latitude, longitude, is_default, created_at
     FROM customer_addresses
     WHERE user_id = $1
     ORDER BY is_default DESC, created_at DESC`,
    [req.session.user.id]
  );

  res.json(result.rows);
});

// Save a new delivery address
router.post('/addresses', customer, async (req, res) => {
  const checked = validateKenyaAddress(req.body || {});
  if (checked.error) {
    return res.status(400).json({ error: checked.error });
  }

  const a = checked.value;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT COUNT(*)::int AS count FROM customer_addresses WHERE user_id = $1',
      [req.session.user.id]
    );

    const isDefault = existing.rows[0].count === 0 || req.body.is_default === true;

    if (isDefault) {
      await client.query(
        'UPDATE customer_addresses SET is_default = FALSE WHERE user_id = $1',
        [req.session.user.id]
      );
    }

    const result = await client.query(
      `INSERT INTO customer_addresses
       (user_id, label, address, city, country, instructions,
        latitude, longitude, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        req.session.user.id, a.label, a.address, a.city,
        a.country, a.instructions, a.latitude, a.longitude, isDefault
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, address: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Save address error:', error);
    res.status(500).json({ error: 'Could not save delivery address.' });
  } finally {
    client.release();
  }
});

// Update an existing address belonging to the logged-in customer
router.put('/addresses/:id', customer, async (req, res) => {
  const id = v.posInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid address ID.' });

  const checked = validateKenyaAddress(req.body || {});
  if (checked.error) {
    return res.status(400).json({ error: checked.error });
  }

  const a = checked.value;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id FROM customer_addresses WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, req.session.user.id]
    );

    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Address not found.' });
    }

    if (req.body.is_default === true) {
      await client.query(
        'UPDATE customer_addresses SET is_default = FALSE WHERE user_id = $1',
        [req.session.user.id]
      );
    }

    const result = await client.query(
      `UPDATE customer_addresses
       SET label=$1, address=$2, city=$3, country=$4,
           instructions=$5, latitude=$6, longitude=$7,
           is_default=CASE WHEN $8 THEN TRUE ELSE is_default END
       WHERE id=$9 AND user_id=$10
       RETURNING *`,
      [
        a.label, a.address, a.city, a.country, a.instructions,
        a.latitude, a.longitude, req.body.is_default === true,
        id, req.session.user.id
      ]
    );

    await client.query('COMMIT');
    res.json({ ok: true, address: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update address error:', error);
    res.status(500).json({ error: 'Could not update delivery address.' });
  } finally {
    client.release();
  }
});

// Set an address as the customer's default
router.patch('/addresses/:id/default', customer, async (req, res) => {
  const id = v.posInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid address ID.' });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id FROM customer_addresses WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [id, req.session.user.id]
    );

    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Address not found.' });
    }

    await client.query(
      'UPDATE customer_addresses SET is_default = FALSE WHERE user_id = $1',
      [req.session.user.id]
    );

    await client.query(
      'UPDATE customer_addresses SET is_default = TRUE WHERE id = $1 AND user_id = $2',
      [id, req.session.user.id]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Default address error:', error);
    res.status(500).json({ error: 'Could not change default address.' });
  } finally {
    client.release();
  }
});

// Delete an address belonging to the logged-in customer
router.delete('/addresses/:id', customer, async (req, res) => {
  const id = v.posInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid address ID.' });

  const result = await pool.query(
    'DELETE FROM customer_addresses WHERE id=$1 AND user_id=$2 RETURNING id',
    [id, req.session.user.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: 'Address not found.' });
  }

  res.json({ ok: true });
});

// ---- Product catalogue, categories, search ----
router.get('/categories', async (req, res) => res.json((await pool.query('SELECT * FROM categories ORDER BY name')).rows));

router.get('/products', async (req, res) => {
  const q = v.clean(req.query.q, 60), cat = v.posInt(req.query.category);
  const params = [], where = [];
  if (q) { params.push(`%${q}%`); where.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`); }
  if (cat) { params.push(cat); where.push(`p.category_id=$${params.length}`); }
  const r = await pool.query(
    `SELECT p.*, c.name AS category, COALESCE(ROUND(AVG(r.rating),1),0) AS avg_rating, COUNT(r.id) AS review_count
     FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN reviews r ON r.product_id=p.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY p.id, c.name ORDER BY p.name`, params);
  res.json(r.rows);
});

router.get('/products/:id/reviews', async (req, res) => {
  const id = v.posInt(req.params.id); if (!id) return res.status(400).json({ error: 'Bad id' });
  res.json((await pool.query(
    `SELECT r.rating, r.comment, r.created_at, u.full_name FROM reviews r JOIN users u ON u.id=r.user_id
     WHERE r.product_id=$1 ORDER BY r.created_at DESC`, [id])).rows);
});

// ---- Customer feedback / reviews (only customers who received the product) ----
router.post('/products/:id/reviews', customer, async (req, res) => {
  const id = v.posInt(req.params.id), rating = v.posInt(req.body.rating), comment = v.clean(req.body.comment, 500);
  if (!id || !rating || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
  const bought = await pool.query(
    `SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
     WHERE o.user_id=$1 AND oi.product_id=$2 AND o.status='Delivered' LIMIT 1`, [req.session.user.id, id]);
  if (!bought.rowCount) return res.status(403).json({ error: 'You can review products after they are delivered' });
  await pool.query(
    `INSERT INTO reviews(product_id,user_id,rating,comment) VALUES($1,$2,$3,$4)
     ON CONFLICT (product_id,user_id) DO UPDATE SET rating=$3, comment=$4, created_at=NOW()`,
    [id, req.session.user.id, rating, comment]);
  log(req.session.user.id, 'REVIEW', `product ${id}`, req.ip);
  res.json({ ok: true });
});

// ---- Shopping cart ----
router.get('/cart', customer, async (req, res) => {
  const r = await pool.query(
    `SELECT c.id, c.quantity, p.id AS product_id, p.name, p.price, p.stock, p.image_url, p.unit
     FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=$1 ORDER BY c.id`, [req.session.user.id]);
  const total = r.rows.reduce((s, i) => s + i.price * i.quantity, 0);
  res.json({ items: r.rows, total: +total.toFixed(2) });
});
router.post('/cart', customer, async (req, res) => {
  const pid = v.posInt(req.body.product_id), qty = v.posInt(req.body.quantity || 1);
  if (!pid || !qty || qty > 99) return res.status(400).json({ error: 'Invalid quantity' });
  const p = await pool.query('SELECT stock FROM products WHERE id=$1', [pid]);
  if (!p.rowCount) return res.status(404).json({ error: 'Product not found' });
  const cur = await pool.query('SELECT quantity FROM cart_items WHERE user_id=$1 AND product_id=$2', [req.session.user.id, pid]);
  if ((cur.rows[0]?.quantity || 0) + qty > p.rows[0].stock) return res.status(400).json({ error: 'Not enough stock' });
  await pool.query(
    `INSERT INTO cart_items(user_id,product_id,quantity) VALUES($1,$2,$3)
     ON CONFLICT (user_id,product_id) DO UPDATE SET quantity=cart_items.quantity+$3`, [req.session.user.id, pid, qty]);
  res.json({ ok: true });
});
router.put('/cart/:productId', customer, async (req, res) => {
  const pid = v.posInt(req.params.productId), qty = v.posInt(req.body.quantity);
  if (!pid || !qty || qty > 99) return res.status(400).json({ error: 'Invalid quantity' });
  const p = await pool.query('SELECT stock FROM products WHERE id=$1', [pid]);
  if (!p.rowCount || qty > p.rows[0].stock) return res.status(400).json({ error: 'Not enough stock' });
  await pool.query('UPDATE cart_items SET quantity=$3 WHERE user_id=$1 AND product_id=$2', [req.session.user.id, pid, qty]);
  res.json({ ok: true });
});
router.delete('/cart/:productId', customer, async (req, res) => {
  await pool.query('DELETE FROM cart_items WHERE user_id=$1 AND product_id=$2', [req.session.user.id, v.posInt(req.params.productId)]);
  res.json({ ok: true });
});

// ---- Checkout + Paystack payment validation ----
function checkPayment(method, d = {}) {
  if (method === 'Mobile Money') {
    const phone = String(d.phone || '').trim();

    if (!/^\+?[0-9]{9,15}$/.test(phone)) {
      return 'Enter a valid mobile money number.';
    }

    const provider = String(d.provider || 'mpesa').toLowerCase();

    if (!['mpesa', 'atl'].includes(provider)) {
      return 'Choose a supported mobile money provider.';
    }

    return null;
  }

  if (method === 'Credit Card') {
    return null; // Card details are collected securely by Paystack.
  }

  return 'Choose a supported payment method.';
}
// Get the current delivery fee for customer checkout
router.get('/delivery-fee', customer, async (req, res) => {
  const result = await pool.query(
    'SELECT delivery_fee FROM delivery_settings ORDER BY id LIMIT 1'
  );

  if (!result.rowCount) {
    return res.status(503).json({
      error: 'Delivery fee settings are unavailable.'
    });
  }

  res.json({
    delivery_fee: Number(result.rows[0].delivery_fee)
  });
});
router.post('/validate-promo', customer, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();

    if (!code) {
      return res.status(400).json({ error: 'Enter a discount code.' });
    }

    const cart = await pool.query(
      `SELECT COALESCE(SUM(c.quantity * p.price), 0) AS subtotal
       FROM cart_items c
       JOIN products p ON p.id = c.product_id
       WHERE c.user_id = $1`,
      [req.session.user.id]
    );

    const subtotal = Number(cart.rows[0].subtotal);

    const result = await pool.query(
      `SELECT *
       FROM promo_codes
       WHERE code = $1
         AND active = TRUE
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (usage_limit IS NULL OR usage_count < usage_limit)`,
      [code]
    );

    if (!result.rowCount) {
      return res.status(400).json({
        error: 'This discount code is invalid, expired, inactive or has reached its usage limit.'
      });
    }

    const promo = result.rows[0];

    if (subtotal < Number(promo.minimum_order)) {
      return res.status(400).json({
        error: `This code requires a minimum order of KES ${promo.minimum_order}.`
      });
    }

    let discount = promo.discount_type === 'percent'
      ? subtotal * Number(promo.discount_value) / 100
      : Number(promo.discount_value);

    discount = Number(Math.min(discount, subtotal).toFixed(2));

    res.json({
      valid: true,
      code: promo.code,
      discount_amount: discount,
      subtotal,
      message: 'Discount code applied successfully.'
    });
  } catch (err) {
    console.error('Promo validation error:', err);
    res.status(500).json({ error: 'Could not validate the discount code.' });
  }
});
router.post('/checkout', customer, async (req, res) => {
  const method = req.body.method;
const addressId = v.posInt(req.body.address);
const slot = v.clean(req.body.slot, 40);

if (!addressId) {
  return res.status(400).json({ error: 'Please select a saved delivery address.' });
}
  const perr = checkPayment(method, req.body.payment); if (perr) return res.status(400).json({ error: perr });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const savedAddress = await client.query(
  `SELECT address, city, country
   FROM customer_addresses
   WHERE id = $1 AND user_id = $2`,
  [addressId, req.session.user.id]
);

if (!savedAddress.rowCount) {
  throw Object.assign(
    new Error('Selected delivery address was not found. Please choose a saved address.'),
    { status: 400 }
  );
}

const address = `${savedAddress.rows[0].address}, ${savedAddress.rows[0].city}`;
    const cart = await client.query(
      `SELECT c.quantity, p.id, p.name, p.price, p.stock FROM cart_items c JOIN products p ON p.id=c.product_id
       WHERE c.user_id=$1 FOR UPDATE OF p`, [req.session.user.id]);
    if (!cart.rowCount) throw Object.assign(new Error('Your cart is empty'), { status: 400 });
    let subtotal = 0;

for (const i of cart.rows) {
  if (i.quantity > i.stock) {
    throw Object.assign(
      new Error(`Not enough stock for ${i.name}`),
      { status: 400 }
    );
  }

  subtotal += i.price * i.quantity;
}

subtotal = +subtotal.toFixed(2);

// Read the delivery fee from admin settings
const feeResult = await client.query(
  'SELECT delivery_fee FROM delivery_settings ORDER BY id LIMIT 1'
);

if (!feeResult.rowCount) {
  throw new Error('Delivery fee settings are unavailable.');
}

const deliveryFee = Number(feeResult.rows[0].delivery_fee);
// Validate and calculate the customer's promo-code discount
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

  discountAmount = +Math.min(discountAmount, subtotal).toFixed(2);
  appliedPromoCode = promo.code;
}
const total = +(subtotal - discountAmount + deliveryFee).toFixed(2);
    const o = (await client.query(
  `INSERT INTO orders
   (user_id, total, delivery_fee, promo_code, discount_amount, delivery_address, delivery_slot)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
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
)).rows[0];
    for (const i of cart.rows) {
      await client.query('INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity) VALUES($1,$2,$3,$4,$5)', [o.id, i.id, i.name, i.price, i.quantity]);
      await client.query('UPDATE products SET stock=stock-$2 WHERE id=$1', [i.id, i.quantity]);
    }
    // Record successful promo-code usage
if (appliedPromoCode) {
  await client.query(
    'UPDATE promo_codes SET usage_count = usage_count + 1 WHERE code = $1',
    [appliedPromoCode]
  );
}
    const ref = (method === 'Mobile Money' ? 'MM' : method === 'PayPal' ? 'PP' : 'CC') + crypto.randomBytes(5).toString('hex').toUpperCase();
    await client.query('INSERT INTO payments(order_id,method,amount,reference) VALUES($1,$2,$3,$4)', [o.id, method, total, ref]);
    // Notify customer that the order has been placed
await client.query(
  `INSERT INTO customer_notifications
   (user_id, title, message, notification_type)
   VALUES ($1, $2, $3, $4)`,
  [
    req.session.user.id,
    'Order placed successfully',
    `Your FreshCart order #${o.id} has been placed successfully. Total: KES ${total}.`,
    'order'
  ]
);
// Notify all administrators about the new order
await client.query(
  `INSERT INTO customer_notifications
   (user_id, title, message, notification_type)
   SELECT id, $1, $2, $3
   FROM users
   WHERE role = 'admin'`,
  [
    'New customer order',
    `A new order #${o.id} has been placed. Total: KES ${total}.`,
    'order'
  ]
);
    await client.query('DELETE FROM cart_items WHERE user_id=$1', [req.session.user.id]);
    await client.query('COMMIT');
    log(req.session.user.id, 'ORDER_PLACED', `order ${o.id} total ${total}`, req.ip);
    res.status(201).json({ order_id: o.id, reference: ref, total });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  } finally { client.release(); }
});

// ---- Orders: history + tracking ----

router.get('/orders', customer, async (req, res) => {
  const r = await pool.query(
    `SELECT
       o.*,
p.method,
p.reference,
p.status AS payment_status,
       COALESCE(da.delivery_status, 'Awaiting Assignment') AS delivery_status,
       du.full_name AS delivery_person,
       du.phone AS delivery_phone,
       (
         SELECT json_agg(
           json_build_object(
             'product_id', oi.product_id,
             'name', oi.product_name,
             'price', oi.unit_price,
             'quantity', oi.quantity
           )
         )
         FROM order_items oi
         WHERE oi.order_id = o.id
       ) AS items
     FROM orders o
     LEFT JOIN payments p ON p.order_id = o.id
     LEFT JOIN delivery_assignments da ON da.order_id = o.id
     LEFT JOIN users du ON du.id = da.assigned_to
     WHERE o.user_id = $1
     ORDER BY o.created_at DESC`,
    [req.session.user.id]
  );

  res.json(r.rows);
});



router.post('/orders/:id/cancel', customer, async (req, res) => {
  const id = v.posInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid order ID' });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const o = await client.query(
      `UPDATE orders
       SET status = 'Cancelled'
       WHERE id = $1
         AND user_id = $2
         AND status = 'Awaiting Payment'
         AND EXISTS (
           SELECT 1 FROM payments
           WHERE payments.order_id = orders.id
             AND payments.status = 'Pending'
         )
       RETURNING id`,
      [id, req.session.user.id]
    );

    if (!o.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Only orders awaiting payment can be cancelled here.'
      });
    }

    await client.query(
      `UPDATE payments
       SET status = 'Cancelled', updated_at = NOW()
       WHERE order_id = $1 AND status = 'Pending'`,
      [id]
    );

    await client.query('COMMIT');

    log(req.session.user.id, 'ORDER_CANCELLED', `order ${id}`, req.ip);
    res.json({ ok: true });

  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

module.exports = router;
