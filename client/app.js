'use strict';
// FreshCart front-end. All dynamic text passes through esc() (XSS protection); no inline scripts/styles (strict CSP).
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KES = n => 'KES ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const stars = n => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
// Real photographic fallbacks by product/category. Admins can override with an image URL.
const PRODUCT_PHOTOS = [
  { match: /tomato|vegetable|fruit|fresh produce|greens|spinach|onion|potato|carrot|avocado|mango|banana|apple|orange/i, url: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=700&q=82' },
  { match: /milk|dairy|yogurt|cheese|butter|cream/i, url: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=700&q=82' },
  { match: /oil|cooking|flour|rice|sugar|salt|cereal|pasta|beans|maize/i, url: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=700&q=82' },
  { match: /bread|bakery|cake|pastry/i, url: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=700&q=82' },
  { match: /meat|beef|chicken|fish|seafood/i, url: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=700&q=82' },
  { match: /drink|juice|water|soda|beverage|coffee|tea/i, url: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=700&q=82' },
  { match: /soap|detergent|clean|homecare|tissue/i, url: 'https://images.unsplash.com/photo-1585421514738-01798e348b17?auto=format&fit=crop&w=700&q=82' },
  { match: /snack|biscuit|chocolate|sweet|crisps/i, url: 'https://images.unsplash.com/photo-1621939514649-280e2aa2f2e5?auto=format&fit=crop&w=700&q=82' }
];
const DEFAULT_PRODUCT_PHOTO = 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=700&q=82';
function productPhoto(p) { const text = `${p.name || ''} ${p.category || ''}`; return p.image_url || PRODUCT_PHOTOS.find(x => x.match.test(text))?.url || DEFAULT_PRODUCT_PHOTO; }
function productImage(p, cls = 'product-photo') {
  return `<img
    class="${cls}"
    src="${esc(productPhoto(p))}"
    alt="${esc(p.name || 'FreshCart product')}"
    loading="lazy"
    referrerpolicy="no-referrer"
    data-fallback="${esc(DEFAULT_PRODUCT_PHOTO)}"
  >`;
  document.addEventListener('error', function (event) {
  const img = event.target;

  if (img instanceof HTMLImageElement && img.dataset.fallback) {
    img.onerror = null;
    img.src = img.dataset.fallback;
    delete img.dataset.fallback;
  }
}, true);
}let me = null, cats = [], state = { q: '', cat: '' }, mfaPending = null;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status });
  return d;
}
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type} border-0 show`;
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(msg)}</div></div>`;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 3500);
}
const fail = e => { toast(e.message, 'danger'); if (e.status === 401) { me = null; renderNav(); location.hash = '#login'; } };
const form = f => Object.fromEntries(new FormData(f).entries());
// Load and display the customer's saved delivery addresses
async function loadSavedAddresses() {
  const container = $('#savedAddresses');

  if (role() !== 'customer') {
    container.innerHTML = '<p class="text-muted">Please log in as a customer to manage delivery addresses.</p>';
    return;
  }

  try {
    const addresses = await api('/addresses');

    if (!addresses.length) {
      container.innerHTML = '<p class="text-muted">You have no saved delivery addresses yet.</p>';
      return;
    }

    container.innerHTML = addresses.map(a => `
      <div class="border rounded p-3 mb-2">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <strong>${esc(a.label)}</strong>
            ${a.is_default ? '<span class="badge bg-success ms-2">Default</span>' : ''}
            <div>${esc(a.address)}</div>
            <small class="text-muted">${esc(a.city)}, ${esc(a.country)}</small>
            ${a.instructions ? `<div class="small text-muted">${esc(a.instructions)}</div>` : ''}
          </div>
          ${!a.is_default ? `
            <button type="button" class="btn btn-sm btn-outline-success"
              data-act="setDefaultAddress" data-id="${esc(a.id)}">
              Set default
            </button>
          ` : ''}
        </div>
      </div>
    `).join('');
  } catch (error) {
    container.innerHTML = '<p class="text-danger">Could not load your saved addresses.</p>';
    fail(error);
  }
}
const role = () => me?.role;


function renderNav() {
  const l = [`<li class="nav-item"><a class="nav-link" href="#shop">Shop</a></li>`];

  if (role() === 'customer') {
    l.push(`<li class="nav-item"><a class="nav-link" href="#cart">Cart</a></li><li class="nav-item"><a class="nav-link" href="#orders">My Orders</a></li>`);
  }

  if (role() === 'admin') {
    l.push(`<li class="nav-item"><a class="nav-link" href="#admin">Admin Dashboard</a></li>`);
  }

  if (role() === 'vendor') {
    l.push(`<li class="nav-item"><a class="nav-link" href="#admin">Vendor Portal</a></li>`);
  }

  if (me) {
    l.push(`
      <li class="nav-item">
        <a class="nav-link" href="#notifications">
          Notifications
        </a>
      </li>
      <li class="nav-item">
        <a class="nav-link" href="#account">${esc(me.full_name.split(' ')[0])}</a>
      </li>
      <li class="nav-item">
        <button class="btn btn-sm btn-outline-light" data-act="logout">Logout</button>
      </li>
    `);
  } else {
    l.push(`<li class="nav-item"><a class="nav-link" href="#login">Login</a></li><li class="nav-item"><a class="btn btn-sm btn-light" href="#register">Register</a></li>`);
  }

  $('#navlinks').innerHTML = l.join('');
}


// ---------------- Views ----------------
// Handle successful Google Sign-In
async function handleGoogleSignIn(response) {
  console.log('GOOGLE CALLBACK FIRED');
  console.log('CREDENTIAL RECEIVED:', !!response?.credential);

  try {
    if (!response || !response.credential) {
      toast('Google sign-in failed. Please try again.', 'error');
      return;
    }

    const r = await api('/auth/google', 'POST', {
      credential: response.credential
    });

    me = r.user;
    renderNav();

    toast('Welcome to FreshCart, ' + me.full_name);

    location.hash =
  me.role === 'customer' ? '#shop' :
  me.role === 'delivery' ? '#delivery' :
  '#admin';

route();

  } catch (error) {
    console.error('Google sign-in error:', error);
    toast('Google sign-in failed. Please try again.', 'error');
  }
}const views = {
    'verify-email': async function () {
    const email = new URLSearchParams(
      location.hash.split('?')[1] || ''
    ).get('email') || '';

    $('#app').innerHTML = `
      <section class="auth-section">
        <div class="auth-card">
          <h2>Verify Your Email</h2>
          <p>Enter the six-digit verification code sent to your email address.</p>

          <form id="verifyEmailForm">
            <label>Email Address</label>
            <input type="email" name="email" required
              value="${email.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"
              placeholder="Your email address">

            <label>Verification Code</label>
            <input type="text" name="code" required
              inputmode="numeric" pattern="[0-9]{6}"
              maxlength="6" placeholder="Enter 6-digit code">

            <button type="submit">Verify Email</button>
</form>

<button type="button" id="resendVerificationBtn">
  Resend Verification Code
</button>

<p><a href="#login">Back to Login</a></p>
        </div>
      </section>
    `;
  },

    notifications: async function () {
      if (!me) {
        location.hash = '#login';
        return;
      }

      const notifications = await api('/notifications');
      const unread = notifications.filter(n => !n.read_at).length;

      $('#app').innerHTML = `
        <section class="container py-4">
          <div class="d-flex justify-content-between align-items-center mb-4">
            <div>
              <h3>Notifications</h3>
              <p class="text-muted mb-0">
                You have ${unread} unread notification(s).
              </p>
            </div>
            ${unread ? `
              <button class="btn btn-outline-success"
                data-act="readAllNotifications">
                Mark all as read
              </button>
            ` : ''}
          </div>

          ${notifications.length ? notifications.map(n => `
            <div class="card mb-3 ${n.read_at ? '' : 'border-success'}">
              <div class="card-body">
                <div class="d-flex justify-content-between">
                  <h6>${esc(n.title)}</h6>
                  ${n.read_at ? '' : '<span class="badge bg-success">New</span>'}
                </div>

                <p>${esc(n.message)}</p>

                <small class="text-muted">
                  ${new Date(n.created_at).toLocaleString()}
                </small>

                ${n.read_at ? '' : `
                  <div class="mt-2">
                    <button class="btn btn-sm btn-outline-success"
                      data-act="readNotification"
                      data-id="${n.id}">
                      Mark as read
                    </button>
                  </div>
                `}
              </div>
            </div>
          `).join('') : `
            <div class="card">
              <div class="card-body text-center py-5">
                <h5>No notifications yet</h5>
                <p class="text-muted mb-0">
                  Your FreshCart updates will appear here.
                </p>
              </div>
            </div>
          `}
        </section>
      `;
    },

  async shop() {
    const qs = new URLSearchParams({ q: state.q, category: state.cat });
    const [prods] = await Promise.all([api('/products?' + qs), cats.length ? 0 : api('/categories').then(c => cats = c)]);
    $('#app').innerHTML = `
      <div class="hero-strip">SAVE MORE WITH <span>FRESHCART</span></div>
      <section class="hero-carousel" aria-label="FreshCart promotions">
        <div class="hero-copy"><small>FRESH DEALS · GREAT VALUE</small><h1>Save more.<br><span>Eat fresher.</span></h1><p>Everyday groceries, fresh produce and household essentials delivered across Kenya.</p><a class="btn btn-fresh" href="#shop">Shop fresh deals</a></div>
        <div class="hero-visual" aria-hidden="true"><img src="https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=650&q=85" alt="Fresh vegetables" loading="lazy"></div><div class="hero-dots"><i></i><i></i><i></i><i></i></div>
      </section>
      <div class="section-heading"><div><h2>Shop by search & category</h2><p>Find your everyday essentials at great prices.</p></div></div>
      <div class="row g-2 mb-4">
        <div class="col-md-7"><form id="searchForm" class="input-group"><input class="form-control" name="q" value="${esc(state.q)}" placeholder="Search groceries…" maxlength="60"><button class="btn btn-success">Search</button></form></div>
        <div class="col-md-5"><select class="form-select" id="catSel"><option value="">All categories</option>${cats.map(c => `<option value="${c.id}" ${String(c.id) === String(state.cat) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="section-heading"><div><h2>Popular products</h2><p>Fresh picks selected for your basket.</p></div></div>
      <div class="row g-3">${prods.map(p => `
        <div class="col-6 col-md-4 col-lg-3"><div class="card card-product h-100 shadow-sm"><div class="card-body text-center">
          ${productImage(p)}
          <h6 class="mt-2 mb-0">${esc(p.name)}</h6>
          <div class="small text-muted">${esc(p.category || '')} · per ${esc(p.unit)}</div>
          <div class="stars small">${stars(p.avg_rating)} <span class="text-muted">(${esc(p.review_count)})</span></div>
          <div class="fw-bold my-1">${KES(p.price)}</div>
          ${p.stock > 0 ? `<div class="small ${p.stock <= 10 ? 'text-danger' : 'text-success'}">${p.stock <= 10 ? 'Only ' + p.stock + ' left' : 'In stock'}</div>` : '<div class="small text-danger">Out of stock</div>'}
          <div class="d-grid gap-1 mt-2"><button class="btn btn-sm btn-success" data-act="add" data-id="${p.id}" ${p.stock < 1 ? 'disabled' : ''}>Add to cart</button>
          <button class="btn btn-sm btn-outline-secondary" data-act="reviews" data-id="${p.id}" data-name="${esc(p.name)}">Reviews</button></div>
        </div></div></div>`).join('') || '<p class="text-muted">No products found.</p>'}</div>
      <div id="reviewBox" class="mt-4"></div>`;
  },


async login() {
  $('#app').innerHTML = `
    <div class="row justify-content-center py-4">
      <div class="col-12 col-sm-9 col-md-6 col-lg-4">
        <div class="card shadow-sm border-0">
          <div class="card-body p-4">

            <div class="text-center mb-4">
              <h3 class="fw-bold text-success mb-1">FreshCart</h3>
              <h5 class="mb-1">Welcome Back</h5>
              <p class="text-muted small mb-0">Log in to your account</p>
            </div>

            <form id="loginForm" class="vstack gap-3">

              <div>
                <label class="form-label small fw-semibold">Email Address</label>
                <input class="form-control" type="email"
                  name="email" placeholder="Enter your email"
                  required maxlength="150" autocomplete="username">
              </div>

              <div>
                <label class="form-label small fw-semibold">Password</label>
                <input class="form-control" type="password"
                  name="password" placeholder="Enter your password"
                  required autocomplete="current-password">
              </div>

              ${mfaPending ? `
                <input class="form-control" name="mfa_code"
                  placeholder="6-digit MFA code"
                  inputmode="numeric" maxlength="6" required autofocus>
              ` : ''}

              <div class="text-end">
                <a href="#forgot-password" class="small text-success">
                  Forgot Password?
                </a>
              </div>

              <button class="btn btn-success w-100 py-2 fw-bold">
                LOGIN
              </button>
            </form>

            <div class="d-flex align-items-center gap-3 my-4">
              <hr class="flex-grow-1">
              <span class="text-muted small">OR</span>
              <hr class="flex-grow-1">
            </div>

            <div id="googleSignInButton" class="d-flex justify-content-center"></div>

            <p class="text-center small mt-4 mb-0">
              New to FreshCart?
              <a href="#register" class="text-success fw-semibold">
                Create an Account
              </a>
            </p>

          </div>
        </div>
      </div>
    </div>`;

  try {
    const config = await api('/auth/google-client-id');

    if (!config.clientId) {
      console.error('Google Client ID is missing.');
      return;
    }

    const initializeGoogle = () => {
      const button = document.getElementById('googleSignInButton');

      if (!window.google || !button) return;

      google.accounts.id.initialize({
        client_id: config.clientId,
        callback: handleGoogleSignIn
      });

      google.accounts.id.renderButton(button, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        width: 280
      });
      console.log('GOOGLE BUTTON RENDERED');
console.log('GOOGLE CLIENT ID:', config.clientId);
console.log('GOOGLE BUTTON CONTENT:', button.innerHTML);
    };

    if (window.google && window.google.accounts) {
      initializeGoogle();
    } else {
      const googleScript = document.querySelector(
        'script[src="https://accounts.google.com/gsi/client"]'
      );

      if (googleScript) {
        googleScript.addEventListener('load', initializeGoogle, { once: true });
      }
    }
  } catch (error) {
    console.error('Google Sign-In initialization failed:', error);
  }
},




  'forgot-password': async function () {
    $('#app').innerHTML = `
      <div class="row justify-content-center">
        <div class="col-md-5">
          <div class="card shadow-sm">
            <div class="card-body">
              <h4>Forgot Password?</h4>
              <p class="text-muted">
                Enter your registered email address and we'll send you
                instructions to reset your password.
              </p>

              <form id="forgotPasswordForm" class="vstack gap-3">
                <input
                  class="form-control"
                  type="email"
                  name="email"
                  placeholder="Your email address"
                  maxlength="150"
                  autocomplete="email"
                  required
                >

                <button class="btn btn-success">
                  Send Reset Link
                </button>
              </form>

              <p class="mt-3 mb-0">
                <a href="#login">Back to Login</a>
              </p>
            </div>
          </div>
        </div>
      </div>`;
  },

    'reset-password': async function () {
    const token = new URLSearchParams(
      location.hash.split('?')[1] || ''
    ).get('token') || '';

    $('#app').innerHTML = `
      <div class="row justify-content-center">
        <div class="col-md-5">
          <div class="card shadow-sm">
            <div class="card-body">
              <h4>Reset Your Password</h4>
              <p class="text-muted small">
                Enter your new password below.
              </p>

              <form id="resetPasswordForm" class="vstack gap-3">
                <input type="hidden" name="token">

                <input
                  class="form-control"
                  type="password"
                  name="password"
                  placeholder="New password"
                  required
                  autocomplete="new-password"
                >

                <input
                  class="form-control"
                  type="password"
                  name="confirm_password"
                  placeholder="Confirm new password"
                  required
                  autocomplete="new-password"
                >

                <button class="btn btn-success">
                  Change Password
                </button>
              </form>

              <p class="mt-3 mb-0 small">
                <a href="#login">Back to Login</a>
              </p>
            </div>
          </div>
        </div>
      </div>`;

    $('#resetPasswordForm').elements.token.value = token;
  },

  async register() {

$('#app').innerHTML = `
  <div class="row justify-content-center">
    <div class="col-md-6 col-lg-5">
      <div class="card shadow-sm border-0">
        <div class="card-body p-4 p-md-5">

          <div class="text-center mb-4">
            <h3 class="fw-bold text-success">FreshCart</h3>
            <p class="text-muted mb-0">Create your account</p>
          </div>

          <div id="googleSignInButton"
               class="d-flex justify-content-center mb-4">
          </div>

          <div class="d-flex align-items-center gap-3 mb-4">
            <hr class="flex-grow-1">
            <span class="text-muted small">Or register with email</span>
            <hr class="flex-grow-1">
          </div>

          <form id="regForm" class="vstack gap-3">

            <input class="form-control" name="full_name"
              placeholder="Full name" required maxlength="100">

            <input class="form-control" type="email" name="email"
              placeholder="Email address" required maxlength="150">

            <input class="form-control" name="phone"
              placeholder="Phone e.g. 0712345678" required maxlength="20">

            <input class="form-control" name="address"
              placeholder="Delivery address" maxlength="255">

            <input class="form-control" type="password" name="password"
              placeholder="Password" required autocomplete="new-password">

            <div class="form-text">
              Minimum 10 characters with uppercase and lowercase letters,
              a digit and a symbol.
            </div>

            <button class="btn btn-success btn-lg w-100">
              Create Account
            </button>
          </form>

          <p class="text-center mt-4 mb-0">
            Already have an account?
            <a href="#login" class="fw-semibold">Login</a>
          </p>

        </div>
      </div>
    </div>
  </div>`;
    try {
      const config = await api('/auth/google-client-id');

      if (!config.clientId) {
        console.error('Google Client ID is missing.');
        return;
      }

      const initializeGoogle = () => {
        const button = document.getElementById('googleSignInButton');

        if (!window.google || !button) return;

        google.accounts.id.initialize({
          client_id: config.clientId,
          callback: handleGoogleSignIn
        });

        google.accounts.id.renderButton(button, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: 280
        });
      };

      if (window.google && window.google.accounts) {
        initializeGoogle();
      } else {
        const googleScript = document.querySelector(
          'script[src="https://accounts.google.com/gsi/client"]'
        );

        if (googleScript) {
          googleScript.addEventListener('load', initializeGoogle, { once: true });
        }
      }
    } catch (error) {
      console.error('Google Sign-In initialization failed:', error);
    }
  },
  async cart() {
    if (role() !== 'customer') return location.hash = '#login';
    const c = await api('/cart');
    $('#app').innerHTML = `<h4>Shopping cart</h4>` + (c.items.length ? `
      <table class="table align-middle"><thead><tr><th>Item</th><th>Price</th><th>Qty</th><th>Subtotal</th><th></th></tr></thead><tbody>
      ${c.items.map(i => `<tr><td class="cart-product-cell">${productImage(i, 'cart-product-photo')}<span>${esc(i.name)}</span></td><td>${KES(i.price)}</td>
        <td><input class="form-control form-control-sm w-qty" type="number" min="1" max="${i.stock}" value="${i.quantity}" data-act="qty" data-id="${i.product_id}"></td>
        <td>${KES(i.price * i.quantity)}</td><td><button class="btn btn-sm btn-outline-danger" data-act="remove" data-id="${i.product_id}">Remove</button></td></tr>`).join('')}
      </tbody><tfoot><tr><th colspan="3" class="text-end">Total</th><th>${KES(c.total)}</th><th></th></tr></tfoot></table>
      <a class="btn btn-success" href="#checkout">Proceed to checkout</a>` : '<p class="text-muted">Your cart is empty. <a href="#shop">Start shopping</a></p>');
  },

async checkout() {
  if (role() !== 'customer') return location.hash = '#login';

  const c = await api('/cart');
  if (!c.items.length) return location.hash = '#cart';

  const addresses = await api('/addresses');
  const feeData = await api('/delivery-fee');

  const subtotal = Number(c.total);
const deliveryFee = Number(feeData.delivery_fee);
const grandTotal = subtotal + deliveryFee;

  $('#app').innerHTML = `
    <h4>Checkout</h4>
    <div class="row g-4">
      <div class="col-md-7">
        <form id="checkoutForm" class="vstack gap-3">

          <select class="form-select" name="address" id="checkoutAddress" required>
            <option value="">Choose a delivery address</option>
            ${addresses.map(a => `
              <option value="${esc(a.id)}" ${a.is_default ? 'selected' : ''}>
                ${esc(a.label)} - ${esc(a.address)}, ${esc(a.city)}
                ${a.is_default ? '(Default)' : ''}
              </option>
            `).join('')}
          </select>

          ${addresses.length === 0 ? `
            <p class="text-danger small">
              You have no saved delivery addresses. Please add one before checkout.
            </p>
            <a href="#" class="btn btn-outline-success" data-act="changeAddress">
              Add delivery address
            </a>
          ` : ''}

          <select class="form-select" name="slot">
            <option>Today 4pm–6pm</option>
            <option>Tomorrow 8am–10am</option>
            <option>Tomorrow 12pm–2pm</option>
            <option>Tomorrow 4pm–6pm</option>
          </select>
          <div>
  <label class="form-label">Discount code (optional)</label>
  <div class="input-group">
    <input
      class="form-control"
      type="text"
      name="promo_code"
      id="promoCode"
      placeholder="Enter promo code, e.g. FRESH10"
      maxlength="40"
      autocomplete="off"
    >
    <button class="btn btn-outline-success" type="button" data-act="applyPromo">
  Apply Code
</button>
  </div>
  <small class="text-muted">
    Enter a valid FreshCart discount code to save on your order.
  </small>
  <div id="promoMessage" class="small mt-2"></div>
</div>

          <select class="form-select" name="method" id="payMethod">
            <option>Mobile Money</option>
            <option>Credit Card</option>
            <option>PayPal</option>
          </select>

          <div id="payFields"></div>

          <button class="btn btn-success">
            Pay ${KES(grandTotal)} & place order
          </button>
        </form>
      </div>

      <div class="col-md-5">
        <div class="card">
          <div class="card-body">
            <h6>Order summary</h6>

            ${c.items.map(i => `
              <div class="d-flex justify-content-between small mb-2">
                <span>${esc(i.quantity)} × ${esc(i.name)}</span>
                <span>${KES(i.price * i.quantity)}</span>
              </div>
            `).join('')}

            <hr>

            <div class="d-flex justify-content-between">
              <span>Products subtotal</span>
              <span>${KES(subtotal)}</span>
            </div>

            <div class="d-flex justify-content-between mt-2">
  <span>Delivery fee</span>
  <span>${KES(deliveryFee)}</span>
</div>

<div class="d-flex justify-content-between mt-2" id="discountRow" style="display:none;">
  <span>Discount</span>
  <span class="text-success" id="discountAmount">- ${KES(0)}</span>
</div>

<hr>

            <div class="d-flex justify-content-between fw-bold">
  <span>Grand total</span>
  <span
    id="checkoutGrandTotal"
    data-delivery-fee="${deliveryFee}"
  >${KES(grandTotal)}</span>
</div>

            <p class="small text-muted mt-3 mb-0">
              Delivery fees are set by FreshCart administration.
            </p>
            <p class="small text-muted mt-2 mb-0">
              Demonstration payment gateway – no real money is moved and card details are never stored.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  payFields();
},


async orders() {
  if (role() !== 'customer') return location.hash = '#login';

  const os = await api('/orders');
  const steps = ['Placed', 'Packed', 'Out for Delivery', 'Delivered'];

  $('#app').innerHTML = `<h4>My orders</h4>` + (os.map(o => {
    const subtotal = o.items.reduce(
      (sum, i) => sum + Number(i.price) * Number(i.quantity), 0
    );

    const deliveryFee = Number(o.delivery_fee || 0);
    const discount = Number(o.discount_amount || 0);

    return `
      <div class="card mb-3">
        <div class="card-body">

          <div class="d-flex justify-content-between flex-wrap">
            <strong>Order #${o.id}</strong>
            <span class="text-muted small">
              ${new Date(o.created_at).toLocaleString()}
            </span>
          </div>

          ${o.status === 'Cancelled'
            ? '<span class="badge text-bg-danger my-2">Cancelled</span>'
            : `<div class="progress my-2">
                <div class="progress-bar bg-success progress-w-${steps.indexOf(o.status) + 1}">
                  ${esc(o.status)}
                </div>
              </div>`
          }

          <ul class="small mb-2">
            ${o.items.map(i => `
              <li>
                ${esc(i.quantity)} × ${esc(i.name)} – ${KES(i.price * i.quantity)}
                ${o.status === 'Delivered' && i.product_id
                  ? ` <button class="btn btn-link btn-sm p-0"
                      data-act="rate"
                      data-id="${i.product_id}"
                      data-name="${esc(i.name)}">Rate</button>`
                  : ''}
              </li>
            `).join('')}
          </ul>

          <div class="border rounded p-3 mt-3">
            <h6>Order payment summary</h6>

            <div class="d-flex justify-content-between small mb-2">
              <span>Products subtotal</span>
              <span>${KES(subtotal)}</span>
            </div>

            <div class="d-flex justify-content-between small mb-2">
              <span>Delivery fee</span>
              <span>${KES(deliveryFee)}</span>
            </div>

            <div class="d-flex justify-content-between small mb-2">
              <span>Discount</span>
              <span>-${KES(discount)}</span>
            </div>

            <hr>

            <div class="d-flex justify-content-between fw-bold">
              <span>Order total</span>
              <span class="text-success">${KES(o.total)}</span>
            </div>
          </div>

          <div class="small text-muted mt-3">
            ${esc(o.method)} (${esc(o.reference)}) ·
            ${esc(o.delivery_slot)} · ${esc(o.delivery_address)}
          </div>

          <div class="card bg-light border-0 mt-3">
            <div class="card-body">
              <h6 class="text-success">Delivery Tracking</h6>

              <p class="mb-1">
                <strong>Delivery progress:</strong>
                <span class="badge text-bg-success">
                  ${esc(o.delivery_status || 'Awaiting Assignment')}
                </span>
              </p>

              <p class="mb-1">
                <strong>Delivery personnel:</strong>
                ${esc(o.delivery_person || 'Not yet assigned')}
              </p>

              ${o.delivery_phone ? `
                <p class="mb-0">
                  <strong>Contact:</strong>
                  <a href="tel:${esc(o.delivery_phone)}">
                    ${esc(o.delivery_phone)}
                  </a>
                </p>
              ` : ''}
            </div>
          </div>

          ${o.status === 'Placed'
            ? `<button class="btn btn-sm btn-outline-danger mt-2"
                data-act="cancel" data-id="${o.id}">Cancel order</button>`
            : ''
          }

          <button class="btn btn-sm btn-outline-success mt-2"
            data-act="downloadInvoice" data-id="${o.id}">
            Download Invoice (PDF)
          </button>

        </div>
      </div>
    `;
  }).join('') || '<p class="text-muted">No orders yet.</p>') +
  '<div id="reviewBox"></div>';
},

  async account() {
    if (!me) return location.hash = '#login';
    $('#app').innerHTML = `<div class="row g-4"><div class="col-md-6"><div class="card"><div class="card-body"><h5>Profile</h5>
      <form id="profileForm" class="vstack gap-2"><input class="form-control" name="full_name" value="${esc(me.full_name)}" required maxlength="100">
      <input class="form-control" value="${esc(me.email)}" disabled><input class="form-control" name="phone" value="${esc(me.phone || '')}" required>
      <input class="form-control" name="address" value="${esc(me.address || '')}" maxlength="255"><button class="btn btn-success">Save profile</button></form></div></div></div>
      <div class="col-md-6"><div class="card mb-3"><div class="card-body"><h5>Change password</h5>
      <form id="pwForm" class="vstack gap-2"><input class="form-control" type="password" name="current" placeholder="Current password" required>
      <input class="form-control" type="password" name="password" placeholder="New password" required autocomplete="new-password"><button class="btn btn-success">Update password</button></form></div></div>
      <div class="card"><div class="card-body"><h5>Multi-Factor Authentication <span class="badge text-bg-secondary">Optional</span></h5>
      <p class="small text-muted">Status: ${me.mfa_enabled ? '<strong class="text-success">Enabled</strong>' : 'Disabled'}</p>
      <div id="mfaBox">${me.mfa_enabled ? '<button class="btn btn-outline-danger btn-sm" data-act="mfaOff">Disable MFA</button>' : '<button class="btn btn-outline-success btn-sm" data-act="mfaSetup">Set up authenticator app</button>'}</div></div></div></div></div>`;
  },
  async admin() {
    if (!['admin', 'vendor'].includes(role())) return location.hash = '#login';
    const isAdmin = role() === 'admin';
    const tabs = isAdmin
  ? ['dashboard', 'products', 'orders', 'reports', 'staff', 'delivery', 'discounts']
  : ['products', 'reports'];
    const tab = tabs.includes(state.tab) ? state.tab : tabs[0];
    let body = '';
    if (tab === 'dashboard') {
      const d = await api('/admin/dashboard');
      body = `<div class="row g-3">${[['Revenue', KES(d.revenue)], ['Orders', d.orders], ['Active deliveries', d.pending], ['Customers', d.customers], ['Low stock items', d.low_stock]].map(([k, x]) => `<div class="col-6 col-md"><div class="card text-center"><div class="card-body"><div class="stat">${esc(x)}</div><div class="text-muted small">${k}</div></div></div></div>`).join('')}</div>`;
    } else if (tab === 'products') {
      const [ps] = await Promise.all([api('/admin/products'), cats.length ? 0 : api('/categories').then(c => cats = c)]);
      body = `<h5>${isAdmin ? 'Product management' : 'My products'}</h5>
        <form id="prodForm" class="row g-2 mb-3"><input type="hidden" name="id">
          <div class="col-md-3"><input class="form-control" name="name" placeholder="Name" required maxlength="120"></div>
          <div class="col-md-2"><input class="form-control" name="price" placeholder="Price" required></div>
          <div class="col-md-1"><input class="form-control" name="stock" placeholder="Stock" required></div>
          <div class="col-md-1"><input class="form-control" name="unit" placeholder="Unit" maxlength="20"></div>
          <div class="col-md-3"><input class="form-control" type="url" name="image_url" placeholder="Product image URL (optional)" maxlength="500"></div>
          <div class="col-md-2"><select class="form-select" name="category_id">${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
          <div class="col-md-2 d-grid"><button class="btn btn-success">Save product</button></div>
          <div class="col-12"><input class="form-control" name="description" placeholder="Description" maxlength="500"></div></form>
        ${isAdmin ? `<form id="catForm" class="input-group input-group-sm mb-3 w-catform"><input class="form-control" name="name" placeholder="New category" required><button class="btn btn-outline-success">Add category</button></form>` : ''}
        <div class="table-responsive"><table class="table table-sm"><thead><tr><th>ID</th><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody>
        ${ps.map(p => `<tr><td>${p.id}</td><td class="admin-product-cell">${productImage(p, 'admin-product-photo')} ${esc(p.name)}</td><td>${esc(p.category || '-')}</td><td>${KES(p.price)}</td><td>${p.stock}</td>
        <td class="text-end"><button class="btn btn-sm btn-outline-primary" data-act="editProd" data-p='${esc(JSON.stringify(p))}'>Edit</button> <button class="btn btn-sm btn-outline-danger" data-act="delProd" data-id="${p.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
    } else if (tab === 'orders') {
      const os = await api('/admin/orders');
const ds = await api('/admin/delivery-staff');
const S = ['Placed', 'Packed', 'Out for Delivery', 'Delivered', 'Cancelled'];
      body = `<h5>Order management</h5><div class="table-responsive"><table class="table table-sm"><thead><tr>
  <th>#</th>
  <th>Customer</th>
  <th>Total</th>
  <th>Payment</th>
  <th>Address / Slot</th>
  <th>Status</th>
  <th>Delivery Staff</th>
</tr>
      ${os.map(o => `<tr><td>${o.id}</td><td>${esc(o.full_name)}<div class="small text-muted">${esc(o.phone)}</div></td><td>${KES(o.total)}</td><td>${esc(o.method)}<div class="small text-muted">${esc(o.reference)}</div></td>
      <td>${esc(o.delivery_address)}<div class="small text-muted">${esc(o.delivery_slot)}</div></td>
      <td>
  <select class="form-select form-select-sm" data-act="status" data-id="${o.id}">
    ${S.map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
  </select>
</td>
<td>
  <select class="form-select form-select-sm" data-act="assign-delivery" data-id="${o.id}">
    <option value="">Select delivery staff</option>
    ${ds.map(d => `<option value="${d.id}">${esc(d.full_name)}</option>`).join('')}
  </select>
</td>
</tr>`).join('')}</tbody></table></div>`;
    } else if (tab === 'reports') {
      const inv = await api('/admin/reports/inventory');
      const tbl = (h, rows) => `<div class="table-responsive"><table class="table table-sm"><thead><tr>${h.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      body = '<h5>Inventory report</h5>' + tbl(['Product', 'Category', 'Stock', 'Price', 'Stock value', ''], inv.map(i => [esc(i.name), esc(i.category || '-'), i.stock, KES(i.price), KES(i.stock_value), i.low ? '<span class="badge text-bg-danger">Low</span>' : '']));
      if (isAdmin) {
        const [s, c] = await Promise.all([api('/admin/reports/sales'), api('/admin/reports/customers')]);
        body += '<h5 class="mt-4">Sales report – daily</h5>' + tbl(['Day', 'Orders', 'Revenue'], s.daily.map(r => [r.day, r.orders, KES(r.revenue)]))
          + '<h5 class="mt-4">Sales report – top products</h5>' + tbl(['Product', 'Units', 'Revenue'], s.by_product.map(r => [esc(r.name), r.units, KES(r.revenue)]))
          + '<h5 class="mt-4">Sales report – by payment method</h5>' + tbl(['Method', 'Payments', 'Amount'], s.by_method.map(r => [esc(r.method), r.payments, KES(r.amount)]))
          + '<h5 class="mt-4">Customer report</h5>' + tbl(['Customer', 'Email', 'Joined', 'Orders', 'Spent'], c.map(r => [esc(r.full_name), esc(r.email), r.joined, r.orders, KES(r.spent)]));
      }
    } else if (tab === 'staff') {
      const logs = await api('/admin/logs');
      body = `<h5>Create staff account</h5>
<form id="staffForm" class="row g-2 mb-4">
  <div class="col-md-2">
    <input class="form-control" name="full_name"
      placeholder="Full name" required>
  </div>

  <div class="col-md-2">
    <input class="form-control" type="email" name="email"
      placeholder="Email" required>
  </div>

  <div class="col-md-2">
    <input class="form-control" type="tel" name="phone"
      placeholder="Phone e.g. 0712345678"
      pattern="(?:\+254|0)(?:7|1)[0-9]{8}"
      title="Enter a valid Kenyan phone number">
  </div>

  <div class="col-md-2">
    <input class="form-control" type="password" name="password"
      placeholder="Password" required
      autocomplete="new-password">
  </div>

  <div class="col-md-2">
    <select class="form-select" name="role">
      <option value="vendor">Vendor (Supplier)</option>
      <option value="admin">Administrator</option>
      <option value="delivery">Delivery Personnel</option>
    </select>
  </div>

  <div class="col-md-2 d-grid">
    <button class="btn btn-success">Create</button>
  </div>
</form>

        <h5>Activity log (latest 100)</h5><div class="table-responsive"><table class="table table-sm small"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Detail</th><th>IP</th></tr></thead><tbody>
        ${logs.map(l => `<tr><td>${new Date(l.created_at).toLocaleString()}</td><td>${esc(l.email || '-')}</td><td>${esc(l.action)}</td><td>${esc(l.detail)}</td><td>${esc(l.ip)}</td></tr>`).join('')}</tbody></table></div>`;
    }

else if (tab === 'delivery') {
  const settings = await api('/admin/delivery-settings');

  body = `
    <div class="card shadow-sm" style="max-width:600px">
      <div class="card-body">
        <h5>Delivery Fee Settings</h5>

        <p class="text-muted">
          Set the delivery fee customers will pay when placing orders.
        </p>

        <form id="deliveryFeeForm" class="vstack gap-3">
          <div>
            <label class="form-label">Delivery fee (KES)</label>
            <input
              type="number"
              class="form-control"
              name="delivery_fee"
              value="${esc(settings.delivery_fee)}"
              min="0"
              max="1000000"
              step="0.01"
              required
            >
          </div>

          <button class="btn btn-success">
            Save delivery fee
          </button>
        </form>

        <hr>

        <h6>Last update information</h6>

        <p class="small mb-1">
          <strong>Last updated:</strong>
          ${settings.updated_at
            ? new Date(settings.updated_at).toLocaleString()
            : 'Not available'}
        </p>

        <p class="small mb-0">
          <strong>Updated by:</strong>
          ${esc(settings.updated_by_name || 'Initial system setting')}
        </p>
      </div>
    </div>
  `;
}


else if (tab === 'discounts') {
  const promos = await api('/admin/promo-codes');

  body = `
    <div class="card shadow-sm mb-4">
      <div class="card-body">
        <h5>Create Discount Code</h5>
        <p class="text-muted">
          Create percentage or fixed-value discounts for customers.
        </p>

        <form id="promoCodeForm" class="row g-3">
          <div class="col-md-4">
            <label class="form-label">Promo code</label>
            <input class="form-control" name="code"
              placeholder="e.g. FRESH10" maxlength="40" required>
          </div>

          <div class="col-md-4">
            <label class="form-label">Description</label>
            <input class="form-control" name="description"
              placeholder="Optional description" maxlength="255">
          </div>

          <div class="col-md-4">
            <label class="form-label">Discount type</label>
            <select class="form-select" name="discount_type" required>
              <option value="percent">Percentage (%)</option>
              <option value="fixed">Fixed amount (KES)</option>
            </select>
          </div>

          <div class="col-md-4">
            <label class="form-label">Discount value</label>
            <input type="number" class="form-control"
              name="discount_value" min="0.01" step="0.01" required>
          </div>

          <div class="col-md-4">
            <label class="form-label">Minimum order (KES)</label>
            <input type="number" class="form-control"
              name="minimum_order" value="0" min="0" step="0.01">
          </div>

          <div class="col-md-4">
            <label class="form-label">Usage limit</label>
            <input type="number" class="form-control"
              name="usage_limit" min="1" step="1"
              placeholder="Unlimited if blank">
          </div>

          <div class="col-md-6">
            <label class="form-label">Starts at (optional)</label>
            <input type="datetime-local" class="form-control"
              name="starts_at">
          </div>

          <div class="col-md-6">
            <label class="form-label">Expires at (optional)</label>
            <input type="datetime-local" class="form-control"
              name="expires_at">
          </div>

          <div class="col-12">
            <button class="btn btn-success">
              Create discount code
            </button>
          </div>
        </form>
      </div>
    </div>

    <div class="card shadow-sm">
      <div class="card-body">
        <h5>Existing Discount Codes</h5>

        <div class="table-responsive">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Minimum order</th>
                <th>Usage</th>
                <th>Expiry</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${promos.map(p => `
                <tr>
                  <td>
                    <strong>${esc(p.code)}</strong>
                    <div class="small text-muted">
                      ${esc(p.description || '')}
                    </div>
                  </td>
                  <td>
                    ${p.discount_type === 'percent'
                      ? esc(p.discount_value) + '%'
                      : KES(p.discount_value)}
                  </td>
                  <td>${KES(p.minimum_order)}</td>
                  <td>
                    ${p.usage_count}
                    / ${p.usage_limit ?? 'Unlimited'}
                  </td>
                  <td>
                    ${p.expires_at
                      ? new Date(p.expires_at).toLocaleString()
                      : 'No expiry'}
                  </td>
                  <td>
                    <span class="badge ${p.active
                      ? 'bg-success'
                      : 'bg-secondary'}">
                      ${p.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button class="btn btn-sm ${p.active
                      ? 'btn-outline-danger'
                      : 'btn-outline-success'}"
                      data-act="promoStatus"
                      data-id="${p.id}"
                      data-active="${!p.active}">
                      ${p.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              `).join('')}
              ${promos.length ? '' : `
                <tr>
                  <td colspan="7" class="text-center text-muted">
                    No discount codes created yet.
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}


    $('#app').innerHTML = `<ul class="nav nav-pills mb-3">${tabs.map(t => `<li class="nav-item"><button class="nav-link ${t === tab ? 'active' : ''} text-capitalize" data-act="tab" data-tab="${t}">${t}</button></li>`).join('')}</ul>${body}`;
  },

  // Delivery personnel dashboard
  async delivery() {
    if (role() !== 'delivery') {
      location.hash = '#login';
      return;
    }

    const orders = await api('/delivery/my-orders');

    const statuses = [
      'Assigned',
      'Picked Up',
      'Out for Delivery',
      'Delivered'
    ];

    $('#app').innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h4>Delivery Dashboard</h4>
          <p class="text-muted mb-0">Manage your assigned customer deliveries.</p>
        </div>
        <button class="btn btn-outline-success" onclick="location.reload()">
          Refresh
        </button>
      </div>

      <div class="card shadow-sm">
        <div class="card-body">
          <h5>My Assigned Orders (${orders.length})</h5>

          ${orders.length ? `
            <div class="table-responsive">
              <table class="table table-striped align-middle">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Delivery Address</th>
                    <th>Delivery Slot</th>
                    <th>Total</th>
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  ${orders.map(o => `
                    <tr>
                      <td>#${o.order_id}</td>
                      <td>
                        <strong>${esc(o.customer_name)}</strong>
                        <div class="small">
                          <a href="tel:${esc(o.customer_phone || '')}">
                            ${esc(o.customer_phone || 'No phone provided')}
                          </a>
                        </div>
                      </td>
                      <td>${esc(o.delivery_address)}</td>
                      <td>${esc(o.delivery_slot || 'Not specified')}</td>
                      <td>${KES(o.total)}</td>
                      <td>
                        <select
                          class="form-select form-select-sm"
                          data-act="delivery-status"
                          data-id="${o.order_id}">
                          ${statuses.map(s => `
                            <option value="${s}"
                              ${s === o.delivery_status ? 'selected' : ''}>
                              ${s}
                            </option>
                          `).join('')}
                        </select>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="alert alert-info mb-0">
              You currently have no assigned deliveries.
            </div>
          `}
        </div>
      </div>
    `;
  }
};

function payFields() {
  const m = $('#payMethod')?.value, box = $('#payFields'); if (!box) return;
  box.innerHTML = m === 'Mobile Money' ? '<input class="form-control" name="pay_phone" placeholder="Mobile money number e.g. 0712345678" required>'
    : m === 'Credit Card' ? '<div class="vstack gap-2"><input class="form-control" name="pay_number" placeholder="Card number" inputmode="numeric" maxlength="23" autocomplete="off" required><div class="row g-2"><div class="col"><input class="form-control" name="pay_expiry" placeholder="MM/YY" maxlength="5" required></div><div class="col"><input class="form-control" name="pay_cvv" placeholder="CVV" inputmode="numeric" maxlength="4" autocomplete="off" required></div></div></div>'
    : '<input class="form-control" type="email" name="pay_email" placeholder="PayPal email" required>';
}
async function route() {
  const name = (location.hash || '#shop').slice(1).split('?')[0];
  const policy = {
    privacy: ['Privacy Policy', 'FreshCart uses customer information to process orders, coordinate delivery, secure accounts and provide customer support. We only request information needed to operate the service. Payment credentials must be handled by the selected payment provider; FreshCart should not store card security codes or raw card details.'],
    terms: ['Terms & Conditions', 'By using FreshCart you agree to provide accurate account, contact and delivery information. Product availability, prices and delivery slots are confirmed at checkout. Orders are subject to stock availability and the payment status confirmed by the payment provider.'],
    refunds: ['Refund & Return Policy', 'Contact FreshCart customer care promptly if an item is missing, damaged, incorrect or unsuitable. Requests are reviewed against the order and applicable consumer-protection requirements. Approved refunds are returned through the original payment channel where supported. Perishable grocery returns may require prompt reporting and evidence.'],
    'delivery-policy': ['Delivery Policy', 'FreshCart delivery is currently limited to locations within Kenya. Delivery fees are shown before payment and may depend on distance, order value and the delivery zone. Available delivery windows are displayed during checkout. Customers should provide accurate location details and delivery instructions.'],
    about: ['About FreshCart', 'FreshCart is a Kenyan online grocery shopping concept focused on convenient access to everyday groceries, fresh produce and household essentials.'],
    contact: ['Contact FreshCart', 'Phone: +254 799 726 409 · Email: customerservices@freshcart.co.ke · Location: Oludhe Tower, Kilimani, Nairobi, Kenya.']
  };
  if (policy[name]) { const [title, body] = policy[name]; $('#app').innerHTML = `<div class="card shadow-sm mx-auto" style="max-width:850px"><div class="card-body p-4"><a href="#shop" class="small">← Back to shopping</a><h2 class="mt-3 text-success">${esc(title)}</h2><p class="mt-3">${esc(body)}</p><p class="small text-muted">Please review and approve these policy terms against FreshCart's actual business operations before publishing.</p></div></div>`; window.scrollTo(0,0); return; }
  try { await (views[name] || views.shop)(); } catch (e) { fail(e); }
  window.scrollTo(0, 0);
}
async function showReviews(id, name, withForm) {
  const rs = await api(`/products/${id}/reviews`);
  $('#reviewBox').innerHTML = `<div class="card"><div class="card-body"><h6>Reviews: ${esc(name)}</h6>
    ${rs.map(r => `<div class="border-bottom py-1"><span class="stars">${stars(r.rating)}</span> <strong>${esc(r.full_name)}</strong><div class="small">${esc(r.comment)}</div></div>`).join('') || '<p class="small text-muted">No reviews yet.</p>'}
    ${withForm ? `<form id="reviewForm" class="row g-2 mt-2" data-id="${id}"><div class="col-md-2"><select class="form-select" name="rating"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></div>
    <div class="col-md-8"><input class="form-control" name="comment" placeholder="Your feedback" maxlength="500"></div><div class="col-md-2 d-grid"><button class="btn btn-success">Submit</button></div></form>` : ''}</div></div>`;
  $('#reviewBox').scrollIntoView({ behavior: 'smooth' });
}

// ---------------- Events (delegated; no inline handlers) ----------------
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  const act = b.dataset.act, id = b.dataset.id;

    try {
      if (act === 'applyPromo') {
  const input = document.getElementById('promoCode');
  const message = document.getElementById('promoMessage');
  const discountRow = document.getElementById('discountRow');
  const discountAmount = document.getElementById('discountAmount');
  const grandTotalEl = document.getElementById('checkoutGrandTotal');

  const code = input.value.trim().toUpperCase();

  if (!code) {
    message.textContent = 'Please enter a discount code.';
    message.className = 'small mt-2 text-danger';
    return;
  }

  const result = await api('/validate-promo', 'POST', { code });

  const subtotal = Number(result.subtotal);
  const discount = Number(result.discount_amount);
  const deliveryFee = Number(grandTotalEl.dataset.deliveryFee);

  discountRow.style.display = 'flex';
  discountAmount.textContent = '- ' + KES(discount);
  grandTotalEl.textContent = KES(subtotal - discount + deliveryFee);

  input.value = result.code;
  message.textContent = result.message;
  message.className = 'small mt-2 text-success';
}
else if (act === 'readNotification') {
  await api('/notifications/' + encodeURIComponent(id) + '/read', 'PUT', {});
  route();
}
else if (act === 'readAllNotifications') {
    await api('/notifications/read-all', 'PUT', {});
    route();
  }
  else if (act === 'downloadInvoice') {
    window.open('/api/invoices/' + encodeURIComponent(id), '_blank');
  }
  else if (act === 'changeAddress') {
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('addressModal'));
  modal.show();
  await loadSavedAddresses();
}
    else if (act === 'setDefaultAddress') {
  await api('/addresses/' + id + '/default', 'PATCH', {});
  await loadSavedAddresses();

  const addresses = await api('/addresses');
  const selected = addresses.find(a => a.is_default);

  if (selected) {
    $('#deliveryLabel').textContent = selected.city + ', Kenya';
  }

  toast('Default delivery address updated.');
}else if (act === 'logout') { await api('/auth/logout', 'POST', {}); me = null; renderNav(); location.hash = '#shop'; }
    else if (act === 'add') { if (role() !== 'customer') { toast('Please log in as a customer to shop', 'warning'); return location.hash = '#login'; } await api('/cart', 'POST', { product_id: id, quantity: 1 }); toast('Added to cart'); }
    else if (act === 'remove') { await api('/cart/' + id, 'DELETE'); route(); }
    else if (act === 'reviews') await showReviews(id, b.dataset.name, false);
    else if (act === 'rate') await showReviews(id, b.dataset.name, true);
    else if (act === 'cancel') { if (confirm('Cancel this order?')) { await api(`/orders/${id}/cancel`, 'POST', {}); toast('Order cancelled'); route(); } }
    else if (act === 'promoStatus') {
  const active = b.dataset.active === 'true';

  await api('/admin/promo-codes/' + encodeURIComponent(id) + '/status', 'PUT', {
    active
  });

  toast(active ? 'Discount code activated.' : 'Discount code deactivated.');
  route();
}
    else if (act === 'tab') { state.tab = b.dataset.tab; route(); }
    else if (act === 'editProd') { const p = JSON.parse(b.dataset.p), f = $('#prodForm'); for (const k of ['id', 'name', 'price', 'stock', 'unit', 'image_url', 'category_id', 'description']) f.elements[k].value = p[k] ?? ''; window.scrollTo(0, 0); }
    else if (act === 'delProd') { if (confirm('Delete this product?')) { await api('/admin/products/' + id, 'DELETE'); route(); } }
    else if (act === 'mfaSetup') { const d = await api('/auth/mfa/setup', 'POST', {}); $('#mfaBox').innerHTML = `<p class="small">Add this key to your authenticator app (Google Authenticator, Authy…):</p><code class="user-select-all">${esc(d.secret)}</code>
      <form id="mfaForm" class="input-group input-group-sm mt-2"><input class="form-control" name="code" placeholder="6-digit code" maxlength="6" required><button class="btn btn-success">Enable</button></form>`; }
    else if (act === 'mfaOff') { await api('/auth/mfa/disable', 'POST', {}); me.mfa_enabled = false; toast('MFA disabled'); route(); }
   } catch (err) { fail(err); }
});

document.addEventListener('click', async e => {
  const button = e.target.closest('#resendVerificationBtn');
  if (!button) return;

  const emailInput = document.querySelector(
    '#verifyEmailForm [name="email"]'
  );

  const email = emailInput?.value.trim();

  if (!email) {
    toast('Please enter your email address.', 'error');
    return;
  }

  button.disabled = true;

  try {
    const result = await api(
      '/auth/resend-verification',
      'POST',
      { email }
    );

    toast(result.message, 'success');
  } catch (err) {
    fail(err);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  try {
    if (t.id === 'catSel') { state.cat = t.value; route(); }
    else if (t.id === 'payMethod') payFields();
    else if (t.dataset.act === 'qty') { await api('/cart/' + t.dataset.id, 'PUT', { quantity: t.value }); route(); }
    else if (t.dataset.act === 'status') { await api(`/admin/orders/${t.dataset.id}/status`, 'PUT', { status: t.value }); toast('Order updated'); }
    else if (t.dataset.act === 'delivery-status') {
  await api(`/delivery/orders/${t.dataset.id}/status`, 'PUT', {
    status: t.value
  });

  toast('Delivery progress updated successfully');
}
    else if (t.dataset.act === 'assign-delivery') {
  if (!t.value) return;

  await api(`/admin/orders/${t.dataset.id}/assign-delivery`, 'PUT', {
    delivery_id: t.value
  });

  toast('Delivery personnel assigned successfully');
}
  } catch (err) { fail(err); route(); }
});
document.addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, d = form(f);
  try {
    if (f.id === 'searchForm' || f.id === 'globalSearch') { state.q = d.q; const field = document.querySelector('#globalSearch [name=q]'); if (field) field.value = d.q; location.hash = '#shop'; route(); }
    else if (f.id === 'addressForm') {
  if (role() !== 'customer') {
    toast('Please log in as a customer to save a delivery address.', 'warning');
    location.hash = '#login';
    return;
  }

  if (d.country !== 'Kenya') {
    $('#addressNotice').textContent = "We're only available in Kenya for delivery.";
    $('#addressNotice').className = 'small mt-2 text-danger fw-bold';
    return;
  }

  const latitude = $('#addressLatitude')?.value;
const longitude = $('#addressLongitude')?.value;

if (!latitude || !longitude) {
  toast('Please select your delivery location on the map.', 'warning');
  return;
}

await api('/addresses', 'POST', {
  label: d.label,
  address: d.address,
  city: d.city,
  country: d.country,
  instructions: d.instructions,
  latitude: Number(latitude),
  longitude: Number(longitude),
  is_default: true
});

  $('#deliveryLabel').textContent = d.city + ', Kenya';
  $('#addressNotice').textContent = 'Delivery address saved successfully.';
  $('#addressNotice').className = 'small mt-2 text-success fw-bold';

  f.reset();
  f.elements.country.value = 'Kenya';

  await loadSavedAddresses();
  toast('Delivery address saved successfully.');
}
    else if (f.id === 'newsletterForm') { toast('Newsletter signup will be enabled when the email service is configured.', 'info'); f.reset(); }
else if (f.id === 'regForm') {
  const r = await api('/auth/register', 'POST', d);
  toast(r.message);
  location.hash = '#verify-email?email=' + encodeURIComponent(d.email);
}
else if (f.id === 'verifyEmailForm') {
  const r = await api('/auth/verify-email', 'POST', d);
  toast(r.message);
  location.hash = '#login';
} else if (f.id === 'loginForm') {
      const r = await api('/auth/login', 'POST', d);
      if (r.mfa_required) { mfaPending = true; toast('Enter your MFA code', 'info'); return route(); }
      mfaPending = null; me = r.user; renderNav(); toast('Welcome back, ' + me.full_name);
      location.hash =
  me.role === 'customer' ? '#shop' :
  me.role === 'delivery' ? '#delivery' :
  '#admin';

route();
    }
    else if (f.id === 'forgotPasswordForm') {
  const r = await api('/auth/forgot-password', 'POST', d);
  toast(r.message);
  f.reset();
}
else if (f.id === 'resetPasswordForm') {
  if (d.password !== d.confirm_password) {
    return toast('Passwords do not match.', 'error');
  }

  const r = await api('/auth/reset-password', 'POST', {
    token: d.token,
    password: d.password
  });

  toast(r.message);
  location.hash = '#login';
}
    else if (f.id === 'checkoutForm') {
  const payment = {
    phone: d.pay_phone,
    number: d.pay_number,
    expiry: d.pay_expiry,
    cvv: d.pay_cvv,
    email: d.pay_email
  };

  const r = await api('/checkout', 'POST', {
    address: d.address,
    slot: d.slot,
    method: d.method,
    payment,
    promo_code: d.promo_code
  });

  toast(`Order #${r.order_id} placed! Payment ref ${r.reference}`);
  location.hash = '#orders';
}
    else if (f.id === 'profileForm') { await api('/auth/profile', 'PUT', d); me = (await api('/auth/me')).user; renderNav(); toast('Profile saved'); }
    else if (f.id === 'pwForm') { await api('/auth/password', 'PUT', d); f.reset(); toast('Password updated'); }
    else if (f.id === 'mfaForm') { await api('/auth/mfa/enable', 'POST', d); me.mfa_enabled = true; toast('MFA enabled'); route(); }
    else if (f.id === 'reviewForm') { await api(`/products/${f.dataset.id}/reviews`, 'POST', d); toast('Thanks for your feedback'); $('#reviewBox').innerHTML = ''; }
    else if (f.id === 'prodForm') { const id = d.id; delete d.id; await api(id ? '/admin/products/' + id : '/admin/products', id ? 'PUT' : 'POST', d); toast('Product saved'); route(); }
    else if (f.id === 'catForm') { await api('/admin/categories', 'POST', d); cats = []; toast('Category added'); route(); }
    else if (f.id === 'promoCodeForm') {
  const data = Object.fromEntries(new FormData(f).entries());

  data.code = data.code.trim().toUpperCase();
  data.discount_value = Number(data.discount_value);
  data.minimum_order = Number(data.minimum_order || 0);

  await api('/admin/promo-codes', 'POST', data);

  toast('Discount code created successfully.');
  route();
}
    else if (f.id === 'deliveryFeeForm') {
  const fee = Number(d.delivery_fee);

  if (!Number.isFinite(fee) || fee < 0 || fee > 1000000) {
    return toast('Enter a valid delivery fee.', 'error');
  }

  const result = await api('/admin/delivery-settings', 'PUT', {
    delivery_fee: fee
  });

  toast('Delivery fee updated to ' + KES(result.delivery_fee));
  route();
}
    else if (f.id === 'staffForm') { await api('/admin/staff', 'POST', d); f.reset(); toast('Staff account created'); route(); }
  } catch (err) { fail(err); }
});
window.addEventListener('hashchange', route);
(async () => { try { me = (await api('/auth/me')).user; } catch {} renderNav(); route(); })();


// Leaflet + OpenStreetMap delivery location picker
let deliveryMap = null;
let deliveryMarker = null;
let deliverySearchTimer = null;

function initDeliveryMap() {
  const mapElement = document.getElementById('deliveryMap');
  const searchElement = document.getElementById('addressSearch');

  if (!mapElement || !window.L) return;

  const kenyaCenter = [-1.286389, 36.817223];

  if (!deliveryMap) {
    deliveryMap = L.map(mapElement).setView(kenyaCenter, 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(deliveryMap);

    deliveryMarker = L.marker(kenyaCenter, {
      draggable: true
    }).addTo(deliveryMap);

    function saveLocation(latlng) {
      document.getElementById('addressLatitude').value = latlng.lat;
      document.getElementById('addressLongitude').value = latlng.lng;

      deliveryMarker.setLatLng(latlng);
    }

    deliveryMap.on('click', event => {
      saveLocation(event.latlng);
      reverseDeliveryLocation(event.latlng);
    });

    deliveryMarker.on('dragend', event => {
      const position = event.target.getLatLng();
      saveLocation(position);
      reverseDeliveryLocation(position);
    });
  }

  setTimeout(() => deliveryMap.invalidateSize(), 200);

  if (searchElement && !searchElement.dataset.mapSearchReady) {
    searchElement.dataset.mapSearchReady = 'true';

    const suggestions = document.createElement('div');
    suggestions.id = 'addressSuggestions';
    suggestions.style.cssText =
      'position:relative;z-index:2000;background:white;border:1px solid #ddd;border-radius:6px;display:none;max-height:220px;overflow-y:auto;';

    searchElement.insertAdjacentElement('afterend', suggestions);

    searchElement.addEventListener('input', () => {
      clearTimeout(deliverySearchTimer);

      const query = searchElement.value.trim();
      suggestions.innerHTML = '';
      suggestions.style.display = 'none';

      if (query.length < 3) return;

      deliverySearchTimer = setTimeout(async () => {
        try {
          const response = await fetch(
            'https://photon.komoot.io/api/?q=' +
            encodeURIComponent(query) + '&limit=10'
          );

          if (!response.ok) throw new Error('Search failed');

          const data = await response.json();

          const kenyaResults = data.features.filter(item =>
            item.properties.country === 'Kenya'
          );

          suggestions.innerHTML = '';

          kenyaResults.forEach(item => {
            const properties = item.properties;
            const button = document.createElement('button');

            button.type = 'button';
            button.className = 'list-group-item list-group-item-action';
            button.style.cssText = 'display:block;width:100%;text-align:left;padding:10px;border:0;background:white;';

            button.textContent = [
              properties.name,
              properties.street,
              properties.city || properties.town || properties.village,
              properties.state
            ].filter(Boolean).join(', ');

            button.addEventListener('click', () => {
              const coordinates = item.geometry.coordinates;
              const position = L.latLng(coordinates[1], coordinates[0]);

              deliveryMap.setView(position, 17);
              deliveryMarker.setLatLng(position);

              document.getElementById('addressLatitude').value = position.lat;
              document.getElementById('addressLongitude').value = position.lng;

              const addressInput = document.querySelector(
                '#addressForm [name="address"]'
              );

              const cityInput = document.querySelector(
                '#addressForm [name="city"]'
              );

              if (addressInput) {
                addressInput.value = button.textContent;
              }

              if (cityInput) {
                cityInput.value =
                  properties.city ||
                  properties.town ||
                  properties.village ||
                  properties.state ||
                  '';
              }

              searchElement.value = button.textContent;
              suggestions.style.display = 'none';
            });

            suggestions.appendChild(button);
          });

          if (kenyaResults.length) {
            suggestions.style.display = 'block';
          } else {
            suggestions.innerHTML =
              '<div style="padding:10px">No matching locations found in Kenya.</div>';
            suggestions.style.display = 'block';
          }
        } catch (error) {
          console.error('Address search error:', error);
        }
      }, 400);
    });
  }
}

async function reverseDeliveryLocation(position) {
  try {
    const response = await fetch(
      'https://photon.komoot.io/reverse?lat=' +
      position.lat + '&lon=' + position.lng
    );

    if (!response.ok) return;

    const data = await response.json();
    const result = data.features?.[0]?.properties;

    if (!result || result.country !== 'Kenya') return;

    const addressInput = document.querySelector(
      '#addressForm [name="address"]'
    );

    const cityInput = document.querySelector(
      '#addressForm [name="city"]'
    );

    if (addressInput) {
      addressInput.value = [
        result.name,
        result.street,
        result.city || result.town || result.village
      ].filter(Boolean).join(', ');
    }

    if (cityInput) {
      cityInput.value =
        result.city ||
        result.town ||
        result.village ||
        result.state ||
        '';
    }
  } catch (error) {
    console.error('Reverse address lookup error:', error);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const addressModal = document.getElementById('addressModal');

  if (addressModal) {
    addressModal.addEventListener('shown.bs.modal', () => {
      initDeliveryMap();
    });
  }
});
