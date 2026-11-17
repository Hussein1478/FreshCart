// Authentication / Authorization middleware (Role-Based Access Control)
const pool = require('../db/pool');
const log = (userId, action, detail, ip) =>
  pool.query('INSERT INTO activity_logs(user_id,action,detail,ip) VALUES($1,$2,$3,$4)', [userId || null, action, String(detail || '').slice(0, 255), ip]).catch(() => {});
const requireLogin = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Please log in' });
const requireRole = (...roles) => (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in' });
  if (!roles.includes(req.session.user.role)) {
    log(req.session.user.id, 'ACCESS_DENIED', req.originalUrl, req.ip);
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
};
module.exports = { log, requireLogin, requireRole };
