
BEGIN;

-- Allow the three active payment methods.
-- Keep PayPal permitted only so the historical transaction remains valid.
ALTER TABLE payments
DROP CONSTRAINT payments_method_check;

ALTER TABLE payments
ADD CONSTRAINT payments_method_check
CHECK (method IN (
  'Mobile Money',
  'Credit Card',
  'Bank Transfer',
  'PayPal'
));

-- New payments must start as pending, never automatically paid.
ALTER TABLE payments
ALTER COLUMN status TYPE VARCHAR(20);

ALTER TABLE payments
ALTER COLUMN status SET DEFAULT 'Pending';

-- Record Paystack transaction details.
ALTER TABLE payments
ADD COLUMN gateway VARCHAR(30) NOT NULL DEFAULT 'legacy',
ADD COLUMN paid_at TIMESTAMPTZ,
ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ADD COLUMN channel VARCHAR(30),
ADD COLUMN authorization_url TEXT,
ADD COLUMN access_code VARCHAR(100);

-- Preserve the timestamps of existing successful payments.
UPDATE payments
SET paid_at = created_at
WHERE status = 'Paid';

-- Allow orders to wait for payment confirmation.
ALTER TABLE orders
DROP CONSTRAINT orders_status_check;

ALTER TABLE orders
ADD CONSTRAINT orders_status_check
CHECK (status IN (
  'Awaiting Payment',
  'Placed',
  'Packed',
  'Out for Delivery',
  'Delivered',
  'Cancelled'
));

CREATE INDEX IF NOT EXISTS idx_payments_status
ON payments(status);

CREATE INDEX IF NOT EXISTS idx_payments_gateway
ON payments(gateway);

COMMIT;
