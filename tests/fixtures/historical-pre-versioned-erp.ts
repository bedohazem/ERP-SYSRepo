import Database from 'better-sqlite3';

export const HISTORICAL_PRE_VERSIONED_COMMIT =
  '64af12c2bf3db2d58e97ff4a73cb45b54e2a290a';

/*
 * Historical ERP fixture based on the real schema that existed
 * immediately before versioned schema migrations were introduced.
 *
 * Important:
 * - This database is not created from the current ERP schema.
 * - It intentionally has no schema_migrations table.
 * - Modern columns such as average_cost, inventory_value,
 *   list_sub_total and the newer business_date snapshots
 *   are intentionally absent.
 */
export function createHistoricalPreVersionedErpFixture(filePath: string) {
  const db = new Database(filePath);

  try {
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'cashier',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE categories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category_id INTEGER REFERENCES categories(id),
        image_path TEXT,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE product_variants (
        id INTEGER PRIMARY KEY,
        product_id INTEGER NOT NULL
          REFERENCES products(id)
          ON DELETE CASCADE,
        barcode TEXT UNIQUE,
        size TEXT,
        color TEXT,
        buy_price REAL NOT NULL DEFAULT 0,
        sell_price REAL NOT NULL DEFAULT 0,
        min_stock INTEGER DEFAULT 5,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE stock_movements (
        id INTEGER PRIMARY KEY,
        variant_id INTEGER NOT NULL
          REFERENCES product_variants(id)
          ON DELETE CASCADE,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        reference_id INTEGER,
        reference_type TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE sales (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'sale',
        customer_id INTEGER,
        user_id INTEGER REFERENCES users(id),
        business_date TEXT,
        sub_total REAL NOT NULL DEFAULT 0,
        discount_value REAL NOT NULL DEFAULT 0,
        promotion_id INTEGER,
        promotion_name TEXT,
        promotion_discount_value REAL NOT NULL DEFAULT 0,
        grand_total REAL NOT NULL DEFAULT 0,
        paid REAL NOT NULL DEFAULT 0,
        change_amount REAL NOT NULL DEFAULT 0,
        payment_method TEXT DEFAULT 'cash',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE sale_items (
        id INTEGER PRIMARY KEY,
        sale_id INTEGER NOT NULL
          REFERENCES sales(id)
          ON DELETE CASCADE,
        variant_id INTEGER
          REFERENCES product_variants(id),
        product_name TEXT NOT NULL,
        barcode TEXT,
        size TEXT,
        color TEXT,
        quantity REAL NOT NULL,
        unit_cost REAL NOT NULL DEFAULT 0,
        unit_price REAL NOT NULL,
        promotion_discount_value REAL NOT NULL DEFAULT 0,
        line_total REAL NOT NULL,
        is_gift INTEGER NOT NULL DEFAULT 0,
        promotion_group_id TEXT
      );

      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE customers (
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

      CREATE TABLE suppliers (
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

      CREATE TABLE purchase_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL,
        total_amount REAL NOT NULL DEFAULT 0,
        sub_total REAL NOT NULL DEFAULT 0,
        discount_type TEXT DEFAULT 'amount',
        discount_input REAL NOT NULL DEFAULT 0,
        discount_value REAL NOT NULL DEFAULT 0,
        paid_amount REAL NOT NULL DEFAULT 0,
        remaining_amount REAL NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'unpaid',
        payment_method TEXT DEFAULT 'cash',
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id)
          REFERENCES suppliers(id)
      );

      CREATE TABLE purchase_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_id INTEGER NOT NULL,
        variant_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        barcode TEXT,
        size TEXT,
        color TEXT,
        quantity REAL NOT NULL,
        unit_cost REAL NOT NULL,
        previous_buy_price REAL,
        line_total REAL NOT NULL,
        FOREIGN KEY (purchase_id)
          REFERENCES purchase_invoices(id),
        FOREIGN KEY (variant_id)
          REFERENCES product_variants(id)
      );

      CREATE TABLE store_liabilities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        party_name TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT,
        total_amount REAL NOT NULL DEFAULT 0,
        paid_amount REAL NOT NULL DEFAULT 0,
        remaining_amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        due_date TEXT,
        notes TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by)
          REFERENCES users(id)
      );

      CREATE TABLE store_liability_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        liability_id INTEGER NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        payment_method TEXT DEFAULT 'cash',
        notes TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        replacement_payment_id INTEGER,
        FOREIGN KEY (liability_id)
          REFERENCES store_liabilities(id)
          ON DELETE CASCADE,
        FOREIGN KEY (created_by)
          REFERENCES users(id)
      );

      CREATE TABLE cash_shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'closed')),
        opened_by INTEGER NOT NULL,
        opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        previous_shift_id INTEGER,
        expected_opening_amount REAL,
        opening_counted_amount REAL NOT NULL DEFAULT 0,
        opening_difference REAL NOT NULL DEFAULT 0,
        expected_closing_amount REAL,
        closing_counted_amount REAL,
        closing_difference REAL,
        left_for_next_shift REAL,
        safe_transfer_amount REAL,
        closed_by INTEGER,
        closed_at TEXT,
        close_reason TEXT,
        FOREIGN KEY (opened_by)
          REFERENCES users(id),
        FOREIGN KEY (closed_by)
          REFERENCES users(id),
        FOREIGN KEY (previous_shift_id)
          REFERENCES cash_shifts(id)
      );

      CREATE TABLE expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT,
        amount REAL NOT NULL DEFAULT 0,
        payment_method TEXT DEFAULT 'cash',
        notes TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by)
          REFERENCES users(id)
      );

      CREATE TABLE cash_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        direction TEXT NOT NULL,
        payment_method TEXT DEFAULT 'cash',
        reference_id INTEGER,
        reference_type TEXT,
        notes TEXT,
        created_by INTEGER,
        business_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by)
          REFERENCES users(id)
      );

      /*
       * These columns existed in real pre-versioned databases
       * through the old manual safeAddColumn upgrade path.
       */
      ALTER TABLE customers
      ADD COLUMN balance REAL DEFAULT 0;

      ALTER TABLE sales
      ADD COLUMN remaining_amount REAL DEFAULT 0;

      ALTER TABLE sales
      ADD COLUMN payment_status TEXT DEFAULT 'paid';

      ALTER TABLE sales
      ADD COLUMN shift_id INTEGER;

      ALTER TABLE cash_movements
      ADD COLUMN shift_id INTEGER;

      ALTER TABLE expenses
      ADD COLUMN shift_id INTEGER;

      ALTER TABLE store_liability_payments
      ADD COLUMN shift_id INTEGER;
    `);

    const insertHistoricalData = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO users (
          id,
          name,
          username,
          password,
          role,
          is_active
        )
        VALUES (
          1,
          'Historical Admin',
          'historical-admin',
          'historical-password-hash',
          'admin',
          1
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO categories (
          id,
          name,
          description,
          is_active
        )
        VALUES (
          1,
          'Historical Category',
          'Pre-versioned fixture',
          1
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO products (
          id,
          name,
          category_id,
          description,
          is_active
        )
        VALUES (
          1,
          'Historical Product',
          1,
          'Historical migration fixture',
          1
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO product_variants (
          id,
          product_id,
          barcode,
          size,
          color,
          buy_price,
          sell_price,
          min_stock,
          is_active
        )
        VALUES (
          1,
          1,
          'HISTORICAL-001',
          'M',
          'Black',
          40,
          100,
          1,
          1
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO customers (
          id,
          name,
          phone,
          balance,
          is_active
        )
        VALUES (
          1,
          'Historical Customer',
          '01000000001',
          0,
          1
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO suppliers (
          id,
          name,
          phone,
          total_purchased,
          balance,
          is_active
        )
        VALUES (
          1,
          'Historical Supplier',
          '01000000002',
          150,
          150,
          1
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO cash_shifts (
          id,
          status,
          opened_by,
          opened_at,
          opening_counted_amount,
          opening_difference
        )
        VALUES (
          1,
          'closed',
          1,
          '2026-09-22 12:00:00',
          0,
          0
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO sales (
          id,
          type,
          customer_id,
          user_id,
          business_date,
          sub_total,
          discount_value,
          grand_total,
          paid,
          remaining_amount,
          payment_status,
          change_amount,
          payment_method,
          shift_id,
          created_at
        )
        VALUES (
          1,
          'sale',
          1,
          1,
          '2026-09-22',
          200,
          0,
          200,
          200,
          0,
          'paid',
          0,
          'cash',
          1,
          '2026-09-22 12:10:00'
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO sale_items (
          id,
          sale_id,
          variant_id,
          product_name,
          barcode,
          size,
          color,
          quantity,
          unit_cost,
          unit_price,
          promotion_discount_value,
          line_total,
          is_gift
        )
        VALUES (
          1,
          1,
          1,
          'Historical Product',
          'HISTORICAL-001',
          'M',
          'Black',
          2,
          40,
          100,
          0,
          200,
          0
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO purchase_invoices (
          id,
          supplier_id,
          total_amount,
          sub_total,
          discount_value,
          paid_amount,
          remaining_amount,
          payment_status,
          payment_method,
          created_at
        )
        VALUES (
          1,
          1,
          150,
          150,
          0,
          0,
          150,
          'unpaid',
          'cash',
          '2026-09-22 12:20:00'
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO purchase_items (
          id,
          purchase_id,
          variant_id,
          product_name,
          barcode,
          size,
          color,
          quantity,
          unit_cost,
          previous_buy_price,
          line_total
        )
        VALUES (
          1,
          1,
          1,
          'Historical Product',
          'HISTORICAL-001',
          'M',
          'Black',
          3,
          50,
          40,
          150
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO stock_movements (
          id,
          variant_id,
          type,
          quantity,
          reference_type,
          notes,
          created_at
        )
        VALUES (
          1,
          1,
          'opening',
          5,
          'opening_stock',
          'Historical opening stock',
          '2026-09-22 11:00:00'
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO stock_movements (
          id,
          variant_id,
          type,
          quantity,
          reference_id,
          reference_type,
          notes,
          created_at
        )
        VALUES (
          2,
          1,
          'out',
          2,
          1,
          'sale',
          'Historical sale',
          '2026-09-22 12:10:00'
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO stock_movements (
          id,
          variant_id,
          type,
          quantity,
          reference_id,
          reference_type,
          notes,
          created_at
        )
        VALUES (
          3,
          1,
          'in',
          3,
          1,
          'purchase',
          'Historical purchase',
          '2026-09-22 12:20:00'
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO expenses (
          id,
          title,
          category,
          amount,
          payment_method,
          notes,
          created_by,
          shift_id,
          created_at
        )
        VALUES (
          1,
          'Historical Expense',
          'operations',
          20,
          'cash',
          'Historical expense row',
          1,
          1,
          '2026-09-22 12:30:00'
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO store_liabilities (
          id,
          party_name,
          title,
          total_amount,
          paid_amount,
          remaining_amount,
          status,
          created_by,
          created_at
        )
        VALUES (
          1,
          'Historical Party',
          'Historical Liability',
          100,
          30,
          70,
          'open',
          1,
          '2026-09-22 12:40:00'
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO store_liability_payments (
          id,
          liability_id,
          amount,
          payment_method,
          notes,
          created_by,
          shift_id,
          created_at
        )
        VALUES (
          1,
          1,
          30,
          'cash',
          'Historical liability payment',
          1,
          1,
          '2026-09-22 12:45:00'
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO cash_movements (
          id,
          type,
          amount,
          direction,
          payment_method,
          reference_id,
          reference_type,
          notes,
          created_by,
          business_date,
          shift_id,
          created_at
        )
        VALUES (
          1,
          'sale',
          200,
          'in',
          'cash',
          1,
          'sale',
          'Historical sale payment',
          1,
          '2026-09-22',
          1,
          '2026-09-22 12:10:00'
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO cash_movements (
          id,
          type,
          amount,
          direction,
          payment_method,
          reference_id,
          reference_type,
          notes,
          created_by,
          business_date,
          shift_id,
          created_at
        )
        VALUES (
          2,
          'expense',
          20,
          'out',
          'cash',
          1,
          'expense',
          'Historical expense payment',
          1,
          '2026-09-22',
          1,
          '2026-09-22 12:30:00'
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO cash_movements (
          id,
          type,
          amount,
          direction,
          payment_method,
          reference_id,
          reference_type,
          notes,
          created_by,
          business_date,
          shift_id,
          created_at
        )
        VALUES (
          3,
          'liability_payment',
          30,
          'out',
          'cash',
          1,
          'store_liability_payment',
          'Historical liability payment',
          1,
          '2026-09-22',
          1,
          '2026-09-22 12:45:00'
        )
        `,
      ).run();

      db.prepare(
        `
        INSERT INTO app_settings (
          key,
          value
        )
        VALUES (
          'historical_fixture_marker',
          'pre-versioned'
        )
        `,
      ).run();
    });

    insertHistoricalData();

    const foreignKeyErrors = db.pragma('foreign_key_check') as unknown[];

    if (foreignKeyErrors.length > 0) {
      throw new Error('Historical ERP fixture contains foreign key violations');
    }
  } finally {
    db.close();
  }
}
