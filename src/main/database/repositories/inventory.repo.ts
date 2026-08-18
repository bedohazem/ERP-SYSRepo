import { getDb } from '../db'

const STOCK_SUM_SQL = `
  IFNULL(SUM(
    CASE
      WHEN sm.type = 'in' THEN sm.quantity
      WHEN sm.type = 'out' THEN -sm.quantity
      ELSE 0
    END
  ), 0)
`

export function getInventoryList(input?: {
  search?: string
  status?: 'all' | 'available' | 'low' | 'out'
  categoryId?: number | string | null
}) {
  const db = getDb()

  const search = input?.search?.trim() || ''
  const status = input?.status || 'all'

  const params: any[] = []

  let categorySql = ''
  const rawCategoryId = input?.categoryId
  const categoryId =
    rawCategoryId && rawCategoryId !== 'all' ? Number(rawCategoryId) : null

  if (categoryId && Number.isFinite(categoryId) && categoryId > 0) {
    categorySql = `AND p.category_id = ?`
    params.push(categoryId)
  }

  let searchSql = ''

  if (search) {
    searchSql = `
      AND (
        p.name LIKE ?
        OR IFNULL(v.barcode, '') LIKE ?
        OR IFNULL(v.size, '') LIKE ?
        OR IFNULL(v.color, '') LIKE ?
      )
    `

    const q = `%${search}%`
    params.push(q, q, q, q)
  }

  let havingSql = ''

  if (status === 'available') {
    havingSql = `HAVING stock > v.min_stock`
  }

  if (status === 'low') {
    havingSql = `HAVING stock > 0 AND stock <= v.min_stock`
  }

  if (status === 'out') {
    havingSql = `HAVING stock = 0`
  }

  return db
    .prepare(
      `
      SELECT
        v.id AS variant_id,
        p.id AS product_id,
        p.name AS product_name,
        p.category_id AS category_id,
        c.name AS category_name,
        v.barcode,
        v.size,
        v.color,
        v.buy_price,
        v.sell_price,
        v.min_stock,
        v.is_active,
        p.is_active AS product_is_active,
        ${STOCK_SUM_SQL} AS stock
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN stock_movements sm ON sm.variant_id = v.id
      WHERE p.is_active = 1
        AND v.is_active = 1
        ${categorySql}
        ${searchSql}
      GROUP BY v.id
      ${havingSql}
      ORDER BY
        CASE
          WHEN stock < 0 THEN 0
          WHEN stock = 0 THEN 1
          WHEN stock <= v.min_stock THEN 2
          ELSE 3
        END,
        p.name ASC
    `,
    )
    .all(...params)
}

export type InventoryPageInput = {
  search?: string
  status?: 'all' | 'available' | 'low' | 'out'
  categoryId?: number | string | null
  limit?: number
  offset?: number
}

export function listInventoryPage(input?: InventoryPageInput) {
  const db = getDb()

  const search = input?.search?.trim() || ''
  const status = input?.status || 'all'

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200)

  const offset = Math.max(Number(input?.offset || 0), 0)

  const params: any[] = []

  let categorySql = ''

  const rawCategoryId = input?.categoryId

  const categoryId =
    rawCategoryId && rawCategoryId !== 'all' ? Number(rawCategoryId) : null

  if (categoryId && Number.isFinite(categoryId) && categoryId > 0) {
    categorySql = `AND p.category_id = ?`
    params.push(categoryId)
  }

  let searchSql = ''

  if (search) {
    searchSql = `
      AND (
        p.name LIKE ?
        OR IFNULL(v.barcode, '') LIKE ?
        OR IFNULL(v.size, '') LIKE ?
        OR IFNULL(v.color, '') LIKE ?
      )
    `

    const q = `%${search}%`
    params.push(q, q, q, q)
  }

  let havingSql = ''

  if (status === 'available') {
    havingSql = `HAVING stock > v.min_stock`
  }

  if (status === 'low') {
    havingSql = `
      HAVING stock > 0
        AND stock <= v.min_stock
    `
  }

  if (status === 'out') {
    havingSql = `HAVING stock = 0`
  }

  const baseSql = `
    SELECT
      v.id AS variant_id,
      p.id AS product_id,
      p.name AS product_name,
      p.category_id AS category_id,
      c.name AS category_name,
      v.barcode,
      v.size,
      v.color,
      v.buy_price,
      v.sell_price,
      v.min_stock,
      v.is_active,
      p.is_active AS product_is_active,
      ${STOCK_SUM_SQL} AS stock
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN stock_movements sm ON sm.variant_id = v.id
    WHERE p.is_active = 1
      AND v.is_active = 1
      ${categorySql}
      ${searchSql}
    GROUP BY v.id
    ${havingSql}
  `

  const rows = db
    .prepare(
      `
      SELECT *
      FROM (
        ${baseSql}
      ) inventory
      ORDER BY
        CASE
          WHEN stock < 0 THEN 0
          WHEN stock = 0 THEN 1
          WHEN stock <= min_stock THEN 2
          ELSE 3
        END,
        product_name ASC,
        variant_id ASC
      LIMIT ?
      OFFSET ?
    `,
    )
    .all(...params, limit, offset)

  const summaryRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,

        IFNULL(
          SUM(
            CASE
              WHEN stock > min_stock THEN 1
              ELSE 0
            END
          ),
          0
        ) AS available,

        IFNULL(
          SUM(
            CASE
              WHEN stock > 0
               AND stock <= min_stock
              THEN 1
              ELSE 0
            END
          ),
          0
        ) AS low,

        IFNULL(
          SUM(
            CASE
              WHEN stock = 0 THEN 1
              ELSE 0
            END
          ),
          0
        ) AS out,

        IFNULL(
          SUM(
            CASE
              WHEN stock > 0
              THEN stock * buy_price
              ELSE 0
            END
          ),
          0
        ) AS total_buy_value,

        IFNULL(
          SUM(
            CASE
              WHEN stock > 0
              THEN stock * sell_price
              ELSE 0
            END
          ),
          0
        ) AS total_sell_value

      FROM (
        ${baseSql}
      ) inventory
    `,
    )
    .get(...params) as any

  const total = Number(summaryRow?.total || 0)

  return {
    rows,
    total,
    limit,
    offset,

    summary: {
      total,
      available: Number(summaryRow?.available || 0),
      low: Number(summaryRow?.low || 0),
      out: Number(summaryRow?.out || 0),
      totalBuyValue: Number(summaryRow?.total_buy_value || 0),
      totalSellValue: Number(summaryRow?.total_sell_value || 0),
    },
  }
}

export function getVariantStock(variantId: number) {
  const db = getDb()

  const row = db
    .prepare(
      `
      SELECT
        IFNULL(SUM(
          CASE
            WHEN type = 'in' THEN quantity
            WHEN type = 'out' THEN -quantity
            ELSE 0
          END
        ), 0) AS stock
      FROM stock_movements
      WHERE variant_id = ?
    `,
    )
    .get(variantId) as { stock: number } | undefined

  return Number(row?.stock || 0)
}

export function adjustVariantStock(input: {
  variant_id: number
  target_stock: number
  notes?: string | null
}) {
  const db = getDb()

  const variantId = Number(input.variant_id)
  const targetStock = Number(input.target_stock)

  if (!variantId) {
    throw new Error('Variant ID is required')
  }

  if (!Number.isFinite(targetStock) || targetStock < 0) {
    throw new Error('المخزون الجديد غير صحيح')
  }

  const variant = db
    .prepare(
      `
      SELECT
        v.id,
        p.name AS product_name,
        v.size,
        v.color
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id = ?
      LIMIT 1
    `,
    )
    .get(variantId) as any

  if (!variant) {
    throw new Error('الصنف غير موجود')
  }

  const tx = db.transaction(() => {
    const oldStock = getVariantStock(variantId)
    const diff = targetStock - oldStock

    if (diff === 0) {
      return {
        success: true,
        variant_id: variantId,
        old_stock: oldStock,
        new_stock: targetStock,
        diff: 0,
      }
    }

    db.prepare(
      `
      INSERT INTO stock_movements (
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes
      )
      VALUES (?, ?, ?, NULL, 'manual_adjust', ?)
    `,
    ).run(
      variantId,
      diff > 0 ? 'in' : 'out',
      Math.abs(diff),
      input.notes?.trim() || `تسوية مخزون: من ${oldStock} إلى ${targetStock}`,
    )

    return {
      success: true,
      variant_id: variantId,
      old_stock: oldStock,
      new_stock: targetStock,
      diff,
    }
  })

  return tx()
}

export function getStockMovements(
  input: {
    variant_id?: number
    search?: string
    limit?: number
    offset?: number
  } = {},
) {
  const db = getDb()

  const variantId = input.variant_id ? Number(input.variant_id) : null

  const search = input.search?.trim() || ''

  const limit = Math.min(Math.max(Number(input.limit || 50), 1), 200)

  const offset = Math.max(Number(input.offset || 0), 0)

  const where: string[] = []
  const params: any[] = []

  if (variantId) {
    where.push(`sm.variant_id = ?`)
    params.push(variantId)
  }

  if (search) {
    where.push(`
      (
        p.name LIKE ?
        OR IFNULL(v.barcode, '') LIKE ?
        OR IFNULL(v.size, '') LIKE ?
        OR IFNULL(v.color, '') LIKE ?
        OR IFNULL(sm.reference_type, '') LIKE ?
        OR IFNULL(sm.notes, '') LIKE ?
      )
    `)

    const q = `%${search}%`

    params.push(q, q, q, q, q, q)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = db
    .prepare(
      `
      SELECT
        sm.id,
        sm.variant_id,
        sm.type,
        sm.quantity,

        CASE
          WHEN sm.type = 'in' THEN sm.quantity
          WHEN sm.type = 'out' THEN -sm.quantity
          ELSE 0
        END AS signed_quantity,

        sm.reference_id,
        sm.reference_type,
        sm.notes,
        sm.created_at,

        p.name AS product_name,
        v.barcode,
        v.size,
        v.color

      FROM stock_movements sm

      JOIN product_variants v
        ON v.id = sm.variant_id

      JOIN products p
        ON p.id = v.product_id

      ${whereSql}

      ORDER BY sm.id DESC

      LIMIT ?
      OFFSET ?
    `,
    )
    .all(...params, limit, offset)

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total

      FROM stock_movements sm

      JOIN product_variants v
        ON v.id = sm.variant_id

      JOIN products p
        ON p.id = v.product_id

      ${whereSql}
    `,
    )
    .get(...params) as { total: number }

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset,
  }
}
