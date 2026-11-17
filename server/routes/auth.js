const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const {
  sendPasswordResetEmail,
  sendVerificationEmail,
  isConfigured
} = require('../lib/email');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const v = require('../lib/validate');
const totp = require('../lib/totp');
const { log, requireLogin } = require('../lib/auth');

const MAX_ATTEMPTS = 5, LOCK_MINUTES = 15;
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, try again later' } });
const publicUser = u => ({ id: u.id, full_name: u.full_name, email: u.email, role: u.role, phone: u.phone, address: u.address, mfa_enabled: u.mfa_enabled });
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);
// Registration (customers only; admin/vendor accounts are created by an administrator)

// Registration (customers only)
router.post('/register', loginLimiter, async (req, res) => {
  const full_name = v.clean(req.body.full_name, 100);
  const email = v.clean(req.body.email, 150).toLowerCase();
  const phone = v.clean(req.body.phone, 20);
  const address = v.clean(req.body.address);

  if (full_name.length < 2) {
    return res.status(400).json({ error: 'Enter your full name' });
  }

  if (!v.isEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email' });
  }

  if (!v.isPhone(phone)) {
    return res.status(400).json({ error: 'Enter a valid phone number' });
  }

  const pw = v.passwordProblem(req.body.password);
  if (pw) return res.status(400).json({ error: pw });

  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Email verification service is not configured.'
    });
  }

  const hash = await bcrypt.hash(req.body.password, 12);
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = crypto.createHash('sha256')
    .update(code)
    .digest('hex');

  let userId;

  try {
    const result = await pool.query(
      `INSERT INTO users
       (full_name, email, phone, address, password_hash, email_verified)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING id`,
      [full_name, email, phone, address, hash]
    );

    userId = result.rows[0].id;

    await pool.query(
      `INSERT INTO email_verification_tokens
       (user_id, code_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
      [userId, codeHash]
    );

    await sendVerificationEmail(email, full_name, code);

    log(userId, 'REGISTER_PENDING_VERIFICATION', email, req.ip);

    return res.status(201).json({
      message: 'Account created. Check your email for your six-digit verification code.'
    });
  } catch (error) {
    if (userId) {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    }

    if (error.code === '23505') {
      return res.status(409).json({
        error: 'Email already registered'
      });
    }

    console.error('Registration failed:', {
  message: error.message,
  code: error.code,
  command: error.command,
  response: error.response
});

    return res.status(503).json({
      error: 'Unable to complete registration. Please try again.'
    });
  }
});


// Resend customer email verification code
router.post('/resend-verification', loginLimiter, async (req, res) => {
  const email = v.clean(req.body.email, 150).toLowerCase();

  if (!v.isEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Email verification service is not configured.'
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, full_name, email_verified
       FROM users
       WHERE email = $1 AND role = 'customer'
       LIMIT 1`,
      [email]
    );

    if (!result.rows.length || result.rows[0].email_verified) {
      return res.json({
        message: 'If your account requires verification, a new code will be sent.'
      });
    }

    const user = result.rows[0];

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHash('sha256')
      .update(code)
      .digest('hex');

    await pool.query(
      `UPDATE email_verification_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    await pool.query(
      `INSERT INTO email_verification_tokens
       (user_id, code_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
      [user.id, codeHash]
    );

    await sendVerificationEmail(email, user.full_name, code);

    log(user.id, 'VERIFICATION_CODE_RESENT', email, req.ip);

    return res.json({
      message: 'A new verification code has been sent to your email.'
    });

  } catch (error) {
    console.error('Resend verification failed:', {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response
    });

    return res.status(503).json({
      error: 'Unable to send a verification code. Please try again.'
    });
  }
});

// Verify customer email using a six-digit code
router.post('/verify-email', loginLimiter, async (req, res) => {
  const email = v.clean(req.body.email, 150).toLowerCase();
  const code = String(req.body.code || '').trim();

  if (!v.isEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      error: 'Enter a valid email and six-digit verification code.'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT t.id, t.user_id, t.code_hash
       FROM email_verification_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE u.email = $1
         AND u.email_verified = FALSE
         AND t.used_at IS NULL
         AND t.expires_at > NOW()
         AND t.attempts < 5
       ORDER BY t.created_at DESC
       LIMIT 1
       FOR UPDATE OF t`,
      [email]
    );

    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Invalid or expired verification code. Request a new code.'
      });
    }

    const token = result.rows[0];

    const submittedHash = crypto.createHash('sha256')
      .update(code)
      .digest('hex');

    if (submittedHash !== token.code_hash) {
      await client.query(
        `UPDATE email_verification_tokens
         SET attempts = attempts + 1
         WHERE id = $1`,
        [token.id]
      );

      await client.query('COMMIT');

      return res.status(400).json({
        error: 'Incorrect verification code.'
      });
    }

    await client.query(
      'UPDATE users SET email_verified = TRUE WHERE id = $1',
      [token.user_id]
    );

    await client.query(
      `UPDATE email_verification_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [token.user_id]
    );

    await client.query('COMMIT');

    log(token.user_id, 'EMAIL_VERIFIED', email, req.ip);

    return res.json({
      message: 'Email verified successfully. You can now log in.'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});
// Login with account lockout + optional MFA
// Public Google Sign-In configuration
router.get('/google-client-id', (req, res) => {
  res.json({
    clientId: process.env.GOOGLE_CLIENT_ID || ''
  });
});
// Google Sign-In
router.post('/google', loginLimiter, async (req, res) => {
  try {
    const idToken = String(req.body.credential || '').trim();

    if (!idToken) {
      return res.status(400).json({
        error: 'Google credential is required.'
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    if (!payload || !payload.email || payload.email_verified !== true) {
      return res.status(401).json({
        error: 'Google email verification failed.'
      });
    }

    const email = payload.email.toLowerCase();

    let result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    let u = result.rows[0];

    if (u && u.role !== 'customer') {
      return res.status(403).json({
        error: 'Google sign-in is available for customer accounts only.'
      });
    }

    if (!u) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 12);

      result = await pool.query(
        `INSERT INTO users
         (full_name, email, password_hash, role, email_verified)
         VALUES ($1, $2, $3, 'customer', TRUE)
         RETURNING *`,
        [
          v.clean(payload.name || 'FreshCart Customer', 100),
          email,
          passwordHash
        ]
      );

      u = result.rows[0];
    } else if (!u.email_verified) {
      await pool.query(
        'UPDATE users SET email_verified = TRUE WHERE id = $1',
        [u.id]
      );

      u.email_verified = true;
    }

    req.session.regenerate(err => {
      if (err) {
        console.error('Google session error:', err);
        return res.status(500).json({
          error: 'Unable to create login session.'
        });
      }

      req.session.user = {
        id: u.id,
        role: u.role,
        full_name: u.full_name
      };

      log(u.id, 'GOOGLE_LOGIN_OK', email, req.ip);

      res.json({
        user: publicUser(u)
      });
    });

  } catch (error) {
    console.error('Google login failed:', error.message);

    return res.status(401).json({
      error: 'Google sign-in failed. Please try again.'
    });
  }
});
router.post('/login', loginLimiter, async (req, res) => {
  const email = v.clean(req.body.email, 150).toLowerCase(), password = String(req.body.password || '');
  const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  const u = r.rows[0];
  const generic = { error: 'Invalid email or password' };
  if (!u) { await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv'); log(null, 'LOGIN_FAILED', email, req.ip); return res.status(401).json(generic); }
  if (!u.email_verified) {
  return res.status(403).json({
    error: 'Please verify your email address before logging in.'
  });
}if (u.locked_until && new Date(u.locked_until) > new Date()) {
    log(u.id, 'LOGIN_LOCKED', email, req.ip);
    return res.status(423).json({ error: `Account locked. Try again after ${new Date(u.locked_until).toLocaleTimeString()}` });
  }
  if (!(await bcrypt.compare(password, u.password_hash))) {
    const attempts = u.failed_attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await pool.query(`UPDATE users SET failed_attempts=0, locked_until=NOW()+($2||' minutes')::interval WHERE id=$1`, [u.id, LOCK_MINUTES]);
      log(u.id, 'ACCOUNT_LOCKED', `${MAX_ATTEMPTS} failed attempts`, req.ip);
    } else await pool.query('UPDATE users SET failed_attempts=$2 WHERE id=$1', [u.id, attempts]);
    log(u.id, 'LOGIN_FAILED', email, req.ip);
    return res.status(401).json(generic);
  }
  if (u.mfa_enabled && !(req.body.mfa_code && totp.verify(u.mfa_secret, req.body.mfa_code))) {
    if (!req.body.mfa_code) return res.status(200).json({ mfa_required: true });
    log(u.id, 'MFA_FAILED', email, req.ip);
    return res.status(401).json({ error: 'Invalid MFA code' });
  }
  await pool.query('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=$1', [u.id]);
  req.session.regenerate(err => {                                      // prevents session fixation
    if (err) throw err;
    req.session.user = { id: u.id, role: u.role, full_name: u.full_name };
    log(u.id, 'LOGIN_OK', email, req.ip);
    res.json({ user: publicUser(u) });
  });
});


// Request a password-reset email
router.post('/forgot-password', loginLimiter, async (req, res) => {
  const email = v.clean(req.body.email, 150).toLowerCase();

  // Always return the same public response to prevent account enumeration.
  const response = {
    message: 'If an account exists with that email, password-reset instructions will be sent.'
  };

  if (!v.isEmail(email)) return res.json(response);

  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Password-reset email service is not configured yet.'
    });
  }

  const result = await pool.query(
    'SELECT id, full_name, email FROM users WHERE email = $1',
    [email]
  );

  const user = result.rows[0];

  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await pool.query(
      `DELETE FROM password_reset_tokens
       WHERE user_id = $1 OR expires_at < NOW() OR used_at IS NOT NULL`,
      [user.id]
    );

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [user.id, tokenHash]
    );

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${baseUrl}/#reset-password?token=${rawToken}`;

    try {
      await sendPasswordResetEmail(user.email, user.full_name, resetUrl);
      log(user.id, 'PASSWORD_RESET_REQUESTED', '', req.ip);
    } catch (error) {
      await pool.query(
        'DELETE FROM password_reset_tokens WHERE token_hash = $1',
        [tokenHash]
      );
      console.error('Password-reset email failed:', error.message);
      return res.status(503).json({
        error: 'Unable to send the reset email. Please try again later.'
      });
    }
  }

  return res.json(response);
});


// Verify reset token and save the new password
router.post('/reset-password', loginLimiter, async (req, res) => {
  const token = String(req.body.token || '').trim();
  const password = String(req.body.password || '');

  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(400).json({
      error: 'Invalid or expired password-reset link.'
    });
  }

  const pw = v.passwordProblem(password);
  if (pw) return res.status(400).json({ error: pw });

  const tokenHash = crypto.createHash('sha256')
    .update(token)
    .digest('hex');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT user_id
       FROM password_reset_tokens
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > NOW()
       FOR UPDATE`,
      [tokenHash]
    );

    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Invalid or expired password-reset link.'
      });
    }

    const userId = result.rows[0].user_id;
    const passwordHash = await bcrypt.hash(password, 12);

    await client.query(
      `UPDATE users
       SET password_hash = $2,
           failed_attempts = 0,
           locked_until = NULL
       WHERE id = $1`,
      [userId, passwordHash]
    );

    // Invalidate all reset links belonging to this account.
    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );

    await client.query('COMMIT');

    log(userId, 'PASSWORD_RESET_COMPLETED', '', req.ip);

    return res.json({
      message: 'Password successfully changed. You can now log in.'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.post('/logout', (req, res) => {
  const id = req.session.user?.id;
  req.session.destroy(() => { log(id, 'LOGOUT', '', req.ip); res.clearCookie('fc.sid'); res.json({ ok: true }); });
});

router.get('/me', async (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.user.id]);
  res.json({ user: r.rows[0] ? publicUser(r.rows[0]) : null });
});

// Profile management
router.put('/profile', requireLogin, async (req, res) => {
  const full_name = v.clean(req.body.full_name, 100), phone = v.clean(req.body.phone, 20), address = v.clean(req.body.address);
  if (full_name.length < 2 || !v.isPhone(phone)) return res.status(400).json({ error: 'Check your name and phone number' });
  await pool.query('UPDATE users SET full_name=$2, phone=$3, address=$4 WHERE id=$1', [req.session.user.id, full_name, phone, address]);
  log(req.session.user.id, 'PROFILE_UPDATE', '', req.ip);
  res.json({ ok: true });
});

router.put('/password', requireLogin, async (req, res) => {
  const r = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.session.user.id]);
  if (!(await bcrypt.compare(String(req.body.current || ''), r.rows[0].password_hash))) return res.status(400).json({ error: 'Current password is wrong' });
  const pw = v.passwordProblem(req.body.password);
  if (pw) return res.status(400).json({ error: pw });
  await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [req.session.user.id, await bcrypt.hash(req.body.password, 12)]);
  log(req.session.user.id, 'PASSWORD_CHANGED', '', req.ip);
  res.json({ ok: true });
});

// Optional Multi-Factor Authentication (TOTP)
router.post('/mfa/setup', requireLogin, async (req, res) => {
  const secret = totp.newSecret();
  await pool.query('UPDATE users SET mfa_secret=$2, mfa_enabled=FALSE WHERE id=$1', [req.session.user.id, secret]);
  res.json({ secret, uri: `otpauth://totp/FreshCart:${req.session.user.id}?secret=${secret}&issuer=FreshCart` });
});
router.post('/mfa/enable', requireLogin, async (req, res) => {
  const r = await pool.query('SELECT mfa_secret FROM users WHERE id=$1', [req.session.user.id]);
  if (!r.rows[0].mfa_secret || !totp.verify(r.rows[0].mfa_secret, req.body.code)) return res.status(400).json({ error: 'Invalid code' });
  await pool.query('UPDATE users SET mfa_enabled=TRUE WHERE id=$1', [req.session.user.id]);
  log(req.session.user.id, 'MFA_ENABLED', '', req.ip);
  res.json({ ok: true });
});
router.post('/mfa/disable', requireLogin, async (req, res) => {
  await pool.query('UPDATE users SET mfa_enabled=FALSE, mfa_secret=NULL WHERE id=$1', [req.session.user.id]);
  log(req.session.user.id, 'MFA_DISABLED', '', req.ip);
  res.json({ ok: true });
});
module.exports = router;
