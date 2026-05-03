import Database from 'better-sqlite3';
import path from 'node:path';
import { app } from 'electron';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'erp.db');

    db = new Database(dbPath);


        db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'cashier',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category_id INTEGER REFERENCES categories(id),
        image_path TEXT,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS product_variants (
        id INTEGER PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        barcode TEXT UNIQUE,
        size TEXT,
        color TEXT,
        buy_price REAL NOT NULL DEFAULT 0,
        sell_price REAL NOT NULL DEFAULT 0,
        min_stock INTEGER DEFAULT 5,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stock_movements (
        id INTEGER PRIMARY KEY,
        variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        reference_id INTEGER,
        reference_type TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'sale',
        customer_id INTEGER,
        user_id INTEGER REFERENCES users(id),
        sub_total REAL NOT NULL DEFAULT 0,
        discount_value REAL NOT NULL DEFAULT 0,
        grand_total REAL NOT NULL DEFAULT 0,
        paid REAL NOT NULL DEFAULT 0,
        change_amount REAL NOT NULL DEFAULT 0,
        payment_method TEXT DEFAULT 'cash',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        variant_id INTEGER REFERENCES product_variants(id),
        product_name TEXT NOT NULL,
        barcode TEXT,
        size TEXT,
        color TEXT,
        quantity REAL NOT NULL,
        unit_cost REAL NOT NULL DEFAULT 0,
        unit_price REAL NOT NULL,
        line_total REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT UNIQUE,
        email TEXT,
        address TEXT,
        notes TEXT,
        points_balance INTEGER DEFAULT 0,
        total_spent REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS loyalty_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        sale_id INTEGER,
        type TEXT NOT NULL, 
        points INTEGER NOT NULL,
        amount REAL DEFAULT 0,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (sale_id) REFERENCES sales(id)
      );

    `);
    
      safeAddColumn(db, 'sales', 'loyalty_points_earned', 'INTEGER DEFAULT 0');
      safeAddColumn(db, 'sales', 'loyalty_points_redeemed', 'INTEGER DEFAULT 0');
      safeAddColumn(db, 'sales', 'loyalty_discount_value', 'REAL DEFAULT 0');

      seedAdminUser(db);
      seedDefaultCategories(db);
      seedDefaultAppSettings(db);
  }

  return db;
}

function safeAddColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;

  const exists = columns.some((c) => c.name === column);

  if (!exists) {
    database.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function seedAdminUser(database: Database.Database): void {
  const existingAdmin = database
    .prepare(`SELECT id FROM users WHERE username = ? LIMIT 1`)
    .get('admin');

  if (existingAdmin) {
    return;
  }

  database
    .prepare(`
      INSERT INTO users (name, username, password, role, is_active)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run('Administrator', 'admin', '1234', 'admin', 1);

  console.log('Seeded default admin user: admin / 1234');
}

function seedDefaultCategories(database: Database.Database): void {
  const countRow = database
    .prepare(`SELECT COUNT(*) as count FROM categories`)
    .get() as { count: number };

  if (countRow.count > 0) {
    return;
  }

  const stmt = database.prepare(`
    INSERT INTO categories (name, description, is_active)
    VALUES (?, ?, 1)
  `);

  const defaults = [
    ['كاجوال', 'ملابس كاجوال'],
    ['رسمي', 'ملابس رسمية'],
    ['رياضي', 'ملابس رياضية'],
    ['أطفال', 'ملابس أطفال']
  ];

  const insertMany = database.transaction((items: string[][]) => {
    for (const item of items) {
      stmt.run(item[0], item[1]);
    }
  });

  insertMany(defaults);
  console.log('Seeded default categories');
}

function seedDefaultAppSettings(database: Database.Database): void {
  const defaults: Array<{ key: string; value: string }> = [
{ key: 'barcode_label_width_mm', value: '35' },
{ key: 'barcode_label_height_mm', value: '25' },
{ key: 'barcode_copies', value: '1' },
{ key: 'barcode_auto_print_after_save', value: 'false' },

{ key: 'barcode_name_font_size', value: '8' },
{ key: 'barcode_name_position', value: 'top' },
{ key: 'barcode_name_align', value: 'center' },

{ key: 'barcode_price_font_size', value: '7' },
{ key: 'barcode_price_position', value: 'bottom' },
{ key: 'barcode_price_align', value: 'center' },

{ key: 'barcode_size_font_size', value: '6' },
{ key: 'barcode_size_position', value: 'above_barcode' },
{ key: 'barcode_size_align', value: 'center' },

{ key: 'barcode_color_font_size', value: '6' },
{ key: 'barcode_color_position', value: 'above_barcode' },
{ key: 'barcode_color_align', value: 'center' },

{ key: 'barcode_value_font_size', value: '7' },
{ key: 'barcode_value_position', value: 'below_barcode' },
{ key: 'barcode_value_align', value: 'center' },

{ key: 'barcode_svg_height', value: '22' },

{ key: 'loyalty_enabled', value: 'true' },

// كل كام جنيه = نقطة
{ key: 'loyalty_earn_amount', value: '100' },

// عدد النقط المكتسبة لكل مبلغ
{ key: 'loyalty_earn_points', value: '1' },

// قيمة النقطة عند الخصم بالجنيه
{ key: 'loyalty_point_value', value: '1' },

// أقل عدد نقاط ينفع يستخدمهم
{ key: 'loyalty_min_redeem_points', value: '1' },

  ];

  const existsStmt = database.prepare(
    `SELECT key FROM app_settings WHERE key = ? LIMIT 1`
  );

  const insertStmt = database.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)`
  );

  const tx = database.transaction(() => {
    for (const item of defaults) {
      const exists = existsStmt.get(item.key);

      if (!exists) {
        insertStmt.run(item.key, item.value);
      }
    }
  });

  tx();
}