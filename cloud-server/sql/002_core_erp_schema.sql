CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE branches
ADD COLUMN IF NOT EXISTS code TEXT;

ALTER TABLE branches
ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE branches
ADD COLUMN IF NOT EXISTS address TEXT;

ALTER TABLE branches
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_code
ON branches(code)
WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_branch_name
ON warehouses(branch_id, name);

CREATE TABLE IF NOT EXISTS cash_registers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_registers_branch_code
ON cash_registers(branch_id, code);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  branch_id TEXT REFERENCES branches(id),
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'cashier',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name
ON categories(name);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  category_id TEXT REFERENCES categories(id),
  name TEXT NOT NULL,
  sku TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_products_name
ON products(name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku
ON products(sku)
WHERE sku IS NOT NULL AND sku <> '';

CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode TEXT,
  size TEXT,
  color TEXT,
  buy_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  wholesale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_barcode
ON product_variants(barcode)
WHERE barcode IS NOT NULL AND barcode <> '';

CREATE INDEX IF NOT EXISTS idx_product_variants_product
ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS stock_balances (
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (warehouse_id, variant_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  type TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id TEXT,
  notes TEXT,
  created_by TEXT REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_variant
ON stock_movements(variant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse
ON stock_movements(warehouse_id, created_at);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  branch_id TEXT REFERENCES branches(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  points_balance INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customers_phone
ON customers(phone);

CREATE TABLE IF NOT EXISTS invoice_counters (
  branch_id TEXT PRIMARY KEY REFERENCES branches(id),
  last_sale_number BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  cash_register_id TEXT REFERENCES cash_registers(id),
  cashier_id TEXT REFERENCES app_users(id),
  customer_id TEXT REFERENCES customers(id),
  invoice_no TEXT NOT NULL,
  client_operation_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'completed',
  sub_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'paid',
  payment_method TEXT NOT NULL DEFAULT 'cash',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_branch_invoice
ON sales(branch_id, invoice_no);

CREATE INDEX IF NOT EXISTS idx_sales_branch_created
ON sales(branch_id, created_at);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES product_variants(id),
  product_name TEXT NOT NULL,
  barcode TEXT,
  size TEXT,
  color TEXT,
  quantity NUMERIC(12,3) NOT NULL,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale
ON sale_items(sale_id);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  cash_register_id TEXT REFERENCES cash_registers(id),
  type TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  reference_type TEXT,
  reference_id TEXT,
  notes TEXT,
  created_by TEXT REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_branch_created
ON cash_movements(branch_id, created_at);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  cash_register_id TEXT REFERENCES cash_registers(id),
  title TEXT NOT NULL,
  category TEXT,
  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  notes TEXT,
  created_by TEXT REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_branch_created
ON expenses(branch_id, created_at);

INSERT INTO branches (id, code, name, is_active)
VALUES ('main', 'main', 'الفرع الرئيسي', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO warehouses (id, branch_id, name, is_default, is_active)
VALUES ('main-warehouse', 'main', 'مخزن الفرع الرئيسي', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO cash_registers (id, branch_id, code, name, is_active)
VALUES ('main-cashier-1', 'main', 'cashier-1', 'كاشير 1', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoice_counters (branch_id, last_sale_number)
VALUES ('main', 0)
ON CONFLICT (branch_id) DO NOTHING;