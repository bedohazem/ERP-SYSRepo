import { getDb } from '../db'

export type PromotionType = 'percent' | 'fixed_per_item' | 'fixed_invoice'

export type PromotionScope = 'all' | 'category' | 'products'

export type PromotionInput = {
  name: string

  type: PromotionType
  value: number

  scope_type: PromotionScope

  category_id?: number | null
  product_ids?: number[]

  actor_id?: number | null
}

function normalizeProductIds(value?: number[]) {
  return Array.from(
    new Set(
      (value || []).map(Number).filter((id) => Number.isFinite(id) && id > 0),
    ),
  )
}

function validatePromotion(input: PromotionInput) {
  const name = String(input.name || '').trim()

  if (!name) {
    throw new Error('اسم العرض مطلوب')
  }

  const value = Number(input.value)

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('قيمة العرض غير صحيحة')
  }

  if (input.type === 'percent' && value > 100) {
    throw new Error('نسبة الخصم لا يمكن أن تتجاوز 100%')
  }

  if (!['percent', 'fixed_per_item', 'fixed_invoice'].includes(input.type)) {
    throw new Error('نوع العرض غير صحيح')
  }

  if (!['all', 'category', 'products'].includes(input.scope_type)) {
    throw new Error('نطاق العرض غير صحيح')
  }

  const db = getDb()

  if (input.scope_type === 'category') {
    const categoryId = Number(input.category_id)

    const category = db
      .prepare(
        `
          SELECT id
          FROM categories
          WHERE id = ?
            AND is_active = 1
          LIMIT 1
          `,
      )
      .get(categoryId)

    if (!category) {
      throw new Error('اختار تصنيف صحيح للعرض')
    }
  }

  if (input.scope_type === 'products') {
    const productIds = normalizeProductIds(input.product_ids)

    if (productIds.length === 0) {
      throw new Error('اختار منتج واحد على الأقل')
    }

    const placeholders = productIds.map(() => '?').join(', ')

    const row = db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM products
          WHERE id IN (
            ${placeholders}
          )
            AND is_active = 1
          `,
      )
      .get(...productIds) as {
      count: number
    }

    if (Number(row.count || 0) !== productIds.length) {
      throw new Error('يوجد منتج غير صحيح أو غير فعال داخل العرض')
    }
  }
}

function replacePromotionProducts(promotionId: number, productIds: number[]) {
  const db = getDb()

  db.prepare(
    `
    DELETE FROM promotion_products
    WHERE promotion_id = ?
    `,
  ).run(promotionId)

  if (productIds.length === 0) {
    return
  }

  const insert = db.prepare(
    `
      INSERT INTO promotion_products (
        promotion_id,
        product_id
      )
      VALUES (?, ?)
      `,
  )

  for (const productId of productIds) {
    insert.run(promotionId, productId)
  }
}

export function listPromotions() {
  const db = getDb()

  return db
    .prepare(
      `
      SELECT
        pr.*,

        c.name AS category_name,

        (
          SELECT COUNT(*)
          FROM promotion_products pp
          WHERE pp.promotion_id =
            pr.id
        ) AS products_count,

        (
          SELECT GROUP_CONCAT(
            p.name,
            '، '
          )
          FROM promotion_products pp
          JOIN products p
            ON p.id =
              pp.product_id
          WHERE pp.promotion_id =
            pr.id
        ) AS products_names

      FROM promotions pr

      LEFT JOIN categories c
        ON c.id =
          pr.category_id

      ORDER BY
        pr.is_active DESC,
        pr.id DESC
      `,
    )
    .all()
}

export function getPromotion(promotionId: number) {
  const db = getDb()

  const promotion = db
    .prepare(
      `
        SELECT
          pr.*,
          c.name AS category_name

        FROM promotions pr

        LEFT JOIN categories c
          ON c.id =
            pr.category_id

        WHERE pr.id = ?
        LIMIT 1
        `,
    )
    .get(Number(promotionId)) as any

  if (!promotion) {
    return null
  }

  const productRows = db
    .prepare(
      `
        SELECT product_id
        FROM promotion_products
        WHERE promotion_id = ?
        ORDER BY product_id ASC
        `,
    )
    .all(Number(promotionId)) as Array<{
    product_id: number
  }>

  return {
    ...promotion,

    product_ids: productRows.map((row) => Number(row.product_id)),
  }
}

export function getActivePromotion() {
  const db = getDb()

  const row = db
    .prepare(
      `
        SELECT id
        FROM promotions
        WHERE is_active = 1
        ORDER BY id DESC
        LIMIT 1
        `,
    )
    .get() as
    | {
        id: number
      }
    | undefined

  if (!row) {
    return null
  }

  return getPromotion(Number(row.id))
}

export function createPromotion(input: PromotionInput) {
  validatePromotion(input)

  const db = getDb()

  const productIds =
    input.scope_type === 'products'
      ? normalizeProductIds(input.product_ids)
      : []

  const categoryId =
    input.scope_type === 'category' ? Number(input.category_id) : null

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `
            INSERT INTO promotions (
              name,
              type,
              value,
              scope_type,
              category_id,
              is_active,
              created_by
            )
            VALUES (
              ?, ?, ?, ?, ?, 0, ?
            )
            `,
      )
      .run(
        String(input.name).trim(),

        input.type,

        Number(input.value),

        input.scope_type,

        categoryId,

        input.actor_id ?? null,
      )

    const promotionId = Number(result.lastInsertRowid)

    replacePromotionProducts(promotionId, productIds)

    return promotionId
  })

  const promotionId = tx()

  return {
    success: true,
    promotionId,
  }
}

export function updatePromotion(
  input: PromotionInput & {
    id: number
  },
) {
  validatePromotion(input)

  const db = getDb()

  const id = Number(input.id)

  const existing = db
    .prepare(
      `
        SELECT id
        FROM promotions
        WHERE id = ?
        LIMIT 1
        `,
    )
    .get(id)

  if (!existing) {
    throw new Error('العرض غير موجود')
  }

  const productIds =
    input.scope_type === 'products'
      ? normalizeProductIds(input.product_ids)
      : []

  const categoryId =
    input.scope_type === 'category' ? Number(input.category_id) : null

  const tx = db.transaction(() => {
    db.prepare(
      `
        UPDATE promotions
        SET
          name = ?,
          type = ?,
          value = ?,
          scope_type = ?,
          category_id = ?,
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
        `,
    ).run(
      String(input.name).trim(),

      input.type,

      Number(input.value),

      input.scope_type,

      categoryId,

      id,
    )

    replacePromotionProducts(id, productIds)
  })

  tx()

  return {
    success: true,
  }
}

export function togglePromotion(promotionId: number, isActive: number) {
  const db = getDb()

  const id = Number(promotionId)

  const existing = db
    .prepare(
      `
        SELECT id
        FROM promotions
        WHERE id = ?
        LIMIT 1
        `,
    )
    .get(id)

  if (!existing) {
    throw new Error('العرض غير موجود')
  }

  const nextActive = Number(isActive) ? 1 : 0

  const tx = db.transaction(() => {
    if (nextActive) {
      db.prepare(
        `
          UPDATE promotions
          SET
            is_active = 0,
            updated_at =
              CURRENT_TIMESTAMP
          WHERE is_active = 1
          `,
      ).run()
    }

    db.prepare(
      `
        UPDATE promotions
        SET
          is_active = ?,
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
        `,
    ).run(nextActive, id)
  })

  tx()

  return {
    success: true,
    is_active: nextActive,
  }
}
