BEGIN;

ALTER TABLE orders
DROP CONSTRAINT orders_status_check;

ALTER TABLE orders
ADD CONSTRAINT orders_status_check
CHECK (status IN (
  'Awaiting Payment',
  'Payment Review',
  'Placed',
  'Packed',
  'Out for Delivery',
  'Delivered',
  'Cancelled'
));

COMMIT;