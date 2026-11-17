
# FreshCart Kenya — Supermarket Grocery Delivery System

FreshCart is a full-stack grocery e-commerce and delivery application designed for customers in Kenya.

The frontend uses HTML5, CSS3, JavaScript and Bootstrap. The backend uses Node.js, Express.js and PostgreSQL.

The application includes customer authentication, product management, shopping carts, checkout, order management, delivery tracking, administrative tools and email notifications.

**Deployment plan:** Vercel for the frontend and Render for the backend.
**Payment integration:** Paystack integration is planned; the current checkout uses a simulated payment flow.


## Architecture & Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | HTML5, CSS3, JavaScript (ES6+), Bootstrap — deployed on **Vercel**[cite: 1, 5] |
| **Backend** | Node.js, Express.js — deployed on **Render**[cite: 1, 5] |
| **Database** | PostgreSQL — relational database for customer accounts, products, carts, orders, payments, delivery assignments, notifications and other application data.
| **Maps & Address Search** | **Leaflet** with **OpenStreetMap** tiles and **Photon** address search (Kenya bounds enforced)[cite: 1, 5] |
| **Payments** | **Paystack** (M-Pesa Mobile Money, Credit/Debit Cards, and Bank transfers)[cite: 1, 5] |
| **Authentication** | Session-based auth (`HttpOnly`, `SameSite`, `Secure` cookies), bcrypt (cost 12), Google Sign-In, and 6-digit Email OTP[cite: 1, 5] |

---

## Key Features

### Customer Experience
- **Storefront & Product Catalog:** Responsive FreshCart green/orange UI featuring an animated promotional hero banner, category navigation, live product search, sale pricing in KES, stock levels, and average customer ratings[cite: 1, 5].
- **Delivery Map & Address Search:** Interactive **Leaflet** map powered by **OpenStreetMap** tiles and **Photon** autocomplete address search[cite: 1, 5]. Addresses outside Kenya are automatically rejected (`"We are only available in Kenya for delivery."`)[cite: 1, 5].
- **Shopping Cart & Checkout:** Real-time stock validation on cart updates, delivery-slot selection, and database-transactional checkout with row locking to prevent overselling[cite: 1, 5].
- **Checkout & Receipts:** Customers can review their cart, select a saved delivery address, choose a delivery slot, apply valid discount codes, and place orders. The current checkout uses a simulated payment flow. Paystack hosted checkout and server-side payment verification are planned. Completed orders can generate downloadable PDF invoices.
- **Order Tracking & Reviews:** Customers can track order stages (`Placed`, `Packed`, `Out for Delivery`, `Delivered`), view order history, and submit star ratings/reviews on delivered items[cite: 1, 5].
- **Store Policies & Contact:** Dedicated routes/pages for About, Contact, Privacy Policy, Terms & Conditions, and Refund & Return Policy[cite: 1, 5].

### Vendor (Supplier) & Admin Portal
- **Role-Based Dashboards:** Dedicated views and API route protection for `Customer`, `Vendor`, and `Admin` roles[cite: 1, 5].
- **Product & Media Management:** Create, edit, categorize, and delete products with SKU, brand, price, sale price, stock, unit, visibility, and up to 4 uploaded images (validated JPG/PNG/WebP up to 2 MB, saved with randomized filenames)[cite: 1, 5].
- **Order & Delivery Management:** View incoming orders, inspect Paystack payment statuses, and update delivery statuses[cite: 1, 5].
- **Analytics & Audit Logs:** Daily sales reports, top-selling products, payment method breakdowns, customer/inventory reports, and full security activity logs[cite: 1, 5].

---

## Security

FreshCart includes the following application security measures:

- Password hashing for user accounts.
- Role-based access control for customers, administrators and authorized staff.
- Login protection using failed-attempt tracking and temporary account locking.
- Email-based password reset functionality.
- Email OTP confirmation.
- Optional authenticator-based MFA support.
- Input validation and sanitization.
- Content Security Policy (CSP) protections.
- Environment variables for sensitive configuration and credentials.

Additional production security configuration, including HTTPS and payment security controls, will be completed during deployment and Paystack integration.

## Run Locally

### Prerequisites
- **Node.js** 18+
- **PostgreSQL** 14+

### Database Setup

FreshCart uses PostgreSQL.

For a completely new, empty database:

1. Create a PostgreSQL database.
2. Apply `server/db/schema.sql` to create the base tables.
3. Apply `server/db/migrations/001_freshcart_features.sql`.
4. Apply `server/db/migrations/002_product_images.sql`.

**Important:** `schema.sql` contains DROP TABLE statements and must only be executed against a new, empty database. Never run it against an existing database containing FreshCart data.

The `npm run init-db` command is not recommended for production setup because it executes the destructive initialization script and inserts demo accounts and sample products.

Configure the database connection through the server's environment variables before starting the application.



### 2. Environment Configuration

Copy `.env.example` to `server/.env` and configure your local environment variables (never commit `server/.env` or expose secret keys in frontend files):

```env
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=grocerydb
DB_USER=grocer
DB_PASSWORD=your_secure_db_password

# Sessions & CORS
SESSION_SECRET=your_strong_random_session_secret
FRONTEND_URL=http://localhost:3000

# Paystack (leave blank to use the built-in demo payment flow locally)
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxxxxx

# Authentication & Email OTP
GOOGLE_CLIENT_ID=your_google_oauth_client_id
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password

```

(Note: Leaflet, OpenStreetMap tiles, and Photon address search work out of the box without API keys.)

### 3. Start the Application

```bash
cd server
npm start

```

Open `http://localhost:3000` in your browser.

---


---

## Deployment Guide

FreshCart is being prepared for production deployment.

### Planned Hosting Architecture

- **Frontend:** Vercel
- **Backend API:** Render
- **Database:** PostgreSQL
- **Security:** HTTPS for production communication

### Planned Payment Integration

Paystack hosted checkout, server-side transaction verification and webhook signature validation will be implemented before live payments are enabled.

The production webhook URL will be documented after the payment integration is implemented and the backend is deployed.

### Production Configuration

Production environment variables must be configured securely through the hosting providers' environment settings. Never upload `.env` files or expose API secret keys in frontend code or GitHub.

## Production Pre-Launch Checklist

* [ ] Replace `PAYSTACK_SECRET_KEY` with live Paystack keys and verify end-to-end M-Pesa/card checkout, webhook signature verification, and stock release on cancelled payments.


* [ ] Verify cross-origin session cookies, CORS origins, and CSP headers between the Vercel frontend and Render backend.


* [ ] Confirm Kenya bounding-box/country validation runs both on the Leaflet/Photon frontend and on the Render backend API


* [ ] Configure production-only credentials, rotate any credentials used during development, and remove development/demo accounts before launch.


* [ ] Schedule automated database backups (`server/scripts/backup.sh`).



```

```