
const express = require('express');
const router = express.Router();

const pool = require('../db/pool');
const { requireLogin } = require('../lib/auth');

// Get notifications for the logged-in user
router.get('/', requireLogin, async (req, res) => {
  const result = await pool.query(
    `SELECT id, title, message, notification_type,
            read_at, created_at
     FROM customer_notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.session.user.id]
  );

  res.json(result.rows);
});

// Mark one notification as read
router.put('/:id/read', requireLogin, async (req, res) => {
  const result = await pool.query(
    `UPDATE customer_notifications
     SET read_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [req.params.id, req.session.user.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({
      error: 'Notification not found'
    });
  }

  res.json({ ok: true });
});

// Mark all notifications as read
router.put('/read-all', requireLogin, async (req, res) => {
  await pool.query(
    `UPDATE customer_notifications
     SET read_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL`,
    [req.session.user.id]
  );

  res.json({ ok: true });
});

module.exports = router;
