
const router = require('express').Router();
const pool = require('../db/pool');
const { log, requireRole } = require('../lib/auth');

// Get orders assigned to the currently logged-in delivery person
router.get('/my-orders', requireRole('delivery'), async (req, res) => {
  const result = await pool.query(
    `SELECT
       da.id AS assignment_id,
       o.id AS order_id,
       o.delivery_address,
       o.delivery_slot,
       o.status AS order_status,
       o.created_at,
       o.total,
       da.delivery_status,
       u.full_name AS customer_name,
       u.phone AS customer_phone
     FROM delivery_assignments da
     JOIN orders o ON o.id = da.order_id
     JOIN users u ON u.id = o.user_id
     WHERE da.assigned_to = $1
     ORDER BY da.assigned_at DESC`,
    [req.session.user.id]
  );

  res.json(result.rows);
});

// Update delivery progress
router.put('/orders/:id/status', requireRole('delivery'), async (req, res) => {
  const orderId = Number(req.params.id);
  const status = req.body.status;

  const allowedStatuses = [
    'Assigned',
    'Picked Up',
    'Out for Delivery',
    'Delivered'
  ];

  if (!Number.isInteger(orderId) || orderId < 1) {
    return res.status(400).json({ error: 'Invalid order ID' });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid delivery status' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Confirm this order belongs to the logged-in delivery person
    const assignment = await client.query(
  `SELECT da.id, o.user_id
   FROM delivery_assignments da
   JOIN orders o ON o.id = da.order_id
   WHERE da.order_id = $1 AND da.assigned_to = $2
   FOR UPDATE OF da`,
  [orderId, req.session.user.id]
);

    if (!assignment.rows.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'This order is not assigned to your account'
      });
    }

    await client.query(
      `UPDATE delivery_assignments
       SET delivery_status = $1,
           updated_at = NOW()
       WHERE order_id = $2 AND assigned_to = $3`,
      [status, orderId, req.session.user.id]
    );

    // Keep the main order status synchronized when delivery progresses
    if (status === 'Out for Delivery' || status === 'Delivered') {
      await client.query(
        `UPDATE orders SET status = $1 WHERE id = $2`,
        [status, orderId]
      );
    }
    // Notify customer when delivery progresses
const notificationMessages = {
  'Picked Up': 'Your order has been picked up by our delivery team.',
  'Out for Delivery': 'Your order is out for delivery and on its way to you.',
  'Delivered': 'Your order has been successfully delivered. Thank you for shopping with FreshCart!'
};

if (notificationMessages[status]) {
  await client.query(
    `INSERT INTO customer_notifications
     (user_id, title, message, notification_type)
     VALUES ($1, $2, $3, $4)`,
    [
      assignment.rows[0].user_id,
      'Delivery update',
      `Order #${orderId}: ${notificationMessages[status]}`,
      'delivery'
    ]
  );
}

    await client.query('COMMIT');

    log(
      req.session.user.id,
      'DELIVERY_STATUS_UPDATED',
      'Order ' + orderId + ': ' + status,
      req.ip
    );

    res.json({
      message: 'Delivery status updated successfully',
      order_id: orderId,
      delivery_status: status
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

module.exports = router;
