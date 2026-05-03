import { getDb } from '../db';

export type CustomerInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
};

export type CustomerUpdateInput = CustomerInput & {
  id: number;
  is_active?: number;
};

export function getCustomers() {
  const db = getDb();

  return db
    .prepare(`
      SELECT
        c.*,
        COUNT(s.id) AS sales_count,
        MAX(s.created_at) AS last_sale_at
      FROM customers c
      LEFT JOIN sales s ON s.customer_id = c.id
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.id DESC
    `)
    .all();
}

export function searchCustomers(query: string) {
  const db = getDb();
  const q = `%${query.trim()}%`;

  return db
    .prepare(`
      SELECT
        c.*,
        COUNT(s.id) AS sales_count,
        MAX(s.created_at) AS last_sale_at
      FROM customers c
      LEFT JOIN sales s ON s.customer_id = c.id
      WHERE c.is_active = 1
        AND (
          c.name LIKE ?
          OR c.phone LIKE ?
          OR c.email LIKE ?
        )
      GROUP BY c.id
      ORDER BY c.id DESC
      LIMIT 30
    `)
    .all(q, q, q);
}

export function createCustomer(input: CustomerInput) {
  const db = getDb();

  const name = input.name?.trim();
  const phone = input.phone?.trim() || null;
  const email = input.email?.trim() || null;
  const address = input.address?.trim() || null;
  const notes = input.notes?.trim() || null;

  if (!name) {
    throw new Error('اسم العميل مطلوب');
  }

  const result = db
    .prepare(`
      INSERT INTO customers (
        name,
        phone,
        email,
        address,
        notes
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(name, phone, email, address, notes);

  return getCustomerById(Number(result.lastInsertRowid));
}

export function updateCustomer(input: CustomerUpdateInput) {
  const db = getDb();

  const name = input.name?.trim();
  const phone = input.phone?.trim() || null;
  const email = input.email?.trim() || null;
  const address = input.address?.trim() || null;
  const notes = input.notes?.trim() || null;

  if (!input.id) {
    throw new Error('Customer ID is required');
  }

  if (!name) {
    throw new Error('اسم العميل مطلوب');
  }

  db.prepare(`
    UPDATE customers
    SET
      name = ?,
      phone = ?,
      email = ?,
      address = ?,
      notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name, phone, email, address, notes, input.id);

  return getCustomerById(input.id);
}

export function deleteCustomer(id: number) {
  const db = getDb();

  db.prepare(`
    UPDATE customers
    SET is_active = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);

  return { ok: true };
}

export function getCustomerById(id: number) {
  const db = getDb();

  return db
    .prepare(`
      SELECT
        c.*,
        COUNT(s.id) AS sales_count,
        MAX(s.created_at) AS last_sale_at
      FROM customers c
      LEFT JOIN sales s ON s.customer_id = c.id
      WHERE c.id = ?
      GROUP BY c.id
      LIMIT 1
    `)
    .get(id);
}

export function getCustomerHistory(customerId: number) {
  const db = getDb();

  const customer = getCustomerById(customerId);

  const sales = db
    .prepare(`
      SELECT
        id,
        sub_total,
        discount_value,
        grand_total,
        paid,
        change_amount,
        payment_method,
        loyalty_points_earned,
        loyalty_points_redeemed,
        loyalty_discount_value,
        created_at
      FROM sales
      WHERE customer_id = ?
      ORDER BY id DESC
      LIMIT 100
    `)
    .all(customerId);

  const loyalty = db
    .prepare(`
      SELECT *
      FROM loyalty_transactions
      WHERE customer_id = ?
      ORDER BY id DESC
      LIMIT 100
    `)
    .all(customerId);

  return {
    customer,
    sales,
    loyalty
  };
}

export function adjustCustomerPoints(input: {
  customer_id: number;
  points: number;
  notes?: string | null;
}) {
  const db = getDb();

  const customerId = Number(input.customer_id);
  const points = Number(input.points || 0);

  if (!customerId) {
    throw new Error('Customer ID is required');
  }

  if (!points) {
    throw new Error('عدد النقاط مطلوب');
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE customers
      SET points_balance = points_balance + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(points, customerId);

    db.prepare(`
      INSERT INTO loyalty_transactions (
        customer_id,
        sale_id,
        type,
        points,
        amount,
        notes
      )
      VALUES (?, NULL, 'adjust', ?, 0, ?)
    `).run(customerId, points, input.notes ?? null);

    return getCustomerById(customerId);
  });

  return tx();
}