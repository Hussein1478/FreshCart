require('dotenv').config();
// FreshCart - Supermarket Grocery Delivery System (Group 6)
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const express = require('express'), helmet = require('helmet'), session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');
const pool = require('./db/pool');

if (!process.env.SESSION_SECRET || !process.env.DB_PASSWORD) { console.error('Missing .env: copy .env.example to .env and fill it in.'); process.exit(1); }
const app = express();
const useTLS = process.env.TLS_KEY && process.env.TLS_CERT;               // HTTPS encryption when certs are supplied
const isProd = process.env.NODE_ENV === 'production';
if (isProd) app.set('trust proxy', 1);                                      // behind an HTTPS reverse proxy

app.disable('x-powered-by');
app.use(helmet({                                                            // CSP, HSTS, no-sniff, frame protection
 referrerPolicy: {
  policy: 'strict-origin-when-cross-origin'
},
crossOriginOpenerPolicy: {
  policy: 'same-origin-allow-popups'
},
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: [
  "'self'",
  "https://accounts.google.com",
  "https://unpkg.com"
],
    connectSrc: [
  "'self'",
  "https://accounts.google.com",
  "https://photon.komoot.io",
  "https://unpkg.com"
],
    scriptSrcAttr: ["'none'"],
    styleSrc: [
  "'self'",
  "'unsafe-inline'",
  "https://fonts.googleapis.com",
  "https://accounts.google.com",
  "https://unpkg.com"
],
    fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
    imgSrc: [
  "'self'",
  "data:",
  "blob:",
  "https://images.unsplash.com",
  "https://*.tile.openstreetmap.org"
],
    objectSrc: ["'none'"],
frameSrc: [
  "'self'",
  "https://accounts.google.com",
  "https://*.google.com"
],
frameAncestors: ["'none'"],
upgradeInsecureRequests: isProd || useTLS ? [] : null
  }
},
hsts: isProd || useTLS
  ? { maxAge: 31536000, includeSubDomains: true }
  : false

}));
if (isProd && !useTLS) app.use((req, res, next) => req.secure ? next() : res.redirect('https://' + req.headers.host + req.url));
app.use(express.json({
  limit: '20kb',
  verify(req, res, buf) {
    if (req.originalUrl.split('?')[0] === '/api/paystack/webhook') {
      req.rawBody = Buffer.from(buf);
    }
  }
}));
app.use(rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

app.use(session({                                                           // Secure session management
  store: new PgStore({ pool, tableName: 'session' }),
  name: 'fc.sid', secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: isProd || !!useTLS, maxAge: 1000 * 60 * 60 * 2 }   // Secure cookies
}));
// CSRF defence: requests containing data must use JSON.
app.use('/api', (req, res, next) => {
  const hasRequestBody =
    Number(req.headers['content-length'] || 0) > 0 ||
    Boolean(req.headers['transfer-encoding']);

  if (
    ['POST', 'PUT', 'DELETE'].includes(req.method) &&
    hasRequestBody &&
    !req.is('application/json')
  ) {
    return res.status(415).json({ error: 'JSON required' });
  }

  next();
});
const CLIENT = path.join(__dirname, '..', 'client');                         // client folder is served as static files
app.use(express.static(CLIENT));
const wrap = r => { r.stack.forEach(l => { if (l.route) l.route.stack.forEach(h => { const f = h.handle; if (f.constructor.name === 'AsyncFunction') h.handle = (q, s, n) => f(q, s, n).catch(n); }); }); return r; };
app.use('/api/auth', wrap(require('./routes/auth')));
app.use('/api/admin', wrap(require('./routes/admin')));
app.use('/api/paystack', wrap(require('./routes/paystack')));
app.use('/api', wrap(require('./routes/shop')));
app.use('/api/invoices', wrap(require('./routes/invoices')));
app.use('/api/delivery', wrap(require('./routes/delivery')));
app.use('/api/notifications', wrap(require('./routes/notifications')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong' }); });   // no stack traces leaked

const PORT = +(process.env.PORT || 3000);
const server = useTLS ? https.createServer({ key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) }, app) : http.createServer(app);
server.listen(PORT, '0.0.0.0', () => console.log(`FreshCart running on ${useTLS ? 'https' : 'http'}://0.0.0.0:${PORT}`));
