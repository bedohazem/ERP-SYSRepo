import { getDb } from '../db';
import { createCashMovement } from './cash.repo';

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

export function recordCustomerPayment(input: {
  customer_id: number;
  sale_id?: number | null;
  amount: number;
  payment_method?: string;
  notes?: string | null;
}) {
  const db = getDb();

  const customerId = Number(input.customer_id);
  const saleId = input.sale_id ? Number(input.sale_id) : null;
  const amountInput = Number(input.amount || 0);

  if (!customerId) {
    throw new Error('Customer ID is required');
  }

  if (!Number.isFinite(amountInput) || amountInput <= 0) {
    throw new Error('مبلغ الدفعة غير صحيح');
  }

  const tx = db.transaction(() => {
    const customer = db
      .prepare(`SELECT * FROM customers WHERE id = ? AND is_active = 1 LIMIT 1`)
      .get(customerId) as any;

    if (!customer) {
      throw new Error('العميل غير موجود');
    }

    const insertPayment = db.prepare(`
      INSERT INTO customer_payments (
        customer_id,
        sale_id,
        amount,
        payment_method,
        notes
      )
      VALUES (?, ?, ?, ?, ?)
    `);

    const updateSale = db.prepare(`
      UPDATE sales
      SET
        paid = ?,
        remaining_amount = ?,
        payment_status = ?
      WHERE id = ?
    `);

    let totalPaid = 0;
    const allocations: Array<{
      sale_id: number | null;
      amount: number;
    }> = [];

    // دفعة على فاتورة معينة
    if (saleId) {
      const sale = db
        .prepare(`
          SELECT *
          FROM sales
          WHERE id = ?
            AND customer_id = ?
            AND IFNULL(type, 'sale') = 'sale'
          LIMIT 1
        `)
        .get(saleId, customerId) as any;

      if (!sale) {
        throw new Error('الفاتورة غير موجودة');
      }

      const remaining = Number(sale.remaining_amount || 0);

      if (remaining <= 0) {
        throw new Error('الفاتورة مدفوعة بالكامل بالفعل');
      }

      const finalAmount = Math.min(amountInput, remaining);

      const newPaid = Math.min(
        Number(sale.grand_total || 0),
        Number(sale.paid || 0) + finalAmount
      );

      const newRemaining = Math.max(0, Number(sale.grand_total || 0) - newPaid);

      const newStatus =
        newRemaining === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

      updateSale.run(newPaid, newRemaining, newStatus, saleId);

      insertPayment.run(
        customerId,
        saleId,
        finalAmount,
        input.payment_method || 'cash',
        input.notes?.trim() || `دفعة على فاتورة بيع رقم ${saleId}`
      );

      totalPaid = finalAmount;

      allocations.push({
        sale_id: saleId,
        amount: finalAmount
      });
    } else {
      // دفعة عامة للعميل: تتوزع على أقدم فواتير مفتوحة
      const customerBalance = Number(customer.balance || 0);
      let remainingPayment = Math.min(amountInput, customerBalance);

      if (remainingPayment <= 0) {
        throw new Error('لا يوجد رصيد مستحق على العميل');
      }

      const openSales = db
        .prepare(`
          SELECT *
          FROM sales
          WHERE customer_id = ?
            AND IFNULL(type, 'sale') = 'sale'
            AND remaining_amount > 0
          ORDER BY id ASC
        `)
        .all(customerId) as any[];

      if (openSales.length === 0) {
        throw new Error('لا توجد فواتير مفتوحة لهذا العميل');
      }

      for (const sale of openSales) {
        if (remainingPayment <= 0) break;

        const saleRemaining = Number(sale.remaining_amount || 0);
        const payNow = Math.min(remainingPayment, saleRemaining);

        const newPaid = Math.min(
          Number(sale.grand_total || 0),
          Number(sale.paid || 0) + payNow
        );

        const newRemaining = Math.max(0, Number(sale.grand_total || 0) - newPaid);

        const newStatus =
          newRemaining === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

        updateSale.run(newPaid, newRemaining, newStatus, sale.id);

        insertPayment.run(
          customerId,
          sale.id,
          payNow,
          input.payment_method || 'cash',
          input.notes?.trim() || `دفعة عامة موزعة على فاتورة بيع رقم ${sale.id}`
        );

        totalPaid += payNow;
        remainingPayment -= payNow;

        allocations.push({
          sale_id: sale.id,
          amount: payNow
        });
      }
    }

    if (totalPaid <= 0) {
      throw new Error('لم يتم تسجيل أي دفعة');
    }

    db.prepare(`
      UPDATE customers
      SET
        balance = MAX(IFNULL(balance, 0) - ?, 0),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(totalPaid, customerId);

    createCashMovement({
      type: 'customer_payment',
      direction: 'in',
      amount: totalPaid,
      payment_method: input.payment_method || 'cash',
      reference_id: saleId,
      reference_type: saleId ? 'sale' : 'customer_payment',
      notes: input.notes?.trim() || 'دفعة من عميل',
      created_by: (input as any).actor_id ?? null
    });

    return {
      ok: true,
      customer_id: customerId,
      paid_amount: totalPaid,
      allocations
    };
  });

  return tx();
}

export function getCustomerStatement(customerId: number) {
  const db = getDb();
  const id = Number(customerId);

  if (!id) {
    throw new Error('Customer ID is required');
  }

  const customer = db
    .prepare(`
      SELECT *
      FROM customers
      WHERE id = ?
      LIMIT 1
    `)
    .get(id) as any;

  if (!customer) {
    throw new Error('العميل غير موجود');
  }

  const sales = db
    .prepare(`
      SELECT *
      FROM sales
      WHERE customer_id = ?
        AND IFNULL(type, 'sale') = 'sale'
      ORDER BY created_at DESC, id DESC
    `)
    .all(id) as any[];

  const payments = db
    .prepare(`
      SELECT *
      FROM customer_payments
      WHERE customer_id = ?
      ORDER BY created_at DESC, id DESC
    `)
    .all(id) as any[];

  const entries = [
    ...sales.map((sale) => ({
      id: `sale-${sale.id}`,
      type: 'sale',
      title: `فاتورة بيع #${sale.id}`,
      debit: Number(sale.grand_total || 0),
      credit: 0,
      sale_id: sale.id,
      payment_status: sale.payment_status,
      notes: sale.notes,
      created_at: sale.created_at
    })),

    ...payments.map((payment) => ({
      id: `payment-${payment.id}`,
      type: 'payment',
      title: payment.sale_id
        ? `دفعة على فاتورة #${payment.sale_id}`
        : 'دفعة عميل',
      debit: 0,
      credit: Number(payment.amount || 0),
      sale_id: payment.sale_id,
      payment_method: payment.payment_method,
      notes: payment.notes,
      created_at: payment.created_at
    }))
  ].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return {
    customer,
    sales,
    payments,
    entries,
    summary: {
      total_sales: sales.reduce((sum, s) => sum + Number(s.grand_total || 0), 0),
      total_paid: payments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
      balance: Number(customer.balance || 0),
      open_sales: sales.filter((s) => Number(s.remaining_amount || 0) > 0).length
    }
  };
}