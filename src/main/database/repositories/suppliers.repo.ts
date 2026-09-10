import { getDb } from '../db'

export type SupplierInput = {
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
}

export type SupplierUpdateInput = SupplierInput & {
  id: number
}

function cleanText(value?: string | null) {
  const text = value?.trim()
  return text ? text : null
}

export function getSuppliers(search = '') {
  const db = getDb()
  const q = `%${search.trim()}%`

  if (!search.trim()) {
    return db
      .prepare(
        `
        SELECT *
        FROM suppliers
        WHERE is_active = 1
        ORDER BY
        CASE
          WHEN IFNULL(balance, 0) > 0 THEN 0
          ELSE 1
        END ASC,
        IFNULL(balance, 0) DESC,
        id DESC
      `,
      )
      .all()
  }

  return db
    .prepare(
      `
      SELECT *
      FROM suppliers
      WHERE is_active = 1
        AND (
          name LIKE ?
          OR IFNULL(phone, '') LIKE ?
          OR IFNULL(email, '') LIKE ?
          OR IFNULL(address, '') LIKE ?
        )
      ORDER BY
      CASE
        WHEN IFNULL(balance, 0) > 0 THEN 0
        ELSE 1
      END ASC,
      IFNULL(balance, 0) DESC,
      id DESC
    `,
    )
    .all(q, q, q, q)
}

export function listSuppliers(input?: {
  search?: string
  limit?: number
  offset?: number
}) {
  const db = getDb()

  const search = input?.search?.trim() || ''

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200)

  const offset = Math.max(Number(input?.offset || 0), 0)

  const where: string[] = [`is_active = 1`]

  const params: any[] = []

  if (search) {
    where.push(`
      (
        name LIKE ?
        OR IFNULL(phone, '') LIKE ?
        OR IFNULL(email, '') LIKE ?
        OR IFNULL(address, '') LIKE ?
      )
    `)

    const q = `%${search}%`

    params.push(q, q, q, q)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = db
    .prepare(
      `
      SELECT *
      FROM suppliers

      ${whereSql}

      ORDER BY
      CASE
        WHEN IFNULL(balance, 0) > 0 THEN 0
        ELSE 1
      END ASC,
      IFNULL(balance, 0) DESC,
      id DESC

      LIMIT ?
      OFFSET ?
    `,
    )
    .all(...params, limit, offset)

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM suppliers

      ${whereSql}
    `,
    )
    .get(...params) as {
    total: number
  }

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset,
  }
}

export function getSupplierById(id: number) {
  const db = getDb()

  return db
    .prepare(
      `
      SELECT *
      FROM suppliers
      WHERE id = ?
      LIMIT 1
    `,
    )
    .get(id)
}

export function createSupplier(input: SupplierInput) {
  const db = getDb()

  const name = input.name?.trim()

  if (!name) {
    throw new Error('اسم المورد مطلوب')
  }

  const result = db
    .prepare(
      `
      INSERT INTO suppliers (
        name,
        phone,
        email,
        address,
        notes
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(
      name,
      cleanText(input.phone),
      cleanText(input.email),
      cleanText(input.address),
      cleanText(input.notes),
    )

  return getSupplierById(Number(result.lastInsertRowid))
}

export function updateSupplier(input: SupplierUpdateInput) {
  const db = getDb()

  const id = Number(input.id)
  const name = input.name?.trim()

  if (!id) {
    throw new Error('Supplier ID is required')
  }

  if (!name) {
    throw new Error('اسم المورد مطلوب')
  }

  db.prepare(
    `
    UPDATE suppliers
    SET
      name = ?,
      phone = ?,
      email = ?,
      address = ?,
      notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  ).run(
    name,
    cleanText(input.phone),
    cleanText(input.email),
    cleanText(input.address),
    cleanText(input.notes),
    id,
  )

  return getSupplierById(id)
}

export function deleteSupplier(id: number) {
  const db = getDb()

  const supplierId = Number(id)

  if (!supplierId) {
    throw new Error('رقم المورد غير صحيح')
  }

  const supplier = db
    .prepare(
      `
      SELECT
        id,
        name,
        IFNULL(balance, 0) AS balance
      FROM suppliers
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
      `,
    )
    .get(supplierId) as
    | {
        id: number
        name: string
        balance: number
      }
    | undefined

  if (!supplier) {
    throw new Error('المورد غير موجود')
  }

  const openDebtRow = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(remaining_amount),
          0
        ) AS open_debt
      FROM purchase_invoices
      WHERE supplier_id = ?
        AND cancelled_at IS NULL
        AND remaining_amount > 0
      `,
    )
    .get(supplierId) as
    | {
        open_debt: number
      }
    | undefined

  const outstandingAmount = Math.max(
    Number(supplier.balance || 0),
    Number(openDebtRow?.open_debt || 0),
  )

  if (Number(outstandingAmount.toFixed(2)) > 0) {
    throw new Error(
      `لا يمكن حذف المورد لأن له مستحقات بقيمة ${outstandingAmount.toFixed(2)} ج.م`,
    )
  }

  db.prepare(
    `
    UPDATE suppliers
    SET
      is_active = 0,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
  ).run(supplierId)

  return { ok: true }
}
