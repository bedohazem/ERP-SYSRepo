import type Database from 'better-sqlite3'

type Db = Database.Database

const STOCK_EPSILON = 0.000001
const VALUE_EPSILON = 0.01

function roundCost(value: number) {
  const amount = Number(value || 0)

  if (!Number.isFinite(amount)) {
    return 0
  }

  return Number(amount.toFixed(4))
}

function roundValue(value: number) {
  const amount = Number(value || 0)

  if (!Number.isFinite(amount)) {
    return 0
  }

  return Number(amount.toFixed(4))
}

export type InventoryCostState = {
  variant_id: number

  stock: number

  buy_price: number

  average_cost: number

  inventory_value: number
}

type StockMovementInput = {
  variant_id: number
  quantity: number

  reference_id?: number | null
  reference_type: string

  notes?: string | null
}

type InboundStockMovementInput = StockMovementInput & {
  unit_cost: number
}

type SpecificCostOutboundInput = StockMovementInput & {
  unit_cost: number
}

export function getInventoryCostState(
  database: Db,
  variantIdInput: number,
): InventoryCostState {
  const variantId = Number(variantIdInput)

  if (!variantId) {
    throw new Error('رقم الصنف غير صحيح')
  }

  const row = database
    .prepare(
      `
      SELECT
        pv.id AS variant_id,

        IFNULL(
          pv.buy_price,
          0
        ) AS buy_price,

        IFNULL(
          pv.average_cost,
          0
        ) AS average_cost,

        IFNULL(
          pv.inventory_value,
          0
        ) AS inventory_value,

        IFNULL(
          (
            SELECT SUM(
              CASE
                WHEN sm.type = 'in'
                  THEN sm.quantity

                WHEN sm.type = 'out'
                  THEN -sm.quantity

                ELSE 0
              END
            )

            FROM stock_movements sm

            WHERE
              sm.variant_id =
                pv.id
          ),
          0
        ) AS stock

      FROM product_variants pv

      WHERE pv.id = ?

      LIMIT 1
      `,
    )
    .get(variantId) as
    | {
        variant_id: number
        stock: number
        buy_price: number
        average_cost: number
        inventory_value: number
      }
    | undefined

  if (!row) {
    throw new Error('الصنف غير موجود')
  }

  return {
    variant_id: Number(row.variant_id),

    stock: Number(row.stock || 0),

    buy_price: roundCost(Number(row.buy_price || 0)),

    average_cost: roundCost(Number(row.average_cost || 0)),

    inventory_value: roundValue(Number(row.inventory_value || 0)),
  }
}

function updateCostState(
  database: Db,
  variantId: number,
  averageCost: number,
  inventoryValue: number,
) {
  database
    .prepare(
      `
      UPDATE product_variants

      SET
        average_cost = ?,
        inventory_value = ?

      WHERE id = ?
      `,
    )
    .run(
      roundCost(averageCost),

      roundValue(inventoryValue),

      variantId,
    )
}

function insertCostedMovement(
  database: Db,
  input: {
    variant_id: number

    type: 'in' | 'out'

    quantity: number

    unit_cost: number
    cost_value: number

    reference_id?: number | null
    reference_type: string

    notes?: string | null
  },
) {
  database
    .prepare(
      `
      INSERT INTO stock_movements (
        variant_id,

        type,
        quantity,

        unit_cost,
        cost_value,

        reference_id,
        reference_type,

        notes
      )

      VALUES (
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?
      )
      `,
    )
    .run(
      input.variant_id,

      input.type,
      input.quantity,

      roundCost(input.unit_cost),

      roundValue(input.cost_value),

      input.reference_id ?? null,

      input.reference_type,

      input.notes?.trim() || null,
    )
}

export function receiveStockAtCost(
  database: Db,
  input: InboundStockMovementInput,
) {
  const variantId = Number(input.variant_id)

  const quantity = Number(input.quantity)

  const unitCost = Number(input.unit_cost)

  if (!variantId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('كمية دخول المخزون غير صحيحة')
  }

  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new Error('تكلفة دخول المخزون غير صحيحة')
  }

  const state = getInventoryCostState(database, variantId)

  if (state.stock < -STOCK_EPSILON) {
    throw new Error(
      'لا يمكن حساب متوسط التكلفة لصنف مخزونه سالب. صحح المخزون أولًا',
    )
  }

  const movementValue = roundValue(quantity * unitCost)

  const nextStock = state.stock + quantity

  const nextInventoryValue = roundValue(state.inventory_value + movementValue)

  const nextAverageCost =
    nextStock > STOCK_EPSILON ? roundCost(nextInventoryValue / nextStock) : 0

  insertCostedMovement(database, {
    variant_id: variantId,

    type: 'in',

    quantity,

    unit_cost: unitCost,

    cost_value: movementValue,

    reference_id: input.reference_id,

    reference_type: input.reference_type,

    notes: input.notes,
  })

  updateCostState(database, variantId, nextAverageCost, nextInventoryValue)

  return {
    unit_cost: roundCost(unitCost),

    cost_value: movementValue,

    stock: nextStock,

    average_cost: nextAverageCost,

    inventory_value: nextInventoryValue,
  }
}

export function issueStockAtAverageCost(
  database: Db,
  input: StockMovementInput,
) {
  const variantId = Number(input.variant_id)

  const quantity = Number(input.quantity)

  if (!variantId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('كمية خروج المخزون غير صحيحة')
  }

  const state = getInventoryCostState(database, variantId)

  if (state.stock + STOCK_EPSILON < quantity) {
    throw new Error(`المخزون غير كافي. المتاح: ${state.stock}`)
  }

  const unitCost = state.average_cost

  const movementValue = roundValue(quantity * unitCost)

  const nextStock = state.stock - quantity

  let nextInventoryValue = roundValue(state.inventory_value - movementValue)

  if (Math.abs(nextInventoryValue) <= VALUE_EPSILON) {
    nextInventoryValue = 0
  }

  if (nextInventoryValue < -VALUE_EPSILON) {
    throw new Error('قيمة المخزون أصبحت سالبة ولا يمكن تنفيذ الحركة')
  }

  const nextAverageCost =
    nextStock > STOCK_EPSILON ? roundCost(nextInventoryValue / nextStock) : 0

  insertCostedMovement(database, {
    variant_id: variantId,

    type: 'out',

    quantity,

    unit_cost: unitCost,

    cost_value: movementValue,

    reference_id: input.reference_id,

    reference_type: input.reference_type,

    notes: input.notes,
  })

  updateCostState(
    database,
    variantId,
    nextAverageCost,
    nextStock > STOCK_EPSILON ? nextInventoryValue : 0,
  )

  return {
    unit_cost: unitCost,

    cost_value: movementValue,

    stock: nextStock,

    average_cost: nextAverageCost,

    inventory_value: nextStock > STOCK_EPSILON ? nextInventoryValue : 0,
  }
}

export function issueStockAtCost(
  database: Db,
  input: SpecificCostOutboundInput,
) {
  const variantId = Number(input.variant_id)

  const quantity = Number(input.quantity)

  const unitCost = Number(input.unit_cost)

  if (!variantId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('كمية خروج المخزون غير صحيحة')
  }

  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new Error('تكلفة خروج المخزون غير صحيحة')
  }

  const state = getInventoryCostState(database, variantId)

  if (state.stock + STOCK_EPSILON < quantity) {
    throw new Error(`المخزون غير كافي. المتاح: ${state.stock}`)
  }

  const movementValue = roundValue(quantity * unitCost)

  const nextStock = state.stock - quantity

  let nextInventoryValue = roundValue(state.inventory_value - movementValue)

  if (Math.abs(nextInventoryValue) <= VALUE_EPSILON) {
    nextInventoryValue = 0
  }

  if (nextInventoryValue < -VALUE_EPSILON) {
    throw new Error(
      'لا يمكن تنفيذ الحركة لأن قيمتها أكبر من قيمة المخزون الحالية',
    )
  }

  if (
    nextStock <= STOCK_EPSILON &&
    Math.abs(nextInventoryValue) > VALUE_EPSILON
  ) {
    throw new Error('لا يمكن تصفير كمية المخزون مع بقاء قيمة محاسبية للمخزون')
  }

  const nextAverageCost =
    nextStock > STOCK_EPSILON ? roundCost(nextInventoryValue / nextStock) : 0

  insertCostedMovement(database, {
    variant_id: variantId,

    type: 'out',

    quantity,

    unit_cost: unitCost,

    cost_value: movementValue,

    reference_id: input.reference_id,

    reference_type: input.reference_type,

    notes: input.notes,
  })

  updateCostState(
    database,
    variantId,
    nextAverageCost,
    nextStock > STOCK_EPSILON ? nextInventoryValue : 0,
  )

  return {
    unit_cost: roundCost(unitCost),

    cost_value: movementValue,

    stock: nextStock,

    average_cost: nextAverageCost,

    inventory_value: nextStock > STOCK_EPSILON ? nextInventoryValue : 0,
  }
}
