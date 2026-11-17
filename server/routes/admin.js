const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const v = require('../lib/validate');
const { log, requireRole } = require('../lib/auth');
const staff = requireRole('admin', 'vendor'), adminOnly = requireRole('admin');

// ---- Delivery fee settings (admin only) ----

router.get('/delivery-settings', adminOnly, async (req, res) => {
  const result = await pool.query(
    `SELECT
       ds.delivery_fee,
       ds.updated_at,
       ds.updated_by,
       u.full_name AS updated_by_name
     FROM delivery_settings ds
     LEFT JOIN users u ON u.id = ds.updated_by
     ORDER BY ds.id
     LIMIT 1`
  );

  if (!result.rowCount) {
    return res.status(404).json({
      error: 'Delivery settings not found.'
    });
  }

  res.json(result.rows[0]);
});


router.put('/delivery-settings', adminOnly, async (req, res) => {
  const fee = Number(req.body.delivery_fee);

  if (!Number.isFinite(fee) || fee < 0 || fee > 1000000) {
    return res.status(400).json({
      error: 'Enter a valid delivery fee between KES 0 and KES 1,000,000.'
    });
  }

  const result = await pool.query(
    `UPDATE delivery_settings
     SET delivery_fee = $1,
         updated_at = NOW(),
         updated_by = $2
     WHERE id = (
       SELECT id FROM delivery_settings ORDER BY id LIMIT 1
     )
     RETURNING delivery_fee`,
    [fee, req.session.user.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: 'Delivery settings not found.' });
  }

  log(req.session.user.id, 'DELIVERY_FEE_UPDATED',
      'Delivery fee changed to KES ' + fee, req.ip);

  res.json({ ok: true, delivery_fee: result.rows[0].delivery_fee });
});


// ---- Product management (admin: all products; vendor: own products only) ----
function parseProduct(b) {
  const name = v.clean(b.name, 120), price = v.money(b.price), stock = Number.isInteger(+b.stock) && +b.stock >= 0 ? +b.stock : null;
  if (name.length < 2 || price === null || stock === null) return { error: 'Check name, price and stock' };
  const image_url = v.clean(b.image_url, 500);
  if (image_url && !/^https:\/\//i.test(image_url)) return { error: 'Product image URL must use HTTPS' };
  return { name, price, stock, description: v.clean(b.description, 500), unit: v.clean(b.unit || 'each', 20), image_url: image_url || null, category_id: v.posInt(b.category_id) };
}
router.get('/products', staff, async (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  res.json((await pool.query(
    `SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id ${isAdmin ? '' : 'WHERE p.vendor_id=$1'} ORDER BY p.id`,
    isAdmin ? [] : [req.session.user.id])).rows);
});
router.post('/products', staff, async (req, res) => {
  const p = parseProduct(req.body); if (p.error) return res.status(400).json(p);
  const r = await pool.query('INSERT INTO products(name,description,price,stock,unit,image_url,category_id,vendor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [p.name, p.description, p.price, p.stock, p.unit, p.image_url, p.category_id, req.session.user.id]);
  log(req.session.user.id, 'PRODUCT_ADDED', p.name, req.ip);
  res.status(201).json({ id: r.rows[0].id });
});
router.put('/products/:id', staff, async (req, res) => {
  const id = v.posInt(req.params.id), p = parseProduct(req.body); if (!id || p.error) return res.status(400).json(p.error ? p : { error: 'Bad id' });
  const isAdmin = req.session.user.role === 'admin';
  const r = await pool.query(
    `UPDATE products SET name=$2,description=$3,price=$4,stock=$5,unit=$6,image_url=$7,category_id=$8 WHERE id=$1 ${isAdmin ? '' : 'AND vendor_id=$9'}`,
    [id, p.name, p.description, p.price, p.stock, p.unit, p.image_url, p.category_id, ...(isAdmin ? [] : [req.session.user.id])]);
  if (!r.rowCount) return res.status(404).json({ error: 'Product not found' });
  log(req.session.user.id, 'PRODUCT_EDITED', `id ${id}`, req.ip);
  res.json({ ok: true });
});
router.delete('/products/:id', staff, async (req, res) => {
  const id = v.posInt(req.params.id), isAdmin = req.session.user.role === 'admin';
  const r = await pool.query(`DELETE FROM products WHERE id=$1 ${isAdmin ? '' : 'AND vendor_id=$2'}`, [id, ...(isAdmin ? [] : [req.session.user.id])]);
  if (!r.rowCount) return res.status(404).json({ error: 'Product not found' });
  log(req.session.user.id, 'PRODUCT_DELETED', `id ${id}`, req.ip);
  res.json({ ok: true });
});

// ---- Categorization ----
router.post('/categories', adminOnly, async (req, res) => {
  const name = v.clean(req.body.name, 80); if (name.length < 2) return res.status(400).json({ error: 'Enter a category name' });
  try { await pool.query('INSERT INTO categories(name) VALUES($1)', [name]); res.status(201).json({ ok: true }); }
  catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Category exists' }); throw e; }
});
router.delete('/categories/:id', adminOnly, async (req, res) => {
  await pool.query('DELETE FROM categories WHERE id=$1', [v.posInt(req.params.id)]); res.json({ ok: true });
});

// ---- Order management (admin) ----
const STATUS = ['Placed', 'Packed', 'Out for Delivery', 'Delivered', 'Cancelled'];
router.get('/orders', adminOnly, async (req, res) => {
  res.json((await pool.query(
    `SELECT o.*, u.full_name, u.phone, p.method, p.reference FROM orders o JOIN users u ON u.id=o.user_id
     LEFT JOIN payments p ON p.order_id=o.id ORDER BY o.created_at DESC LIMIT 200`)).rows);
});
router.put('/orders/:id/status', adminOnly, async (req, res) => {
  const id = v.posInt(req.params.id); if (!id || !STATUS.includes(req.body.status)) return res.status(400).json({ error: 'Bad status' });
  await pool.query('UPDATE orders SET status=$2 WHERE id=$1', [id, req.body.status]);
  log(req.session.user.id, 'ORDER_STATUS', `order ${id} -> ${req.body.status}`, req.ip);
  res.json({ ok: true });

});

// ---- Assign delivery personnel to an order ----
router.put('/orders/:id/assign-delivery', adminOnly, async (req, res) => {
  const orderId = v.posInt(req.params.id);
  const deliveryId = v.posInt(req.body.delivery_id);

  if (!orderId || !deliveryId) {
    return res.status(400).json({
      error: 'Valid order and delivery staff IDs are required'
    });
  }

  const order = await pool.query(
    'SELECT id FROM orders WHERE id = $1',
    [orderId]
  );

  if (!order.rowCount) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const staff = await pool.query(
    "SELECT id FROM users WHERE id = $1 AND role = 'delivery'",
    [deliveryId]
  );

  if (!staff.rowCount) {
    return res.status(400).json({
      error: 'Selected user is not registered delivery personnel'
    });
  }

  await pool.query(
    `INSERT INTO delivery_assignments
      (order_id, assigned_to, delivery_status, assigned_at, updated_at)
     VALUES ($1, $2, 'Assigned', NOW(), NOW())
     ON CONFLICT (order_id)
     DO UPDATE SET
       assigned_to = EXCLUDED.assigned_to,
       delivery_status = 'Assigned',
       assigned_at = NOW(),
       updated_at = NOW()`,
    [orderId, deliveryId]
  );

  log(
    req.session.user.id,
    'DELIVERY_ASSIGNED',
    'Order ' + orderId + ' assigned to delivery staff ' + deliveryId,
    req.ip
  );

  res.json({ ok: true, message: 'Delivery personnel assigned successfully' });
});


// ---- Admin dashboard + Reporting module ----
router.get('/dashboard', adminOnly, async (req, res) => {
  const q = async s => (await pool.query(s)).rows[0];
  res.json({
    revenue: (await q(`SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status<>'Cancelled'`)).v,
    orders: (await q('SELECT COUNT(*) AS v FROM orders')).v,
    pending: (await q(`SELECT COUNT(*) AS v FROM orders WHERE status IN ('Placed','Packed','Out for Delivery')`)).v,
    customers: (await q(`SELECT COUNT(*) AS v FROM users WHERE role='customer'`)).v,
    low_stock: (await q('SELECT COUNT(*) AS v FROM products WHERE stock<=10')).v
  });
});
router.get('/reports/sales', adminOnly, async (req, res) => {
  res.json({
    daily: (await pool.query(`SELECT to_char(created_at,'YYYY-MM-DD') AS day, COUNT(*) AS orders, SUM(total) AS revenue FROM orders WHERE status<>'Cancelled' GROUP BY 1 ORDER BY 1 DESC LIMIT 30`)).rows,
    by_product: (await pool.query(`SELECT oi.product_name AS name, SUM(oi.quantity) AS units, SUM(oi.quantity*oi.unit_price) AS revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status<>'Cancelled' GROUP BY 1 ORDER BY revenue DESC LIMIT 10`)).rows,
    by_method: (await pool.query(`SELECT method, COUNT(*) AS payments, SUM(amount) AS amount FROM payments WHERE status='Paid' GROUP BY 1`)).rows
  });
});
router.get('/reports/customers', adminOnly, async (req, res) => {
  res.json((await pool.query(
    `SELECT u.id, u.full_name, u.email, to_char(u.created_at,'YYYY-MM-DD') AS joined, COUNT(o.id) FILTER (WHERE o.status<>'Cancelled') AS orders,
     COALESCE(SUM(o.total) FILTER (WHERE o.status<>'Cancelled'),0) AS spent
     FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role='customer' GROUP BY u.id ORDER BY spent DESC`)).rows);
});
router.get('/reports/inventory', staff, async (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  res.json((await pool.query(
    `SELECT p.id, p.name, c.name AS category, p.stock, p.price, (p.stock*p.price) AS stock_value, (p.stock<=10) AS low
     FROM products p LEFT JOIN categories c ON c.id=p.category_id ${isAdmin ? '' : 'WHERE p.vendor_id=$1'} ORDER BY p.stock`, isAdmin ? [] : [req.session.user.id])).rows);
});


// ---- Delivery personnel listing (admin) ----
router.get('/delivery-staff', adminOnly, async (req, res) => {
  const result = await pool.query(
    `SELECT id, full_name, email, phone
     FROM users
     WHERE role = 'delivery'
     ORDER BY full_name ASC`
  );

  res.json(result.rows);
});
// ---- Staff accounts + activity log (admin) ----

router.post('/staff', adminOnly, async (req, res) => {
  const role = ['admin', 'vendor', 'delivery'].includes(req.body.role)
    ? req.body.role
    : 'vendor';

  const name = v.clean(req.body.full_name, 100);
  const email = v.clean(req.body.email, 150).toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const pw = v.passwordProblem(req.body.password);

  const validPhone = /^(?:\+254|0)(?:7|1)\d{8}$/.test(phone);

  if (name.length < 2 || !v.isEmail(email) || pw) {
    return res.status(400).json({
      error: pw || 'Check name and email'
    });
  }

  if (role === 'delivery' && !validPhone) {
    return res.status(400).json({
      error: 'A valid Kenyan phone number is required for delivery personnel'
    });
  }

  if (phone && !validPhone) {
    return res.status(400).json({
      error: 'Enter a valid Kenyan phone number'
    });
  }

  try {
    await pool.query(
      `INSERT INTO users
       (full_name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        name,
        email,
        phone || null,
        await bcrypt.hash(req.body.password, 12),
        role
      ]
    );

    log(
      req.session.user.id,
      'STAFF_CREATED',
      `${role} ${email}`,
      req.ip
    );

    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({
        error: 'Email already registered'
      });
    }
    throw e;
  }
});


// ---- Promo code management (admin only) ----

router.get('/promo-codes', adminOnly, async (req, res) => {
  const result = await pool.query(
    `SELECT p.*, u.full_name AS created_by_name
     FROM promo_codes p
     LEFT JOIN users u ON u.id = p.created_by
     ORDER BY p.created_at DESC`
  );

  res.json(result.rows);
});

router.post('/promo-codes', adminOnly, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const description = String(req.body.description || '').trim();
  const discountType = req.body.discount_type;
  const discountValue = Number(req.body.discount_value);
  const minimumOrder = Number(req.body.minimum_order || 0);
  const usageLimit = req.body.usage_limit === '' ||
    req.body.usage_limit == null
      ? null
      : Number(req.body.usage_limit);

  const startsAt = req.body.starts_at || null;
  const expiresAt = req.body.expires_at || null;

  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    return res.status(400).json({
      error: 'Promo code must contain 3–40 letters, numbers, hyphens or underscores.'
    });
  }

  if (!['percent', 'fixed'].includes(discountType)) {
    return res.status(400).json({
      error: 'Choose a valid discount type.'
    });
  }

  if (
    !Number.isFinite(discountValue) ||
    discountValue <= 0 ||
    (discountType === 'percent' && discountValue > 100)
  ) {
    return res.status(400).json({
      error: 'Enter a valid discount value. Percentage discounts cannot exceed 100%.'
    });
  }

  if (!Number.isFinite(minimumOrder) || minimumOrder < 0) {
    return res.status(400).json({
      error: 'Minimum order must be zero or greater.'
    });
  }

  if (
    usageLimit !== null &&
    (!Number.isInteger(usageLimit) || usageLimit < 1)
  ) {
    return res.status(400).json({
      error: 'Usage limit must be a positive whole number.'
    });
  }

  if (
    (startsAt && !Number.isFinite(Date.parse(startsAt))) ||
    (expiresAt && !Number.isFinite(Date.parse(expiresAt)))
  ) {
    return res.status(400).json({
      error: 'Enter valid start and expiry dates.'
    });
  }

  if (startsAt && expiresAt && new Date(expiresAt) <= new Date(startsAt)) {
    return res.status(400).json({
      error: 'Expiry date must be after the start date.'
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO promo_codes
       (code, description, discount_type, discount_value,
        minimum_order, starts_at, expires_at, usage_limit, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        code,
        description || null,
        discountType,
        discountValue,
        minimumOrder,
        startsAt,
        expiresAt,
        usageLimit,
        req.session.user.id
      ]
    );

    log(
      req.session.user.id,
      'PROMO_CODE_CREATED',
      'Created promo code ' + code,
      req.ip
    );

    res.status(201).json({
      ok: true,
      promo_code: result.rows[0]
    });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({
        error: 'That promo code already exists.'
      });
    }
    throw e;
  }
});

router.put('/promo-codes/:id/status', adminOnly, async (req, res) => {
  const active = req.body.active;

  if (typeof active !== 'boolean') {
    return res.status(400).json({
      error: 'A valid active status is required.'
    });
  }

  const result = await pool.query(
    `UPDATE promo_codes
     SET active = $1
     WHERE id = $2
     RETURNING id, code, active`,
    [active, req.params.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({
      error: 'Promo code not found.'
    });
  }

  log(
    req.session.user.id,
    'PROMO_CODE_STATUS_UPDATED',
    'Promo code ' + result.rows[0].code +
      ' active: ' + active,
    req.ip
  );

  res.json({ ok: true, promo_code: result.rows[0] });
});


router.get('/logs', adminOnly, async (req, res) => {
  res.json((await pool.query(`SELECT l.*, u.email FROM activity_logs l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 100`)).rows);
});
module.exports = router;
