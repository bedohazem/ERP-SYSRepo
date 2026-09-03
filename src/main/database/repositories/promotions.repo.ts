import { getDb } from '../db'

export type PromotionType =
  | 'percent'
  | 'fixed_per_item'
  | 'fixed_invoice'
  | 'buy_x_get_y'

export type PromotionScope = 'all' | 'category' | 'products'

export type PromotionInput = {
  name: string

  type: PromotionType
  value: number
  buy_qty?: number | null
  free_qty?: number | null
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

  if (
    !['percent', 'fixed_per_item', 'fixed_invoice', 'buy_x_get_y'].includes(
      input.type,
    )
  ) {
    throw new Error('نوع العرض غير صحيح')
  }

  if (input.type === 'buy_x_get_y') {
    const buyQty = Number(input.buy_qty)

    const freeQty = Number(input.free_qty)

    if (!Number.isInteger(buyQty) || buyQty <= 0) {
      throw new Error('كمية الشراء في العرض غير صحيحة')
    }

    if (!Number.isInteger(freeQty) || freeQty <= 0) {
      throw new Error('كمية الهدية في العرض غير صحيحة')
    }
  } else {
    const value = Number(input.value)

    if (!Number.isFinite(value) || value <= 0) {
      throw new Error('قيمة العرض غير صحيحة')
    }

    if (input.type === 'percent' && value > 100) {
      throw new Error('نسبة الخصم لا يمكن أن تتجاوز 100%')
    }
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

type PromotionSaleItem = {
  variant_id: number
  quantity: number
  unit_price: number
}

function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2))
}

export function calculateActivePromotionForSale(items: PromotionSaleItem[]) {
  const db = getDb()

  const promotion = getActivePromotion() as any

  const itemDiscounts = items.map(() => 0)

  if (!promotion) {
    return {
      promotion: null,
      promotion_discount_value: 0,
      item_discounts: itemDiscounts,
    }
  }

  const productIds = new Set<number>(
    Array.isArray(promotion.product_ids)
      ? promotion.product_ids.map(Number)
      : [],
  )

  const getVariantScope = db.prepare(
    `
      SELECT
        pv.product_id,
        p.category_id

      FROM product_variants pv

      JOIN products p
        ON p.id = pv.product_id

      WHERE pv.id = ?
      LIMIT 1
      `,
  )

  const eligibleItems = items
    .map((item, index) => {
      const qty = Math.max(0, Number(item.quantity || 0))

      const unitPrice = Math.max(0, Number(item.unit_price || 0))

      const lineTotal = roundMoney(qty * unitPrice)

      const scope = getVariantScope.get(Number(item.variant_id)) as
        | {
            product_id: number
            category_id: number | null
          }
        | undefined

      if (!scope) {
        return null
      }

      let eligible = false

      if (promotion.scope_type === 'all') {
        eligible = true
      }

      if (promotion.scope_type === 'category') {
        eligible = Number(scope.category_id) === Number(promotion.category_id)
      }

      if (promotion.scope_type === 'products') {
        eligible = productIds.has(Number(scope.product_id))
      }

      if (!eligible) {
        return null
      }

      return {
        index,
        qty,
        unitPrice,
        lineTotal,
      }
    })
    .filter(Boolean) as Array<{
    index: number
    qty: number
    unitPrice: number
    lineTotal: number
  }>

  if (eligibleItems.length === 0) {
    return {
      promotion,
      promotion_discount_value: 0,
      item_discounts: itemDiscounts,
    }
  }

  const value = Math.max(0, Number(promotion.value || 0))

  if (promotion.type === 'buy_x_get_y') {
    const buyQty = Math.floor(Number(promotion.buy_qty || 0))

    const freeQty = Math.floor(Number(promotion.free_qty || 0))

    if (buyQty <= 0 || freeQty <= 0) {
      return {
        promotion,
        promotion_discount_value: 0,
        item_discounts: itemDiscounts,
      }
    }

    const groupSize = buyQty + freeQty

    const totalEligibleUnits = eligibleItems.reduce(
      (total, item) => total + Math.floor(item.qty),
      0,
    )

    let remainingFreeUnits =
      Math.floor(totalEligibleUnits / groupSize) * freeQty

    const cheapestFirst = [...eligibleItems].sort(
      (a, b) => a.unitPrice - b.unitPrice || a.index - b.index,
    )

    for (const item of cheapestFirst) {
      if (remainingFreeUnits <= 0) {
        break
      }

      const itemUnits = Math.floor(item.qty)

      const freeFromItem = Math.min(remainingFreeUnits, itemUnits)

      itemDiscounts[item.index] = roundMoney(freeFromItem * item.unitPrice)

      remainingFreeUnits -= freeFromItem
    }
  }

  if (promotion.type === 'percent') {
    const percent = Math.min(value, 100)

    for (const item of eligibleItems) {
      itemDiscounts[item.index] = Math.min(
        item.lineTotal,
        roundMoney(item.lineTotal * (percent / 100)),
      )
    }
  }

  if (promotion.type === 'fixed_per_item') {
    for (const item of eligibleItems) {
      const discountPerItem = Math.min(item.unitPrice, value)

      itemDiscounts[item.index] = Math.min(
        item.lineTotal,
        roundMoney(discountPerItem * item.qty),
      )
    }
  }

  if (promotion.type === 'fixed_invoice') {
    const eligibleSubtotal = roundMoney(
      eligibleItems.reduce((total, item) => total + item.lineTotal, 0),
    )

    const targetDiscount = Math.min(eligibleSubtotal, value)

    let remaining = roundMoney(targetDiscount)

    eligibleItems.forEach((item, index) => {
      const isLast = index === eligibleItems.length - 1

      let discount = isLast
        ? remaining
        : roundMoney(targetDiscount * (item.lineTotal / eligibleSubtotal))

      discount = Math.min(item.lineTotal, discount)

      itemDiscounts[item.index] = discount

      remaining = roundMoney(remaining - discount)
    })
  }

  const totalDiscount = roundMoney(
    itemDiscounts.reduce((total, discount) => total + Number(discount || 0), 0),
  )

  return {
    promotion,
    promotion_discount_value: totalDiscount,
    item_discounts: itemDiscounts,
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

  const isBuyXGetY = input.type === 'buy_x_get_y'

  const promotionValue = isBuyXGetY ? 0 : Number(input.value)

  const buyQty = isBuyXGetY ? Number(input.buy_qty) : null

  const freeQty = isBuyXGetY ? Number(input.free_qty) : null

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `
            INSERT INTO promotions (
              name,
              type,
              value,
              buy_qty,
              free_qty,
              scope_type,
              category_id,
              is_active,
              created_by
            )
            VALUES (
              ?, ?, ?, ?, ?, ?, ?, 0, ?
            )
            `,
      )
      .run(
        String(input.name).trim(),

        input.type,

        promotionValue,

        buyQty,

        freeQty,

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

  const isBuyXGetY = input.type === 'buy_x_get_y'

  const promotionValue = isBuyXGetY ? 0 : Number(input.value)

  const buyQty = isBuyXGetY ? Number(input.buy_qty) : null

  const freeQty = isBuyXGetY ? Number(input.free_qty) : null

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
          buy_qty = ?,
          free_qty = ?,
          scope_type = ?,
          category_id = ?,
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
        `,
    ).run(
      String(input.name).trim(),

      input.type,

      promotionValue,

      buyQty,

      freeQty,

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
