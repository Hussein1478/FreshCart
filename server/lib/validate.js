// Server-side input validation helpers (Security: Input Validation)
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max = 255) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const isEmail = v => EMAIL.test(String(v || '')) && String(v).length <= 150;
const isPhone = v => /^\+?[0-9]{9,15}$/.test(String(v || ''));
// Strong password policy: 10+ chars, upper, lower, digit, symbol
const passwordProblem = p => {
  p = String(p || '');
  if (p.length < 10) return 'Password must be at least 10 characters';
  if (!/[a-z]/.test(p)) return 'Password needs a lowercase letter';
  if (!/[A-Z]/.test(p)) return 'Password needs an uppercase letter';
  if (!/[0-9]/.test(p)) return 'Password needs a digit';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Password needs a symbol';
  return null;
};
const posInt = v => Number.isInteger(+v) && +v > 0 ? +v : null;
const money = v => /^\d{1,8}(\.\d{1,2})?$/.test(String(v)) ? +v : null;
module.exports = { clean, isEmail, isPhone, passwordProblem, posInt, money };
