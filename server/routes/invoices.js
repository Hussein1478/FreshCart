
const router = require('express').Router();
const PDFDocument = require('pdfkit');
const pool = require('../db/pool');
const { requireRole } = require('../lib/auth');

const customer = requireRole('customer');

// Download an invoice belonging to the logged-in customer
router.get('/:orderId', customer, async (req, res) => {
  const orderId = Number(req.params.orderId);
  const userId = req.session.user.id;

  if (!Number.isInteger(orderId) || orderId < 1) {
    return res.status(400).json({ error: 'Invalid order number.' });
  }

  const orderResult = await pool.query(
    `SELECT
       o.id,
       o.total,
       o.delivery_address,
       o.delivery_slot,
       o.delivery_fee,
       o.discount_amount,
       o.status,
       o.created_at,
       u.full_name,
       u.email,
       u.phone,
       p.method,
       p.reference,
       p.status AS payment_status,
       p.created_at AS payment_date
     FROM orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN LATERAL (
       SELECT method, reference, status, created_at
       FROM payments
       WHERE order_id = o.id
       ORDER BY created_at DESC, id DESC
       LIMIT 1
     ) p ON true
     WHERE o.id = $1 AND o.user_id = $2`,
    [orderId, userId]
  );

  if (!orderResult.rowCount) {
    return res.status(404).json({
      error: 'Order not found.'
    });
  }

  const order = orderResult.rows[0];

  const itemsResult = await pool.query(
    `SELECT product_name, quantity, unit_price
     FROM order_items
     WHERE order_id = $1
     ORDER BY id`,
    [orderId]
  );

  const doc = new PDFDocument({
    size: 'A4',
    margin: 50
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="FreshCart-Invoice-${orderId}.pdf"`
  );

  doc.pipe(res);

  const money = value =>
    `KES ${Number(value || 0).toFixed(2)}`;

  // FreshCart heading

  // Professional FreshCart invoice header
  doc.rect(0, 0, 595.28, 125).fill('#198754');

  doc
    .fontSize(30)
    .fillColor('#ffffff')
    .text('FreshCart', 50, 35);

  doc
    .fontSize(11)
    .fillColor('#ffffff')
    .text('Fresh groceries, delivered fresh.', 50, 78);

  doc
    .fontSize(24)
    .fillColor('#198754')
    .text('INVOICE', 50, 150);

  doc
    .fontSize(10)
    .fillColor('#666666')
    .text('OFFICIAL ORDER RECEIPT', 50, 180);

  doc.moveDown(3);



  // Order information
  doc
    .fontSize(14)
    .fillColor('#198754')
    .text('Order Information');

  doc.moveDown(0.5);

  doc.fontSize(11).fillColor('#222222');

  doc.text(`Invoice Number: FC-${order.id}`);
  doc.text(`Order Number: #${order.id}`);
  doc.text(`Order Date: ${new Date(order.created_at).toLocaleString('en-KE')}`);
  doc.text(`Order Status: ${order.status}`);

  doc.moveDown(1);

  // Customer information
  doc
    .fontSize(14)
    .fillColor('#198754')
    .text('Customer Details');

  doc.moveDown(0.5);

  doc.fontSize(11).fillColor('#222222');

  doc.text(`Customer Name: ${order.full_name}`);
  doc.text(`Email Address: ${order.email}`);
  doc.text(`Phone Number: ${order.phone || 'Not provided'}`);

  doc.moveDown(1);


  // Delivery information

  // Delivery information
  doc
    .fontSize(14)
    .fillColor('#198754')
    .text('Delivery Details');

  doc.moveDown(0.5);

  doc.fontSize(11).fillColor('#222222');

  doc.text(`Delivery Address: ${order.delivery_address}`);
  doc.text(`Preferred Delivery Time: ${order.delivery_slot || 'Not specified'}`);

  doc.moveDown(1);



  // Products table
  doc
    .fontSize(14)
    .fillColor('#198754')
    .text('Products Ordered');

  doc.moveDown(0.5);

  const startX = 50;
  const quantityX = 350;
  const priceX = 420;
  const subtotalX = 490;

  // Draw professional table heading
  function drawProductTableHeader(y) {
    doc.rect(startX, y, 500, 26).fill('#e8f5ee');

    doc.fontSize(10).fillColor('#198754');

    doc.text('Product', startX + 5, y + 8);
    doc.text('Qty', quantityX, y + 8);
    doc.text('Unit Price', priceX, y + 8);
    doc.text('Subtotal', subtotalX, y + 8);

    return y + 36;
  }

  let y = drawProductTableHeader(doc.y);

  doc.fillColor('#222222');

  for (const item of itemsResult.rows) {
    const productHeight = doc.heightOfString(item.product_name, {
      width: 280
    });

    const rowHeight = Math.max(28, productHeight + 10);

    if (y + rowHeight > 720) {
      doc.addPage();
      y = drawProductTableHeader(50);
    }

    const subtotal =
      Number(item.quantity) * Number(item.unit_price);

    doc.fontSize(9).fillColor('#222222');

    doc.text(item.product_name, startX + 5, y, {
      width: 280
    });

    doc.text(String(item.quantity), quantityX, y);
    doc.text(money(item.unit_price), priceX, y);
    doc.text(money(subtotal), subtotalX, y);

    y += rowHeight;

    doc.strokeColor('#eeeeee')
      .moveTo(startX, y)
      .lineTo(550, y)
      .stroke();

    y += 5;
  }

  y += 10;

  doc.strokeColor('#cccccc')
    .moveTo(startX, y)
    .lineTo(550, y)
    .stroke();


  y += 15;

  // Totals
  doc.fontSize(11).fillColor('#222222');


  // Payment summary
  const itemsSubtotal = itemsResult.rows.reduce(
    (sum, item) =>
      sum + Number(item.quantity) * Number(item.unit_price),
    0
  );

  if (y > 630) {
    doc.addPage();
    y = 50;
  }

  doc.rect(50, y, 500, 115).fill('#f2f8f4');

  doc.fontSize(10).fillColor('#444444');

  doc.text('Products Subtotal:', 70, y + 15);
  doc.text(money(itemsSubtotal), 400, y + 15, {
    width: 130,
    align: 'right'
  });

  doc.text('Delivery Fee:', 70, y + 38);
  doc.text(money(order.delivery_fee), 400, y + 38, {
    width: 130,
    align: 'right'
  });

  doc.text('Discount:', 70, y + 61);
  doc.text(money(order.discount_amount), 400, y + 61, {
    width: 130,
    align: 'right'
  });

  doc.fontSize(14).fillColor('#198754');

  doc.text('ORDER TOTAL:', 70, y + 88);
  doc.text(money(order.total), 400, y + 88, {
    width: 130,
    align: 'right'
  });

  y += 135;



  // Payment information
  if (y > 650) {
    doc.addPage();
    y = 50;
  }

  doc
    .fontSize(14)
    .fillColor('#198754')
    .text('Payment Information', 50, y);

  y += 25;

  doc.rect(50, y, 500, 85).fill('#f7f7f7');

  doc.fontSize(10).fillColor('#222222');

  doc.text(`Payment Method: ${order.method || 'Not recorded'}`, 65, y + 12);
  doc.text(`Payment Reference: ${order.reference || 'Not available'}`, 65, y + 33);
  doc.text(`Payment Status: ${order.payment_status || 'Not recorded'}`, 65, y + 54);

  y += 110;

  // Invoice footer
  doc
    .moveTo(50, y)
    .lineTo(550, y)
    .strokeColor('#198754')
    .stroke();

  y += 20;

  doc
    .fontSize(12)
    .fillColor('#198754')
    .text('Thank you for shopping with FreshCart!', 50, y, {
      align: 'center'
    });

  y += 18;

  doc
    .fontSize(9)
    .fillColor('#777777')
    .text('Fresh groceries, delivered fresh.', 50, y, {
      align: 'center'
    });


  doc.end();
});

module.exports = router;
