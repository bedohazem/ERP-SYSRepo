import type Database from 'better-sqlite3';
import { allocateProportionalAmount, roundCost } from '../../shared/money';

type Db = Database.Database;

const STOCK_EPSILON = 0.000001;
const VALUE_EPSILON = 0.0001;

function roundAverageCost(value: unknown): number {
  return roundCost(value);
}

export type InventoryCostState = {
  variant_id: number;

  stock: number;

  buy_price: number;

  average_cost: number;

  inventory_value: number;
};

type StockMovementInput = {
  variant_id: number;
  quantity: number;

  reference_id?: number | null;
  reference_type: string;

  created_by: number | null;

  notes?: string | null;
};

type InboundStockMovementInput = StockMovementInput & {
  unit_cost: number;

  /*
   * القيمة الحقيقية الكاملة للحركة.
   *
   * تستخدم عندما يكون إجمالي البند
   * هو مصدر الحقيقة، مثل تسعير المجموعة.
   */
  cost_value?: number;
};

type SpecificCostOutboundInput = StockMovementInput & {
  unit_cost: number;

  /*
   * تستخدم لعكس نفس القيمة المحاسبية
   * الأصلية بالضبط.
   */
  cost_value?: number;
};

export function getInventoryCostState(
  database: Db,
  variantIdInput: number,
): InventoryCostState {
  const variantId = Number(variantIdInput);

  if (!variantId) {
    throw new Error('رقم الصنف غير صحيح');
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
        variant_id: number;
        stock: number;
        buy_price: number;
        average_cost: number;
        inventory_value: number;
      }
    | undefined;

  if (!row) {
    throw new Error('الصنف غير موجود');
  }

  return {
    variant_id: Number(row.variant_id),

    stock: Number(row.stock || 0),

    buy_price: roundCost(Number(row.buy_price || 0)),

    average_cost: roundAverageCost(row.average_cost),

    inventory_value: roundCost(Number(row.inventory_value || 0)),
  };
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
      roundAverageCost(averageCost),

      roundCost(inventoryValue),

      variantId,
    );
}

function insertCostedMovement(
  database: Db,
  input: {
    variant_id: number;

    type: 'in' | 'out';

    quantity: number;

    unit_cost: number;
    cost_value: number;

    reference_id?: number | null;
    reference_type: string;
    created_by: number | null;
    notes?: string | null;
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

        created_by,

        notes
      )

      VALUES (
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?,
        ?
      )
      `,
    )
    .run(
      input.variant_id,

      input.type,
      input.quantity,

      roundCost(input.unit_cost),

      roundCost(input.cost_value),

      input.reference_id ?? null,

      input.reference_type,
      input.created_by ? Number(input.created_by) : null,
      input.notes?.trim() || null,
    );
}

export function receiveStockAtCost(
  database: Db,
  input: InboundStockMovementInput,
) {
  const variantId = Number(input.variant_id);

  const quantity = Number(input.quantity);

  const rawUnitCost = Number(input.unit_cost);

  if (!variantId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('كمية دخول المخزون غير صحيحة');
  }

  if (!Number.isFinite(rawUnitCost) || rawUnitCost < 0) {
    throw new Error('تكلفة دخول المخزون غير صحيحة');
  }

  const rawCostValue = input.cost_value;

  if (
    rawCostValue !== undefined &&
    (!Number.isFinite(Number(rawCostValue)) || Number(rawCostValue) < 0)
  ) {
    throw new Error('قيمة دخول المخزون غير صحيحة');
  }

  const state = getInventoryCostState(database, variantId);

  if (state.stock < -STOCK_EPSILON) {
    throw new Error(
      'لا يمكن حساب متوسط التكلفة لصنف مخزونه سالب. صحح المخزون أولًا',
    );
  }

  /*
   * لو عندنا قيمة فعلية للبند،
   * فهي مصدر الحقيقة.
   *
   * مثال:
   * 12 قطعة = 1870
   *
   * لا نحولها إلى:
   * 155.83 × 12
   */
  const movementValue =
    rawCostValue !== undefined
      ? roundCost(rawCostValue)
      : roundCost(quantity * rawUnitCost);

  /*
   * سعر الوحدة هنا للعرض والمساعدة فقط.
   * أقصى دقة قرشين.
   */
  const movementUnitCost =
    quantity > 0 ? roundCost(movementValue / quantity) : roundCost(rawUnitCost);

  const nextStock = state.stock + quantity;

  const nextInventoryValue = roundCost(state.inventory_value + movementValue);

  const nextAverageCost =
    nextStock > STOCK_EPSILON
      ? roundAverageCost(nextInventoryValue / nextStock)
      : 0;

  insertCostedMovement(database, {
    variant_id: variantId,

    type: 'in',

    quantity,

    unit_cost: movementUnitCost,

    cost_value: movementValue,

    reference_id: input.reference_id,

    reference_type: input.reference_type,

    created_by: input.created_by,

    notes: input.notes,
  });

  updateCostState(database, variantId, nextAverageCost, nextInventoryValue);

  return {
    unit_cost: movementUnitCost,

    cost_value: movementValue,

    stock: nextStock,

    average_cost: nextAverageCost,

    inventory_value: nextInventoryValue,
  };
}

export function issueStockAtAverageCost(
  database: Db,
  input: StockMovementInput,
) {
  const variantId = Number(input.variant_id);

  const quantity = Number(input.quantity);

  if (!variantId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('كمية خروج المخزون غير صحيحة');
  }

  const state = getInventoryCostState(database, variantId);

  if (state.stock + STOCK_EPSILON < quantity) {
    throw new Error(`المخزون غير كافي. المتاح: ${state.stock}`);
  }

  /*
   * قيمة المخزون هي مصدر الحقيقة.
   *
   * لا نستخدم:
   * average_cost × quantity
   *
   * لأن متوسط الوحدة مقرب للقرش.
   */
  const movementValue = allocateProportionalAmount(
    state.inventory_value,
    quantity,
    state.stock,
  );

  const movementUnitCost = roundCost(movementValue / quantity);

  const nextStock = state.stock - quantity;

  let nextInventoryValue = roundCost(state.inventory_value - movementValue);

  if (Math.abs(nextInventoryValue) <= VALUE_EPSILON) {
    nextInventoryValue = 0;
  }

  if (nextInventoryValue < -VALUE_EPSILON) {
    throw new Error('قيمة المخزون أصبحت سالبة ولا يمكن تنفيذ الحركة');
  }

  /*
   * لو خرج آخر مخزون،
   * لا نترك أي قرش معلق.
   */
  if (nextStock <= STOCK_EPSILON) {
    nextInventoryValue = 0;
  }

  const nextAverageCost =
    nextStock > STOCK_EPSILON
      ? roundAverageCost(nextInventoryValue / nextStock)
      : 0;

  insertCostedMovement(database, {
    variant_id: variantId,

    type: 'out',

    quantity,

    unit_cost: movementUnitCost,

    cost_value: movementValue,

    reference_id: input.reference_id,

    reference_type: input.reference_type,

    created_by: input.created_by,

    notes: input.notes,
  });

  updateCostState(database, variantId, nextAverageCost, nextInventoryValue);

  return {
    unit_cost: movementUnitCost,

    cost_value: movementValue,

    stock: nextStock,

    average_cost: nextAverageCost,

    inventory_value: nextInventoryValue,
  };
}

export function issueStockAtCost(
  database: Db,
  input: SpecificCostOutboundInput,
) {
  const variantId = Number(input.variant_id);

  const quantity = Number(input.quantity);

  const rawUnitCost = Number(input.unit_cost);

  if (!variantId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('كمية خروج المخزون غير صحيحة');
  }

  if (!Number.isFinite(rawUnitCost) || rawUnitCost < 0) {
    throw new Error('تكلفة خروج المخزون غير صحيحة');
  }

  const rawCostValue = input.cost_value;

  if (
    rawCostValue !== undefined &&
    (!Number.isFinite(Number(rawCostValue)) || Number(rawCostValue) < 0)
  ) {
    throw new Error('قيمة خروج المخزون غير صحيحة');
  }

  const state = getInventoryCostState(database, variantId);

  if (state.stock + STOCK_EPSILON < quantity) {
    throw new Error(`المخزون غير كافي. المتاح: ${state.stock}`);
  }

  const movementValue =
    rawCostValue !== undefined
      ? roundCost(rawCostValue)
      : roundCost(quantity * rawUnitCost);

  const movementUnitCost = roundCost(movementValue / quantity);

  const nextStock = state.stock - quantity;

  let nextInventoryValue = roundCost(state.inventory_value - movementValue);

  if (Math.abs(nextInventoryValue) <= VALUE_EPSILON) {
    nextInventoryValue = 0;
  }

  if (nextInventoryValue < -VALUE_EPSILON) {
    throw new Error(
      'لا يمكن تنفيذ الحركة لأن قيمتها أكبر من قيمة المخزون الحالية',
    );
  }

  if (
    nextStock <= STOCK_EPSILON &&
    Math.abs(nextInventoryValue) > VALUE_EPSILON
  ) {
    throw new Error('لا يمكن تصفير كمية المخزون مع بقاء قيمة محاسبية للمخزون');
  }

  const nextAverageCost =
    nextStock > STOCK_EPSILON
      ? roundAverageCost(nextInventoryValue / nextStock)
      : 0;

  insertCostedMovement(database, {
    variant_id: variantId,

    type: 'out',

    quantity,

    unit_cost: movementUnitCost,

    cost_value: movementValue,

    reference_id: input.reference_id,

    reference_type: input.reference_type,

    created_by: input.created_by,

    notes: input.notes,
  });

  updateCostState(database, variantId, nextAverageCost, nextInventoryValue);

  return {
    unit_cost: movementUnitCost,

    cost_value: movementValue,

    stock: nextStock,

    average_cost: nextAverageCost,

    inventory_value: nextInventoryValue,
  };
}
