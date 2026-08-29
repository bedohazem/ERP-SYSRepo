import { getDb } from '../db'
import { createCashMovement, resolveCashAccount } from './cash.repo'

export type CustomerInput = {
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
}

export type CustomerUpdateInput = CustomerInput & {
  id: number
  is_active?: number
}

export function getCustomers() {
  const db = getDb()

  return db
    .prepare(
      `
      SELECT
        c.*,
        COUNT(s.id) AS sales_count,
        MAX(s.created_at) AS last_sale_at
      FROM customers c
      LEFT JOIN sales s ON s.customer_id = c.id
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.id DESC
    `,
    )
    .all()
}

export function searchCustomers(query: string) {
  const db = getDb()
  const q = `%${query.trim()}%`

  return db
    .prepare(
      `
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
    `,
    )
    .all(q, q, q)
}

export function listCustomers(input?: {
  search?: string
  debtors_only?: boolean
  limit?: number
  offset?: number
}) {
  const db = getDb()

  const search = input?.search?.trim() || ''

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200)

  const offset = Math.max(Number(input?.offset || 0), 0)

  const baseWhere: string[] = [`c.is_active = 1`]

  const baseParams: any[] = []

  if (search) {
    baseWhere.push(`
      (
        c.name LIKE ?
        OR IFNULL(c.phone, '') LIKE ?
        OR IFNULL(c.email, '') LIKE ?
        OR IFNULL(c.address, '') LIKE ?
      )
    `)

    const q = `%${search}%`

    baseParams.push(q, q, q, q)
  }

  const rowsWhere = [...baseWhere]

  if (input?.debtors_only) {
    rowsWhere.push(`IFNULL(c.balance, 0) > 0`)
  }

  const rowsWhereSql = `WHERE ${rowsWhere.join(' AND ')}`

  const rows = db
    .prepare(
      `
      SELECT
        c.*,
        COUNT(s.id) AS sales_count,
        MAX(s.created_at) AS last_sale_at

      FROM customers c

      LEFT JOIN sales s
        ON s.customer_id = c.id

      ${rowsWhereSql}

      GROUP BY c.id

      ORDER BY
        IFNULL(c.balance, 0) DESC,
        c.id DESC

      LIMIT ?
      OFFSET ?
    `,
    )
    .all(...baseParams, limit, offset)

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total

      FROM customers c

      ${rowsWhereSql}
    `,
    )
    .get(...baseParams) as {
    total: number
  }

  const debtWhere = [...baseWhere, `IFNULL(c.balance, 0) > 0`]

  const debtWhereSql = `WHERE ${debtWhere.join(' AND ')}`

  const debtSummaryRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS debtors_count,
        IFNULL(
          SUM(IFNULL(c.balance, 0)),
          0
        ) AS total_debt

      FROM customers c

      ${debtWhereSql}
    `,
    )
    .get(...baseParams) as any

  const topDebtor = db
    .prepare(
      `
      SELECT
        c.id,
        c.name,
        c.balance

      FROM customers c

      ${debtWhereSql}

      ORDER BY
        IFNULL(c.balance, 0) DESC,
        c.id DESC

      LIMIT 1
    `,
    )
    .get(...baseParams) as any

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset,

    summary: {
      total_debt: Number(debtSummaryRow?.total_debt || 0),

      debtors_count: Number(debtSummaryRow?.debtors_count || 0),

      top_debtor: topDebtor
        ? {
            id: Number(topDebtor.id),
            name: String(topDebtor.name || ''),
            balance: Number(topDebtor.balance || 0),
          }
        : null,
    },
  }
}

export function createCustomer(input: CustomerInput) {
  const db = getDb()

  const name = input.name?.trim()
  const phone = input.phone?.trim() || null
  const email = input.email?.trim() || null
  const address = input.address?.trim() || null
  const notes = input.notes?.trim() || null

  if (!name) {
    throw new Error('اسم العميل مطلوب')
  }

  const result = db
    .prepare(
      `
      INSERT INTO customers (
        name,
        phone,
        email,
        address,
        notes
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(name, phone, email, address, notes)

  return getCustomerById(Number(result.lastInsertRowid))
}

export function updateCustomer(input: CustomerUpdateInput) {
  const db = getDb()

  const name = input.name?.trim()
  const phone = input.phone?.trim() || null
  const email = input.email?.trim() || null
  const address = input.address?.trim() || null
  const notes = input.notes?.trim() || null

  if (!input.id) {
    throw new Error('Customer ID is required')
  }

  if (!name) {
    throw new Error('اسم العميل مطلوب')
  }

  db.prepare(
    `
    UPDATE customers
    SET
      name = ?,
      phone = ?,
      email = ?,
      address = ?,
      notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  ).run(name, phone, email, address, notes, input.id)

  return getCustomerById(input.id)
}

export function deleteCustomer(id: number) {
  const db = getDb()

  db.prepare(
    `
    UPDATE customers
    SET is_active = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  ).run(id)

  return { ok: true }
}

export function getCustomerById(id: number) {
  const db = getDb()

  return db
    .prepare(
      `
      SELECT
        c.*,
        COUNT(s.id) AS sales_count,
        MAX(s.created_at) AS last_sale_at
      FROM customers c
      LEFT JOIN sales s ON s.customer_id = c.id
      WHERE c.id = ?
      GROUP BY c.id
      LIMIT 1
    `,
    )
    .get(id)
}

export function getCustomerHistory(customerId: number) {
  const db = getDb()

  const customer = getCustomerById(customerId)

  const sales = db
    .prepare(
      `
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
    `,
    )
    .all(customerId)

  const loyalty = db
    .prepare(
      `
      SELECT *
      FROM loyalty_transactions
      WHERE customer_id = ?
      ORDER BY id DESC
    `,
    )
    .all(customerId)

  return {
    customer,
    sales,
    loyalty,
  }
}

export function adjustCustomerPoints(input: {
  customer_id: number
  points: number
  notes?: string | null
}) {
  const db = getDb()

  const customerId = Number(input.customer_id)
  const points = Number(input.points || 0)

  if (!customerId) {
    throw new Error('Customer ID is required')
  }

  if (!points) {
    throw new Error('عدد النقاط مطلوب')
  }

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE customers
      SET points_balance = points_balance + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    ).run(points, customerId)

    db.prepare(
      `
      INSERT INTO loyalty_transactions (
        customer_id,
        sale_id,
        type,
        points,
        amount,
        notes
      )
      VALUES (?, NULL, 'adjust', ?, 0, ?)
    `,
    ).run(customerId, points, input.notes ?? null)

    return getCustomerById(customerId)
  })

  return tx()
}

export function recordCustomerPayment(input: {
  customer_id: number
  sale_id?: number | null
  amount: number
  payment_method?: string
  notes?: string | null
  actor_id?: number | null
}) {
  const db = getDb()

  const customerId = Number(input.customer_id)
  const saleId = input.sale_id ? Number(input.sale_id) : null
  const amountInput = Number(input.amount || 0)

  if (!customerId) {
    throw new Error('Customer ID is required')
  }

  if (!Number.isFinite(amountInput) || amountInput <= 0) {
    throw new Error('مبلغ الدفعة غير صحيح')
  }

  const tx = db.transaction(() => {
    const customer = db
      .prepare(`SELECT * FROM customers WHERE id = ? AND is_active = 1 LIMIT 1`)
      .get(customerId) as any

    if (!customer) {
      throw new Error('العميل غير موجود')
    }

    const businessDateRow = db
      .prepare(
        `
    SELECT date('now', 'localtime') AS business_date
    `,
      )
      .get() as { business_date: string }

    const businessDate = String(businessDateRow?.business_date || '')

    const batchResult = db
      .prepare(
        `
    INSERT INTO customer_payment_batches (
      customer_id,
      sale_id,
      amount,
      payment_method,
      notes,
      created_by,
      business_date
    )
    VALUES (?, ?, 0, ?, ?, ?, ?)
    `,
      )
      .run(
        customerId,
        saleId,
        input.payment_method || 'cash',
        input.notes?.trim() || null,
        input.actor_id ?? null,
        businessDate,
      )

    const paymentBatchId = Number(batchResult.lastInsertRowid)

    const insertPayment = db.prepare(`
      INSERT INTO customer_payments (
        customer_id,
        sale_id,
        batch_id,
        amount,
        payment_method,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const updateSale = db.prepare(`
      UPDATE sales
      SET
        paid = ?,
        remaining_amount = ?,
        payment_status = ?
      WHERE id = ?
    `)

    let totalPaid = 0
    const allocations: Array<{
      sale_id: number | null
      amount: number
    }> = []

    // دفعة على فاتورة معينة
    if (saleId) {
      const sale = db
        .prepare(
          `
          SELECT *
          FROM sales
          WHERE id = ?
            AND customer_id = ?
            AND IFNULL(type, 'sale') = 'sale'
            AND cancelled_at IS NULL
          LIMIT 1
        `,
        )
        .get(saleId, customerId) as any

      if (!sale) {
        throw new Error('الفاتورة غير موجودة')
      }

      const remaining = Number(sale.remaining_amount || 0)

      if (remaining <= 0) {
        throw new Error('الفاتورة مدفوعة بالكامل بالفعل')
      }

      const finalAmount = Math.min(amountInput, remaining)

      const newPaid = Math.min(
        Number(sale.grand_total || 0),
        Number(sale.paid || 0) + finalAmount,
      )

      const newRemaining = Math.max(0, remaining - finalAmount)

      const newStatus =
        newRemaining === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid'

      updateSale.run(newPaid, newRemaining, newStatus, saleId)

      insertPayment.run(
        customerId,
        saleId,
        paymentBatchId,
        finalAmount,
        input.payment_method || 'cash',
        input.notes?.trim() || `دفعة على فاتورة بيع رقم ${saleId}`,
      )

      totalPaid = finalAmount

      allocations.push({
        sale_id: saleId,
        amount: finalAmount,
      })
    } else {
      // دفعة عامة للعميل: تتوزع على أقدم فواتير مفتوحة
      const customerBalance = Number(customer.balance || 0)
      let remainingPayment = Math.min(amountInput, customerBalance)

      if (remainingPayment <= 0) {
        throw new Error('لا يوجد رصيد مستحق على العميل')
      }

      const openSales = db
        .prepare(
          `
          SELECT *
          FROM sales
          WHERE customer_id = ?
            AND IFNULL(type, 'sale') = 'sale'
            AND cancelled_at IS NULL
            AND remaining_amount > 0
          ORDER BY id ASC
        `,
        )
        .all(customerId) as any[]

      if (openSales.length === 0) {
        throw new Error('لا توجد فواتير مفتوحة لهذا العميل')
      }

      for (const sale of openSales) {
        if (remainingPayment <= 0) break

        const saleRemaining = Number(sale.remaining_amount || 0)
        const payNow = Math.min(remainingPayment, saleRemaining)

        const newPaid = Math.min(
          Number(sale.grand_total || 0),
          Number(sale.paid || 0) + payNow,
        )

        const newRemaining = Math.max(0, saleRemaining - payNow)

        const newStatus =
          newRemaining === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid'

        updateSale.run(newPaid, newRemaining, newStatus, sale.id)
        insertPayment.run(
          customerId,
          sale.id,
          paymentBatchId,
          payNow,
          input.payment_method || 'cash',
          input.notes?.trim() ||
            `دفعة عامة موزعة على فاتورة بيع رقم ${sale.id}`,
        )

        totalPaid += payNow
        remainingPayment -= payNow

        allocations.push({
          sale_id: sale.id,
          amount: payNow,
        })
      }
    }

    if (totalPaid <= 0) {
      throw new Error('لم يتم تسجيل أي دفعة')
    }

    db.prepare(
      `
      UPDATE customer_payment_batches
      SET amount = ?
      WHERE id = ?
      `,
    ).run(totalPaid, paymentBatchId)

    db.prepare(
      `
      UPDATE customers
      SET
        balance = MAX(IFNULL(balance, 0) - ?, 0),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    ).run(totalPaid, customerId)

    createCashMovement({
      type: 'customer_payment',
      direction: 'in',
      amount: totalPaid,
      payment_method: input.payment_method || 'cash',

      reference_id: paymentBatchId,
      reference_type: 'customer_payment',

      notes: input.notes?.trim() || 'دفعة من عميل',

      created_by: input.actor_id ?? null,
      business_date: businessDate,
    })

    return {
      ok: true,

      customer_id: customerId,

      payment_batch_id: paymentBatchId,

      paid_amount: totalPaid,

      allocations,
    }
  })

  return tx()
}

export function getCustomerPaymentBatchAccess(
  batchId: number,
  actorId?: number | null,
) {
  const db = getDb()

  const row = db
    .prepare(
      `
      SELECT
        id,
        created_by,

        CASE
          WHEN created_by = ?
            AND datetime(created_at)
              BETWEEN datetime('now', '-24 hours')
              AND datetime('now')
          THEN 0
          ELSE 1
        END AS requires_admin_password

      FROM customer_payment_batches

      WHERE id = ?

      LIMIT 1
      `,
    )
    .get(Number(actorId || 0), Number(batchId)) as
    | {
        id: number
        created_by: number | null
        requires_admin_password: number
      }
    | undefined

  if (!row) {
    throw new Error('دفعة العميل غير موجودة')
  }

  return {
    batch_id: Number(row.id),

    created_by: row.created_by == null ? null : Number(row.created_by),

    requires_admin_password: Number(row.requires_admin_password || 0) === 1,
  }
}

export function cancelCustomerPaymentBatch(input: {
  batch_id: number
  reason?: string | null
  actor_id?: number | null
}) {
  const db = getDb()

  const batchId = Number(input.batch_id || 0)

  if (!batchId) {
    throw new Error('رقم دفعة العميل غير صحيح')
  }

  const reason = String(input.reason || '').trim() || 'إلغاء دفعة عميل'

  const batch = db
    .prepare(
      `
      SELECT
        b.*,

        COALESCE(
          NULLIF(b.business_date, ''),
          date(b.created_at, 'localtime')
        ) AS accounting_date

      FROM customer_payment_batches b

      WHERE b.id = ?

      LIMIT 1
      `,
    )
    .get(batchId) as any

  if (!batch) {
    throw new Error('دفعة العميل غير موجودة')
  }

  if (batch.cancelled_at) {
    throw new Error('دفعة العميل ملغاة بالفعل')
  }

  const accountingDate = String(batch.accounting_date || '')

  if (accountingDate) {
    const closing = db
      .prepare(
        `
        SELECT id
        FROM cash_day_closings
        WHERE business_date = ?
        LIMIT 1
        `,
      )
      .get(accountingDate)

    if (closing) {
      throw new Error(
        `لا يمكن إلغاء الدفعة لأن يوم ${accountingDate} تم تقفيله`,
      )
    }
  }

  const allocations = db
    .prepare(
      `
      SELECT
        cp.id,
        cp.sale_id,
        cp.amount,

        s.paid,
        s.remaining_amount,
        s.grand_total,
        s.cancelled_at AS sale_cancelled_at

      FROM customer_payments cp

      JOIN sales s
        ON s.id = cp.sale_id

      WHERE cp.batch_id = ?

      ORDER BY cp.id ASC
      `,
    )
    .all(batchId) as any[]

  if (allocations.length === 0) {
    throw new Error('لا توجد توزيعات مرتبطة بدفعة العميل')
  }

  if (allocations.some((allocation) => allocation.sale_cancelled_at)) {
    throw new Error('لا يمكن إلغاء الدفعة لأن إحدى الفواتير المرتبطة بها ملغاة')
  }

  const allocationTotal = allocations.reduce(
    (sum, allocation) => sum + Number(allocation.amount || 0),
    0,
  )

  if (Math.abs(allocationTotal - Number(batch.amount || 0)) > 0.01) {
    throw new Error('بيانات دفعة العميل غير متطابقة')
  }

  const cashMovement = db
    .prepare(
      `
      SELECT *
      FROM cash_movements

      WHERE type = 'customer_payment'

        AND reference_type = 'customer_payment'

        AND reference_id = ?

      ORDER BY id DESC

      LIMIT 1
      `,
    )
    .get(batchId) as any

  if (!cashMovement) {
    throw new Error('حركة الخزنة الخاصة بدفعة العميل غير موجودة')
  }

  if (cashMovement.cancelled_at) {
    throw new Error('حركة الخزنة الخاصة بالدفعة ملغاة بالفعل')
  }

  const cashBalanceRow = db
    .prepare(
      `
    SELECT
      IFNULL(
        SUM(
          CASE
            WHEN direction = 'in'
            THEN amount

            WHEN direction = 'out'
            THEN -amount

            ELSE 0
          END
        ),
        0
      ) AS balance

    FROM cash_movements

    WHERE payment_method = ?
      AND cancelled_at IS NULL
    `,
    )
    .get(String(cashMovement.payment_method || 'store_cash')) as
    | {
        balance: number
      }
    | undefined

  const currentCashBalance = Number(cashBalanceRow?.balance || 0)

  if (currentCashBalance + 0.0001 < allocationTotal) {
    throw new Error(
      `لا يمكن إلغاء الدفعة لأن رصيد حساب الدفع الحالي لا يكفي لعكس مبلغ ${allocationTotal.toFixed(2)} ج.م`,
    )
  }

  const tx = db.transaction(() => {
    for (const allocation of allocations) {
      const amount = Number(allocation.amount || 0)

      const nextPaid = Math.max(0, Number(allocation.paid || 0) - amount)

      const nextRemaining = Math.min(
        Number(allocation.grand_total || 0),

        Math.max(0, Number(allocation.remaining_amount || 0) + amount),
      )

      const nextStatus =
        nextRemaining <= 0 ? 'paid' : nextPaid > 0 ? 'partial' : 'unpaid'

      db.prepare(
        `
        UPDATE sales

        SET
          paid = ?,
          remaining_amount = ?,
          payment_status = ?

        WHERE id = ?
        `,
      ).run(nextPaid, nextRemaining, nextStatus, Number(allocation.sale_id))
    }

    db.prepare(
      `
      UPDATE customers

      SET
        balance =
          IFNULL(balance, 0) + ?,

        updated_at = CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(allocationTotal, Number(batch.customer_id))

    db.prepare(
      `
      UPDATE customer_payment_batches

      SET
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancel_reason = ?

      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, reason, batchId)

    db.prepare(
      `
      UPDATE cash_movements

      SET
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancel_reason = ?

      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, reason, Number(cashMovement.id))

    return {
      success: true,

      batch_id: batchId,

      customer_id: Number(batch.customer_id),

      cancelled_amount: allocationTotal,

      allocations: allocations.map((allocation) => ({
        sale_id: Number(allocation.sale_id),

        amount: Number(allocation.amount || 0),
      })),
    }
  })

  return tx()
}

export function updateCustomerPaymentBatch(input: {
  batch_id: number
  amount: number
  payment_method?: string
  notes?: string | null
  actor_id?: number | null
}) {
  const db = getDb()

  const batchId = Number(input.batch_id || 0)
  const amountInput = Number(input.amount || 0)

  if (!batchId) {
    throw new Error('رقم دفعة العميل غير صحيح')
  }

  if (!Number.isFinite(amountInput) || amountInput <= 0) {
    throw new Error('مبلغ الدفعة المعدل غير صحيح')
  }

  const batch = db
    .prepare(
      `
      SELECT
        b.*,

        COALESCE(
          NULLIF(b.business_date, ''),
          date(b.created_at, 'localtime')
        ) AS accounting_date

      FROM customer_payment_batches b

      WHERE b.id = ?

      LIMIT 1
      `,
    )
    .get(batchId) as any

  if (!batch) {
    throw new Error('دفعة العميل غير موجودة')
  }

  if (batch.cancelled_at) {
    throw new Error('لا يمكن تعديل دفعة ملغاة')
  }

  const accountingDate = String(batch.accounting_date || '')

  if (accountingDate) {
    const closing = db
      .prepare(
        `
        SELECT id
        FROM cash_day_closings
        WHERE business_date = ?
        LIMIT 1
        `,
      )
      .get(accountingDate)

    if (closing) {
      throw new Error(
        `لا يمكن تعديل الدفعة لأن يوم ${accountingDate} تم تقفيله`,
      )
    }
  }

  const customer = db
    .prepare(
      `
      SELECT *
      FROM customers
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(Number(batch.customer_id)) as any

  if (!customer) {
    throw new Error('العميل غير موجود')
  }

  const allocations = db
    .prepare(
      `
      SELECT
        cp.id,
        cp.sale_id,
        cp.amount,

        s.paid,
        s.remaining_amount,
        s.grand_total,
        s.cancelled_at AS sale_cancelled_at

      FROM customer_payments cp

      JOIN sales s
        ON s.id = cp.sale_id

      WHERE cp.batch_id = ?

      ORDER BY cp.id ASC
      `,
    )
    .all(batchId) as any[]

  if (allocations.length === 0) {
    throw new Error('لا توجد توزيعات مرتبطة بدفعة العميل')
  }

  if (allocations.some((allocation) => allocation.sale_cancelled_at)) {
    throw new Error('لا يمكن تعديل الدفعة لأن إحدى الفواتير المرتبطة بها ملغاة')
  }

  const oldTotal = allocations.reduce(
    (sum, allocation) => sum + Number(allocation.amount || 0),
    0,
  )

  if (Math.abs(oldTotal - Number(batch.amount || 0)) > 0.01) {
    throw new Error('بيانات دفعة العميل غير متطابقة')
  }

  const cashMovement = db
    .prepare(
      `
      SELECT *
      FROM cash_movements

      WHERE type = 'customer_payment'
        AND direction = 'in'
        AND reference_type = 'customer_payment'
        AND reference_id = ?

      ORDER BY id DESC

      LIMIT 1
      `,
    )
    .get(batchId) as any

  if (!cashMovement) {
    throw new Error('حركة الخزنة الخاصة بدفعة العميل غير موجودة')
  }

  if (cashMovement.cancelled_at) {
    throw new Error('حركة الخزنة الخاصة بالدفعة ملغاة بالفعل')
  }

  if (Math.abs(Number(cashMovement.amount || 0) - oldTotal) > 0.01) {
    throw new Error('قيمة حركة الخزنة لا تطابق قيمة الدفعة')
  }

  const specificSaleId = Number(batch.sale_id || 0)

  const customerAvailableAfterReverse = Math.max(
    0,
    Number(customer.balance || 0) + oldTotal,
  )

  let availableForNewPayment = customerAvailableAfterReverse

  if (specificSaleId) {
    const targetSale = allocations.find(
      (allocation) => Number(allocation.sale_id) === specificSaleId,
    )

    if (!targetSale) {
      throw new Error('الفاتورة المرتبطة بالدفعة غير موجودة')
    }

    const oldAllocationOnSale = allocations.reduce(
      (sum, allocation) =>
        Number(allocation.sale_id) === specificSaleId
          ? sum + Number(allocation.amount || 0)
          : sum,
      0,
    )

    availableForNewPayment = Math.min(
      customerAvailableAfterReverse,

      Math.max(
        0,
        Number(targetSale.remaining_amount || 0) + oldAllocationOnSale,
      ),
    )
  }

  if (amountInput > availableForNewPayment + 0.0001) {
    throw new Error(
      `مبلغ الدفعة المعدل أكبر من المديونية المتاحة وهي ${availableForNewPayment.toFixed(2)} ج.م`,
    )
  }

  const newPaymentMethod =
    String(input.payment_method || batch.payment_method || 'cash').trim() ||
    'cash'

  const oldAccount = resolveCashAccount(
    cashMovement.payment_method || batch.payment_method || 'cash',
  )

  const newAccount = resolveCashAccount(newPaymentMethod)

  const cashBalanceRow = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(
            CASE
              WHEN direction = 'in'
              THEN amount

              WHEN direction = 'out'
              THEN -amount

              ELSE 0
            END
          ),
          0
        ) AS balance

      FROM cash_movements

      WHERE payment_method = ?
        AND cancelled_at IS NULL
      `,
    )
    .get(oldAccount) as
    | {
        balance: number
      }
    | undefined

  const oldAccountBalance = Number(cashBalanceRow?.balance || 0)

  if (oldAccount === newAccount) {
    if (oldAccountBalance + amountInput + 0.0001 < oldTotal) {
      throw new Error('رصيد حساب الدفع الحالي لا يكفي لتنفيذ تعديل الدفعة')
    }
  } else if (oldAccountBalance + 0.0001 < oldTotal) {
    throw new Error('رصيد حساب الدفع القديم لا يكفي لنقل الدفعة إلى حساب آخر')
  }

  const newNotes =
    input.notes === undefined
      ? (batch.notes ?? null)
      : input.notes?.trim() || null

  const originalCreatedBy =
    batch.created_by == null
      ? (input.actor_id ?? null)
      : Number(batch.created_by)

  const tx = db.transaction(() => {
    // عكس تأثير الدفعة القديمة على الفواتير
    for (const allocation of allocations) {
      const amount = Number(allocation.amount || 0)

      const nextPaid = Math.max(0, Number(allocation.paid || 0) - amount)

      const nextRemaining = Math.min(
        Number(allocation.grand_total || 0),

        Math.max(0, Number(allocation.remaining_amount || 0) + amount),
      )

      const nextStatus =
        nextRemaining <= 0 ? 'paid' : nextPaid > 0 ? 'partial' : 'unpaid'

      db.prepare(
        `
        UPDATE sales
        SET
          paid = ?,
          remaining_amount = ?,
          payment_status = ?
        WHERE id = ?
        `,
      ).run(nextPaid, nextRemaining, nextStatus, Number(allocation.sale_id))
    }

    // إعادة المديونية القديمة أولاً
    db.prepare(
      `
      UPDATE customers
      SET
        balance =
          IFNULL(balance, 0) + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
    ).run(oldTotal, Number(batch.customer_id))

    // إنشاء Batch بديل مع الاحتفاظ
    // بتاريخ ومالك العملية الأصليين
    const newBatchResult = db
      .prepare(
        `
        INSERT INTO customer_payment_batches (
          customer_id,
          sale_id,
          amount,
          payment_method,
          notes,
          created_by,
          business_date,
          created_at
        )
        VALUES (?, ?, 0, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        Number(batch.customer_id),
        batch.sale_id ?? null,
        newPaymentMethod,
        newNotes,
        originalCreatedBy,
        accountingDate || null,
        batch.created_at,
      )

    const newBatchId = Number(newBatchResult.lastInsertRowid)

    // تعليم العملية القديمة بأنها استبدلت
    db.prepare(
      `
      UPDATE customer_payment_batches
      SET
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancel_reason = ?,
        replacement_batch_id = ?
      WHERE id = ?
      `,
    ).run(input.actor_id ?? null, 'تم تعديل دفعة العميل', newBatchId, batchId)

    // إلغاء حركة الكاش القديمة
    db.prepare(
      `
      UPDATE cash_movements
      SET
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancel_reason = ?
      WHERE id = ?
      `,
    ).run(
      input.actor_id ?? null,
      'تم تعديل دفعة العميل',
      Number(cashMovement.id),
    )

    const insertPayment = db.prepare(`
      INSERT INTO customer_payments (
        customer_id,
        sale_id,
        batch_id,
        amount,
        payment_method,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const updateSale = db.prepare(`
      UPDATE sales
      SET
        paid = ?,
        remaining_amount = ?,
        payment_status = ?
      WHERE id = ?
    `)

    let totalPaid = 0

    const newAllocations: Array<{
      sale_id: number
      amount: number
    }> = []

    if (specificSaleId) {
      const sale = db
        .prepare(
          `
          SELECT *
          FROM sales
          WHERE id = ?
            AND customer_id = ?
            AND IFNULL(type, 'sale') = 'sale'
            AND cancelled_at IS NULL
          LIMIT 1
          `,
        )
        .get(specificSaleId, Number(batch.customer_id)) as any

      if (!sale) {
        throw new Error('الفاتورة المرتبطة بالدفعة غير موجودة')
      }

      const remaining = Number(sale.remaining_amount || 0)

      if (amountInput > remaining + 0.0001) {
        throw new Error('مبلغ الدفعة المعدل أكبر من المتبقي على الفاتورة')
      }

      const newPaid = Math.min(
        Number(sale.grand_total || 0),
        Number(sale.paid || 0) + amountInput,
      )

      const newRemaining = Math.max(0, remaining - amountInput)

      const newStatus =
        newRemaining === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid'

      updateSale.run(newPaid, newRemaining, newStatus, specificSaleId)

      insertPayment.run(
        Number(batch.customer_id),
        specificSaleId,
        newBatchId,
        amountInput,
        newPaymentMethod,
        newNotes || `دفعة معدلة على فاتورة بيع رقم ${specificSaleId}`,
      )

      totalPaid = amountInput

      newAllocations.push({
        sale_id: specificSaleId,
        amount: amountInput,
      })
    } else {
      let remainingPayment = amountInput

      const openSales = db
        .prepare(
          `
          SELECT *
          FROM sales
          WHERE customer_id = ?
            AND IFNULL(type, 'sale') = 'sale'
            AND cancelled_at IS NULL
            AND remaining_amount > 0
          ORDER BY id ASC
          `,
        )
        .all(Number(batch.customer_id)) as any[]

      for (const sale of openSales) {
        if (remainingPayment <= 0.0001) {
          break
        }

        const saleRemaining = Number(sale.remaining_amount || 0)

        const payNow = Math.min(remainingPayment, saleRemaining)

        if (payNow <= 0) {
          continue
        }

        const newPaid = Math.min(
          Number(sale.grand_total || 0),
          Number(sale.paid || 0) + payNow,
        )

        const newRemaining = Math.max(0, saleRemaining - payNow)

        const newStatus =
          newRemaining === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid'

        updateSale.run(newPaid, newRemaining, newStatus, sale.id)

        insertPayment.run(
          Number(batch.customer_id),
          Number(sale.id),
          newBatchId,
          payNow,
          newPaymentMethod,
          newNotes || `دفعة معدلة موزعة على فاتورة بيع رقم ${sale.id}`,
        )

        totalPaid += payNow
        remainingPayment -= payNow

        newAllocations.push({
          sale_id: Number(sale.id),
          amount: payNow,
        })
      }

      if (remainingPayment > 0.0001) {
        throw new Error('تعذر توزيع كامل مبلغ الدفعة المعدلة')
      }
    }

    if (Math.abs(totalPaid - amountInput) > 0.01) {
      throw new Error('تعذر تسجيل مبلغ الدفعة المعدل بالكامل')
    }

    db.prepare(
      `
      UPDATE customer_payment_batches
      SET amount = ?
      WHERE id = ?
      `,
    ).run(totalPaid, newBatchId)

    db.prepare(
      `
      UPDATE customers
      SET
        balance = MAX(
          IFNULL(balance, 0) - ?,
          0
        ),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
    ).run(totalPaid, Number(batch.customer_id))

    createCashMovement({
      type: 'customer_payment',
      direction: 'in',
      amount: totalPaid,
      payment_method: newPaymentMethod,

      reference_id: newBatchId,
      reference_type: 'customer_payment',

      notes: newNotes || 'دفعة عميل معدلة',

      created_by: originalCreatedBy,

      business_date: accountingDate || null,
    })

    return {
      success: true,

      replaced_batch_id: batchId,
      batch_id: newBatchId,

      customer_id: Number(batch.customer_id),

      old_amount: oldTotal,
      new_amount: totalPaid,

      payment_method: newPaymentMethod,

      allocations: newAllocations,
    }
  })

  return tx()
}

export function getCustomerStatement(
  customerId: number,
  actorId?: number | null,
) {
  const db = getDb()
  const id = Number(customerId)

  if (!id) {
    throw new Error('Customer ID is required')
  }

  const customer = db
    .prepare(
      `
      SELECT *
      FROM customers
      WHERE id = ?
      LIMIT 1
    `,
    )
    .get(id) as any

  if (!customer) {
    throw new Error('العميل غير موجود')
  }

  const sales = db
    .prepare(
      `
      SELECT *
      FROM sales
      WHERE customer_id = ?
        AND IFNULL(type, 'sale') = 'sale'
      ORDER BY created_at DESC, id DESC
    `,
    )
    .all(id) as any[]

  const payments = db
    .prepare(
      `
    SELECT
      cp.*,

      b.amount AS batch_amount,
      b.payment_method AS batch_payment_method,
      b.notes AS batch_notes,
      b.created_by AS batch_created_by,
      b.created_at AS batch_created_at,
      b.cancelled_at AS batch_cancelled_at,
      b.cancelled_by AS batch_cancelled_by,
      b.cancel_reason AS batch_cancel_reason,
      b.replacement_batch_id,

      CASE
        WHEN b.id IS NULL THEN 0

        WHEN b.created_by = ?
          AND datetime(b.created_at)
            BETWEEN datetime('now', '-24 hours')
            AND datetime('now')
        THEN 0

        ELSE 1
      END AS batch_requires_admin_password

    FROM customer_payments cp

    LEFT JOIN customer_payment_batches b
      ON b.id = cp.batch_id

    WHERE cp.customer_id = ?

    ORDER BY cp.created_at DESC, cp.id DESC
    `,
    )
    .all(Number(actorId || 0), id) as any[]

  function isReturnSettlement(payment: any) {
    return String(payment.notes || '').startsWith('تسوية مديونية بسبب مرتجع')
  }

  function isCancelledPaymentBatch(payment: any) {
    return Boolean(payment.batch_id && payment.batch_cancelled_at)
  }

  const normalPaymentsBySale = new Map<number, number>()
  const allPaymentsBySale = new Map<number, number>()

  for (const payment of payments) {
    const saleId = Number(payment.sale_id || 0)
    const amount = Number(payment.amount || 0)

    if (isCancelledPaymentBatch(payment)) {
      continue
    }

    if (!saleId || amount <= 0) continue

    allPaymentsBySale.set(
      saleId,
      Number(allPaymentsBySale.get(saleId) || 0) + amount,
    )

    if (!isReturnSettlement(payment)) {
      normalPaymentsBySale.set(
        saleId,
        Number(normalPaymentsBySale.get(saleId) || 0) + amount,
      )
    }
  }

  const saleEntries = sales.map((sale) => ({
    id: `sale-${sale.id}`,
    type: 'sale',
    title: sale.cancelled_at
      ? `فاتورة بيع #${sale.id} - ملغاة`
      : `فاتورة بيع #${sale.id}`,
    debit: sale.cancelled_at ? 0 : Number(sale.grand_total || 0),
    credit: 0,
    sale_id: sale.id,
    payment_status: sale.payment_status,
    notes: sale.cancelled_at
      ? sale.cancel_reason || 'فاتورة ملغاة'
      : sale.notes,
    created_at: sale.created_at,
  }))

  const initialPaymentEntries = sales
    .filter((sale) => !sale.cancelled_at)
    .map((sale) => {
      const normalLaterPaid = Number(
        normalPaymentsBySale.get(Number(sale.id)) || 0,
      )

      const initialPaid = Math.max(0, Number(sale.paid || 0) - normalLaterPaid)

      return {
        sale,
        initialPaid,
      }
    })
    .filter((item) => item.initialPaid > 0)
    .map(({ sale, initialPaid }) => ({
      id: `sale-paid-${sale.id}`,
      type: 'payment',
      title: `دفعة وقت البيع على فاتورة #${sale.id}`,
      debit: 0,
      credit: initialPaid,
      sale_id: sale.id,
      payment_method: sale.payment_method,
      notes: 'دفعة مسجلة وقت إنشاء الفاتورة',
      created_at: sale.created_at,
    }))

  const batchPayments = new Map<number, any[]>()

  const standalonePayments: any[] = []

  for (const payment of payments) {
    const batchId = Number(payment.batch_id || 0)

    if (!batchId) {
      standalonePayments.push(payment)
      continue
    }

    const current = batchPayments.get(batchId) || []

    current.push(payment)

    batchPayments.set(batchId, current)
  }

  const batchPaymentEntries = Array.from(batchPayments.entries()).map(
    ([batchId, rows]) => {
      const first = rows[0]

      const cancelled = Boolean(first.batch_cancelled_at)

      const replaced = Boolean(first.replacement_batch_id)

      const allocations = rows.map((row) => ({
        sale_id: Number(row.sale_id),

        amount: Number(row.amount || 0),
      }))

      const totalAmount =
        Number(first.batch_amount || 0) ||
        allocations.reduce((sum, item) => sum + item.amount, 0)

      const invoicesText = allocations
        .map((item) => `#${item.sale_id}: ${item.amount.toFixed(2)} ج.م`)
        .join('، ')

      return {
        id: `payment-batch-${batchId}`,

        type: 'payment',

        title: replaced
          ? 'دفعة عميل - تم تعديلها'
          : cancelled
            ? 'دفعة عميل - ملغاة'
            : 'دفعة عميل',

        debit: 0,

        credit: cancelled ? 0 : totalAmount,

        batch_id: batchId,

        batch_created_by:
          first.batch_created_by == null
            ? null
            : Number(first.batch_created_by),

        requires_admin_password: Boolean(first.batch_requires_admin_password),

        payment_method: first.batch_payment_method || first.payment_method,

        notes: cancelled
          ? first.batch_cancel_reason || 'دفعة ملغاة'
          : first.batch_notes || first.notes,

        cancelled_at: first.batch_cancelled_at ?? null,

        replacement_batch_id: first.replacement_batch_id ?? null,

        allocations,

        allocations_text: invoicesText,

        created_at: first.batch_created_at || first.created_at,
      }
    },
  )

  const standalonePaymentEntries = standalonePayments.map((payment) => {
    const returnSettlement = isReturnSettlement(payment)

    return {
      id: `payment-${payment.id}`,

      type: 'payment',

      title: returnSettlement
        ? payment.sale_id
          ? `تسوية مرتجع على فاتورة #${payment.sale_id}`
          : 'تسوية مرتجع'
        : payment.sale_id
          ? `دفعة على فاتورة #${payment.sale_id}`
          : 'دفعة عميل',

      debit: 0,

      credit: Number(payment.amount || 0),

      sale_id: payment.sale_id,

      batch_id: null,

      payment_method: payment.payment_method,

      notes: payment.notes,

      cancelled_at: null,

      created_at: payment.created_at,
    }
  })

  const paymentEntries = [...batchPaymentEntries, ...standalonePaymentEntries]

  const entries = [
    ...saleEntries,
    ...initialPaymentEntries,
    ...paymentEntries,
  ].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const totalSales = sales.reduce(
    (sum, sale) =>
      sum + (sale.cancelled_at ? 0 : Number(sale.grand_total || 0)),
    0,
  )

  const totalInitialPaid = initialPaymentEntries.reduce(
    (sum, entry) => sum + Number(entry.credit || 0),
    0,
  )

  const totalLaterPayments = payments.reduce((sum, payment) => {
    if (isCancelledPaymentBatch(payment)) {
      return sum
    }

    return sum + Number(payment.amount || 0)
  }, 0)

  const openSales = sales.filter((sale) => {
    if (sale.cancelled_at) return false
    const saleId = Number(sale.id)
    const initialPaidEntry = initialPaymentEntries.find(
      (entry) => Number(entry.sale_id) === saleId,
    )

    const initialPaid = Number(initialPaidEntry?.credit || 0)
    const allPayments = Number(allPaymentsBySale.get(saleId) || 0)

    const effectiveRemaining = Math.max(
      0,
      Number(sale.grand_total || 0) - initialPaid - allPayments,
    )

    return effectiveRemaining > 0
  })

  return {
    customer,
    sales,
    payments,
    entries,
    summary: {
      total_sales: totalSales,
      total_paid: totalInitialPaid + totalLaterPayments,
      balance: Number(customer.balance || 0),
      open_sales: openSales.length,
    },
  }
}
