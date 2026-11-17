require('dotenv').config();
// Creates tables and seeds demo data.  Run: npm run init-db
const fs = require('fs'), path = require('path'), bcrypt = require('bcryptjs');
const pool = require('./pool');
(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const hash = p => bcrypt.hashSync(p, 12);
  const u = await pool.query(
    `INSERT INTO users (full_name,email,phone,address,password_hash,role) VALUES
     ('Store Admin','admin@freshcart.test','0700000001','Nairobi HQ',$1,'admin'),
     ('Fresh Farms Supplier','vendor@freshcart.test','0700000002','Limuru Road',$2,'vendor'),
     ('Demo Customer','customer@freshcart.test','0700000003','Kilimani, Nairobi',$3,'customer') RETURNING id,role`,
    [hash('Admin@12345'), hash('Vendor@12345'), hash('Customer@12345')]);
  const vendor = u.rows.find(r => r.role === 'vendor').id;
  const cats = ['Fruits & Vegetables', 'Dairy & Eggs', 'Bakery', 'Meat & Fish', 'Beverages', 'Household'];
  const cid = {};
  for (const c of cats) cid[c] = (await pool.query('INSERT INTO categories(name) VALUES($1) RETURNING id', [c])).rows[0].id;
  const items = [
    ['Bananas', 'Sweet ripe bananas', 120, 100, 'bunch', 'Fruits & Vegetables'],
    ['Tomatoes', 'Fresh red tomatoes', 80, 150, 'kg', 'Fruits & Vegetables'],
    ['Spinach', 'Organic spinach leaves', 50, 80, 'bunch', 'Fruits & Vegetables'],
    ['Avocados', 'Hass avocados', 40, 120, 'each', 'Fruits & Vegetables'],
    ['Fresh Milk 1L', 'Full cream milk', 130, 200, 'litre', 'Dairy & Eggs'],
    ['Eggs Tray (30)', 'Farm eggs', 480, 60, 'tray', 'Dairy & Eggs'],
    ['Cheddar Cheese', 'Mature cheddar 250g', 350, 40, 'pack', 'Dairy & Eggs'],
    ['White Bread', 'Sliced loaf 400g', 65, 90, 'loaf', 'Bakery'],
    ['Croissants (4)', 'Butter croissants', 220, 30, 'pack', 'Bakery'],
    ['Beef 1kg', 'Fresh beef cuts', 750, 50, 'kg', 'Meat & Fish'],
    ['Tilapia Fish', 'Fresh whole tilapia', 450, 35, 'kg', 'Meat & Fish'],
    ['Orange Juice 1L', '100% orange juice', 210, 70, 'litre', 'Beverages'],
    ['Mineral Water 5L', 'Still water', 150, 120, 'bottle', 'Beverages'],
    ['Dish Soap 750ml', 'Lemon dish soap', 190, 5, 'bottle', 'Household'],
    ['Toilet Paper (10)', '2-ply tissue', 560, 45, 'pack', 'Household']
  ];
  for (const [n, d, p, s, un, c] of items)
    await pool.query('INSERT INTO products(name,description,price,stock,unit,category_id,vendor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [n, d, p, s, un, cid[c], vendor]);
  console.log('Database initialised and seeded.');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
