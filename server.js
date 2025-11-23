const express = require('express');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const path = require('path');
const cors = require('cors');

const DB_FILE = path.join(__dirname, 'garments.db');
const db = new Database(DB_FILE);

// ensure basic tables exist (useful if user didn't run init script)
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size TEXT,
  color TEXT,
  price REAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  retailer_name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  price_at_purchase REAL NOT NULL
);
`);

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// --- API ---
// Get all vendors with count of available stock items and total in-stock quantity
app.get('/api/vendors', (req, res) => {
  const vendors = db.prepare(`
    SELECT v.id, v.name, v.contact,
      COUNT(i.id) FILTER (WHERE i.available = 1 AND i.quantity > 0) AS ready_item_count,
      COALESCE(SUM(i.quantity) FILTER (WHERE i.available = 1 AND i.quantity > 0), 0) AS total_quantity
    FROM vendors v
    LEFT JOIN items i ON i.vendor_id = v.id
    GROUP BY v.id
    ORDER BY v.name
  `).all();
  res.json(vendors);
});

// Get items for a vendor (only ready items or all if ?all=1)
app.get('/api/vendors/:id/items', (req, res) => {
  const vendorId = Number(req.params.id);
  const all = req.query.all === '1';
  const stmt = all ?
    db.prepare('SELECT * FROM items WHERE vendor_id = ? ORDER BY id DESC') :
    db.prepare('SELECT * FROM items WHERE vendor_id = ? AND available = 1 AND quantity > 0 ORDER BY id DESC');
  const items = stmt.all(vendorId);
  res.json(items);
});

// Vendor adds an item
app.post('/api/vendors/:id/items', (req, res) => {
  const vendorId = Number(req.params.id);
  const { name, size, color, price, quantity, available } = req.body;
  if (!name || price == null) return res.status(400).json({ error: 'name and price required' });
  const info = db.prepare(`INSERT INTO items (vendor_id,name,size,color,price,quantity,available) VALUES (?,?,?,?,?,?,?)`)
    .run(vendorId, name, size || '', color || '', Number(price), Number(quantity || 0), available ? 1 : 0);
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid);
  res.json(item);
});

// Vendor update item
app.put('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, size, color, price, quantity, available } = req.body;
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  db.prepare(`UPDATE items SET name=?,size=?,color=?,price=?,quantity=?,available=? WHERE id=?`)
    .run(name||existing.name, size||existing.size, color||existing.color, Number(price ?? existing.price), Number(quantity ?? existing.quantity), available ? 1 : 0, id);
  res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(id));
});

// Retailer: get all ready items across vendors (optionally vendor filter)
app.get('/api/items', (req, res) => {
  const vendorId = req.query.vendor;
  let rows;
  if (vendorId) {
    rows = db.prepare('SELECT i.*, v.name as vendor_name FROM items i JOIN vendors v ON v.id = i.vendor_id WHERE i.available=1 AND i.quantity>0 AND v.id=? ORDER BY v.name, i.id').all(Number(vendorId));
  } else {
    rows = db.prepare('SELECT i.*, v.name as vendor_name FROM items i JOIN vendors v ON v.id = i.vendor_id WHERE i.available=1 AND i.quantity>0 ORDER BY v.name, i.id').all();
  }
  res.json(rows);
});

// Retailer: place order (body: retailer_name, items: [{item_id, qty}])
app.post('/api/orders', (req, res) => {
  const { retailer_name, items } = req.body;
  if (!retailer_name || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'retailer_name and items required' });
  }

  const tx = db.transaction(() => {
    const orderInfo = db.prepare('INSERT INTO orders (retailer_name) VALUES (?)').run(retailer_name);
    const orderId = orderInfo.lastInsertRowid;

    for (const it of items) {
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(it.item_id);
      if (!item) throw new Error('Item not found: ' + it.item_id);
      if (item.available !== 1 || item.quantity < it.qty) throw new Error(`Insufficient stock for item ${item.name}`);
      db.prepare('INSERT INTO order_items (order_id,item_id,qty,price_at_purchase) VALUES (?,?,?,?)')
        .run(orderId, it.item_id, it.qty, item.price);
      db.prepare('UPDATE items SET quantity = quantity - ? WHERE id = ?').run(it.qty, it.item_id);
    }
    return orderId;
  });

  try {
    const orderId = tx();
    res.json({ success: true, order_id: orderId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Simple vendor registration (name, contact). Returns vendor id.
app.post('/api/vendors', (req, res) => {
  const { name, contact } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO vendors (name,contact) VALUES (?,?)').run(name, contact || '');
  const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(info.lastInsertRowid);
  res.json(v);
});

// Get order history (simple)
app.get('/api/orders', (req, res) => {
  const orders = db.prepare(`
    SELECT o.id, o.retailer_name, o.created_at,
      json_group_array(json_object('item_id',oi.item_id,'qty',oi.qty,'price',oi.price_at_purchase)) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `).all();
  res.json(orders);
});

// fallback to index
app.get('*', (req,res)=> {
  res.sendFile(path.join(__dirname,'public','index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Server running on http://localhost:${PORT}`));
