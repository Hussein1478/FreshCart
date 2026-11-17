-- FreshCart (Group 6: Supermarket Grocery Delivery System) - PostgreSQL schema
DROP TABLE IF EXISTS activity_logs, reviews, payments, order_items, orders, cart_items, products, categories, users, session CASCADE;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  phone VARCHAR(20),
  address VARCHAR(255),
  password_hash VARCHAR(100) NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin','vendor')),
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  mfa_secret VARCHAR(64),
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) UNIQUE NOT NULL
);
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  unit VARCHAR(20) NOT NULL DEFAULT 'each',
  image_url VARCHAR(500),
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  vendor_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE cart_items (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INT NOT NULL CHECK (quantity > 0),
  UNIQUE (user_id, product_id)
);
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  total NUMERIC(10,2) NOT NULL,
  delivery_address VARCHAR(255) NOT NULL,
  delivery_slot VARCHAR(40),
  status VARCHAR(20) NOT NULL DEFAULT 'Placed'
    CHECK (status IN ('Placed','Packed','Out for Delivery','Delivered','Cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id) ON DELETE SET NULL,
  product_name VARCHAR(120) NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  quantity INT NOT NULL
);
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method VARCHAR(20) NOT NULL CHECK (method IN ('Mobile Money','Credit Card','PayPal')),
  amount NUMERIC(10,2) NOT NULL,
  reference VARCHAR(40) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'Paid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, user_id)
);
CREATE TABLE activity_logs (
  id SERIAL PRIMARY KEY,
  user_id INT,
  action VARCHAR(60) NOT NULL,
  detail VARCHAR(255),
  ip VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE session (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX idx_products_cat ON products(category_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_session_expire ON session(expire);
