import Database from 'better-sqlite3';
import path from 'node:path';
import { app } from 'electron';
import { hashPassword } from '../security/password';

let db: Database.Database;

export function getDbPath(): string {
  return path.join(app.getPath('userData'), 'erp.db');
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined as unknown as Database.Database;
  }
}

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = getDbPath();

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

      CREATE TABLE IF NOT EXISTS stock_count_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_by INTEGER,
        approved_by INTEGER,
        canceled_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        approved_at TEXT,
        canceled_at TEXT,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (approved_by) REFERENCES users(id),
        FOREIGN KEY (canceled_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS stock_count_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        variant_id INTEGER NOT NULL,
        system_stock REAL NOT NULL DEFAULT 0,
        actual_stock REAL,
        notes TEXT,
        updated_at TEXT,
        FOREIGN KEY (session_id) REFERENCES stock_count_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (variant_id) REFERENCES product_variants(id),
        UNIQUE(session_id, variant_id)
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

      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT UNIQUE,
        email TEXT,
        address TEXT,
        notes TEXT,
        total_purchased REAL DEFAULT 0,
        balance REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS purchase_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL,
        total_amount REAL NOT NULL DEFAULT 0,
        paid_amount REAL NOT NULL DEFAULT 0,
        remaining_amount REAL NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'unpaid',
        payment_method TEXT DEFAULT 'cash',
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
      );

      CREATE TABLE IF NOT EXISTS purchase_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_id INTEGER NOT NULL,
        variant_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        barcode TEXT,
        size TEXT,
        color TEXT,
        quantity REAL NOT NULL,
        unit_cost REAL NOT NULL,
        line_total REAL NOT NULL,
        FOREIGN KEY (purchase_id) REFERENCES purchase_invoices(id),
        FOREIGN KEY (variant_id) REFERENCES product_variants(id)
      );

      CREATE TABLE IF NOT EXISTS supplier_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL,
        purchase_id INTEGER,
        amount REAL NOT NULL,
        payment_method TEXT DEFAULT 'cash',
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        FOREIGN KEY (purchase_id) REFERENCES purchase_invoices(id)
      );

      CREATE TABLE IF NOT EXISTS customer_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        sale_id INTEGER,
        amount REAL NOT NULL,
        payment_method TEXT DEFAULT 'cash',
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (sale_id) REFERENCES sales(id)
      );

      CREATE TABLE IF NOT EXISTS cash_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        type TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,

        direction TEXT NOT NULL, 
        payment_method TEXT DEFAULT 'cash',

        reference_id INTEGER,
        reference_type TEXT,

        notes TEXT,

        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT,
        amount REAL NOT NULL DEFAULT 0,
        payment_method TEXT DEFAULT 'cash',
        notes TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        entity TEXT,
        entity_id INTEGER,
        details TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS sale_returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_sale_id INTEGER NOT NULL,
        customer_id INTEGER,
        user_id INTEGER REFERENCES users(id),
        sub_total REAL NOT NULL DEFAULT 0,
        loyalty_discount_value REAL NOT NULL DEFAULT 0,
        refund_amount REAL NOT NULL DEFAULT 0,
        payment_method TEXT DEFAULT 'cash',
        reason TEXT,
        notes TEXT,
        loyalty_points_reversed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (original_sale_id) REFERENCES sales(id) ON DELETE CASCADE,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      );

      CREATE TABLE IF NOT EXISTS sale_return_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_id INTEGER NOT NULL,
        original_sale_item_id INTEGER NOT NULL,
        variant_id INTEGER,
        product_name TEXT NOT NULL,
        barcode TEXT,
        size TEXT,
        color TEXT,
        quantity REAL NOT NULL,
        unit_cost REAL NOT NULL DEFAULT 0,
        unit_price REAL NOT NULL,
        line_total REAL NOT NULL,
        FOREIGN KEY (return_id) REFERENCES sale_returns(id) ON DELETE CASCADE,
        FOREIGN KEY (original_sale_item_id) REFERENCES sale_items(id),
        FOREIGN KEY (variant_id) REFERENCES product_variants(id)
      );

    `);
    
      safeAddColumn(db, 'sales', 'loyalty_points_earned', 'INTEGER DEFAULT 0');
      safeAddColumn(db, 'sales', 'loyalty_points_redeemed', 'INTEGER DEFAULT 0');
      safeAddColumn(db, 'sales', 'loyalty_discount_value', 'REAL DEFAULT 0');
      safeAddColumn(db, 'sales', 'parent_sale_id', 'INTEGER');
      safeAddColumn(db, 'sales', 'return_reason', 'TEXT');
      safeAddColumn(db, 'sales', 'type', `TEXT DEFAULT 'sale'`);
      safeAddColumn(db, 'suppliers', 'email', 'TEXT');
      safeAddColumn(db, 'suppliers', 'address', 'TEXT');
      safeAddColumn(db, 'suppliers', 'notes', 'TEXT');
      safeAddColumn(db, 'suppliers', 'total_purchased', 'REAL DEFAULT 0');
      safeAddColumn(db, 'suppliers', 'balance', 'REAL DEFAULT 0');
      safeAddColumn(db, 'suppliers', 'is_active', 'INTEGER DEFAULT 1');
      safeAddColumn(db, 'suppliers', 'updated_at', 'TEXT');
      safeAddColumn(db, 'purchase_invoices', 'payment_method', `TEXT DEFAULT 'cash'`);
      safeAddColumn(db, 'purchase_invoices', 'notes', 'TEXT');
      safeAddColumn(db, 'supplier_payments', 'purchase_id', 'INTEGER');
      safeAddColumn(db, 'supplier_payments', 'payment_method', `TEXT DEFAULT 'cash'`);
      safeAddColumn(db, 'supplier_payments', 'notes', 'TEXT');

      safeAddColumn(db, 'customers', 'balance', 'REAL DEFAULT 0');

      safeAddColumn(db, 'sales', 'remaining_amount', 'REAL DEFAULT 0');
      safeAddColumn(db, 'sales', 'payment_status', `TEXT DEFAULT 'paid'`);

      safeAddColumn(db, 'customer_payments', 'sale_id', 'INTEGER');
      safeAddColumn(db, 'customer_payments', 'payment_method', `TEXT DEFAULT 'cash'`);
      safeAddColumn(db, 'customer_payments', 'notes', 'TEXT');

      normalizeStockMovementTypes(db);

      seedAdminUser(db);
      
      seedDefaultCategories(db);
      seedDefaultAppSettings(db);

      db.prepare(`
        UPDATE sales
        SET
          remaining_amount = CASE
            WHEN IFNULL(grand_total, 0) - IFNULL(paid, 0) > 0
            THEN IFNULL(grand_total, 0) - IFNULL(paid, 0)
            ELSE 0
          END,
          payment_status = CASE
            WHEN IFNULL(paid, 0) >= IFNULL(grand_total, 0) THEN 'paid'
            WHEN IFNULL(paid, 0) > 0 THEN 'partial'
            ELSE 'unpaid'
          END
        WHERE IFNULL(type, 'sale') = 'sale'
      `).run();
  }

  return db;
}

export function resetDatabaseData(): void {
  const database = getDb();

  database.transaction(() => {
    database.exec(`
      PRAGMA foreign_keys = OFF;

      DELETE FROM activity_logs;
      DELETE FROM expenses;
      DELETE FROM cash_movements;

      DELETE FROM supplier_payments;
      DELETE FROM purchase_items;
      DELETE FROM purchase_invoices;
      DELETE FROM suppliers;

      DELETE FROM customer_payments;
      DELETE FROM loyalty_transactions;
      DELETE FROM sale_return_items;
      DELETE FROM sale_returns;
      DELETE FROM sale_items;
      DELETE FROM sales;
      DELETE FROM customers;

      DELETE FROM stock_count_items;
      DELETE FROM stock_count_sessions;

      DELETE FROM stock_movements;
      DELETE FROM product_variants;
      DELETE FROM products;
      DELETE FROM categories;

      DELETE FROM users;

      DELETE FROM sqlite_sequence;

      PRAGMA foreign_keys = ON;
    `);

    seedAdminUser(database);
    seedDefaultCategories(database);
    seedDefaultAppSettings(database);
  })();
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

function normalizeStockMovementTypes(database: Database.Database): void {
  // أي رصيد افتتاحي قديم كان متسجل opening هنحوّله لـ in
  // عشان كل حسابات المخزون تبقى موحدة
  database
    .prepare(
      `
      UPDATE stock_movements
      SET type = 'in',
          reference_type = COALESCE(NULLIF(reference_type, ''), 'opening_stock')
      WHERE type IN ('opening', 'product_opening', 'opening_stock')
      `
    )
    .run();

  // احتياطي لو أي نسخة قديمة كانت مسمية البيع أو المرتجع بأسماء مختلفة
  database
    .prepare(
      `
      UPDATE stock_movements
      SET type = 'out'
      WHERE type IN ('sale_out', 'sales_out')
      `
    )
    .run();

  database
    .prepare(
      `
      UPDATE stock_movements
      SET type = 'in'
      WHERE type IN ('return_in', 'sale_return', 'return')
      `
    )
    .run();
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
    .run('Administrator', 'admin', hashPassword('1234'), 'admin', 1);

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

{ key: 'app_theme', value: 'dark' },

{ key: 'barcode_label_width_mm', value: '35' },
{ key: 'barcode_label_height_mm', value: '25' },
{ key: 'barcode_copies', value: '1' },
{ key: 'barcode_auto_print_after_save', value: 'false' },

{ key: 'barcode_content_offset_x_mm', value: '0' },
{ key: 'barcode_content_offset_y_mm', value: '0' },

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
