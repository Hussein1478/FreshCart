// Minimal RFC 6238 TOTP for optional Multi-Factor Authentication (no external dependency)
const crypto = require('crypto');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const newSecret = () => { let s = ''; for (const b of crypto.randomBytes(20)) s += B32[b % 32]; return s; };
const b32decode = s => { let bits = ''; for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const code = (secret, t = Date.now()) => {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(c).digest();
  const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
};
const verify = (secret, token) => [-1, 0, 1].some(w => crypto.timingSafeEqual(
  Buffer.from(code(secret, Date.now() + w * 30000)), Buffer.from(String(token).padStart(6, '0').slice(0, 6))));
module.exports = { newSecret, verify, code };
