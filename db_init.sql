-- If using SQLite, keep the following line. Otherwise, remove it.
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
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL,
  price_at_purchase REAL NOT NULL
);

-- sample vendors
INSERT INTO vendors (name, contact) VALUES ('Sunrise Textiles', 'sunrise@example.com');
INSERT INTO vendors (name, contact) VALUES ('Metro Garments', 'metro@example.com');

-- sample items (ready-made)
INSERT INTO items (vendor_id, name, size, color, price, quantity, available) VALUES
(1,'Cotton T-Shirt','M','White',199.00,50,1),
(1,'Denim Jeans','32','Blue',899.00,20,1),
(2,'Summer Dress','L','Red',499.00,10,1), 
(2,'Formal Shirt','M','Sky Blue',349.00,30,1);
