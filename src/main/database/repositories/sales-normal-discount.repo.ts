import { getDb } from '../db';
import { roundMoney } from '../../../shared/money';

type OriginalSaleItem = {
  id: number;
  quantity: number;
  line_total: number;
  promotion_discount_value: number | null;
};

type ExchangeUnit = {
  id: number;
  original_sale_item_id: number;
};

/*
 * خصم الفاتورة الأصلي يتوزع على
 * قيمة الأصناف بعد خصومات العروض.
 *
 * عند استبدال قطعة عادية:
 * - نصيب القطعة الأصلية من الخصم ينتهي.
 * - نصيب بقية القطع يظل محفوظًا.
 *
 * الاستبدال المتكرر لنفس الوحدة
 * لا يلغي نصيب الخصم مرتين.
 *
 * عمليات الاستبدال الملغاة لا تُحسب.
 */
export function getRetainedOriginalNormalDiscount(
  saleIdInput: number,
  originalDiscountInput: number,
  additionalRegularUnitIds: number[] = [],
): number {
  const db = getDb();

  const saleId = Number(saleIdInput);

  const originalDiscount = roundMoney(
    Math.max(0, Number(originalDiscountInput || 0)),
  );

  if (originalDiscount <= 0) {
    return 0;
  }

  const exchangedUnits = db
    .prepare(
      `
      SELECT DISTINCT
        spu.id,
        spu.original_sale_item_id
      FROM sale_exchange_items sei
      JOIN sale_exchanges se
        ON se.id = sei.exchange_id
      JOIN sale_promotion_units spu
        ON spu.id = sei.promotion_unit_id
      WHERE se.original_sale_id = ?
        AND se.cancelled_at IS NULL
        AND spu.sale_id = ?
        AND spu.promotion_group_id LIKE 'regular:%'
    `,
    )
    .all(saleId, saleId) as ExchangeUnit[];

  const exchangedUnitIds = new Set(
    exchangedUnits.map((unit) => Number(unit.id)),
  );

  const getRegularUnit = db.prepare(`
    SELECT
      id,
      original_sale_item_id
    FROM sale_promotion_units
    WHERE id = ?
      AND sale_id = ?
      AND promotion_group_id LIKE 'regular:%'
    LIMIT 1
  `);

  for (const unitIdInput of additionalRegularUnitIds) {
    const unitId = Number(unitIdInput);

    if (exchangedUnitIds.has(unitId)) {
      continue;
    }

    const unit = getRegularUnit.get(unitId, saleId) as ExchangeUnit | undefined;

    if (!unit) {
      throw new Error('وحدة الاستبدال العادية غير موجودة');
    }

    exchangedUnits.push(unit);
    exchangedUnitIds.add(unitId);
  }

  if (exchangedUnitIds.size === 0) {
    return originalDiscount;
  }

  const items = db
    .prepare(
      `
      SELECT
        id,
        quantity,
        line_total,
        promotion_discount_value
      FROM sale_items
      WHERE sale_id = ?
      ORDER BY id ASC
    `,
    )
    .all(saleId) as OriginalSaleItem[];

  const exchangedCounts = new Map<number, number>();

  for (const unit of exchangedUnits) {
    const itemId = Number(unit.original_sale_item_id);

    exchangedCounts.set(itemId, Number(exchangedCounts.get(itemId) || 0) + 1);
  }

  let originalEligibleTotal = 0;
  let exchangedOriginalValue = 0;

  for (const item of items) {
    const quantity = Math.max(0, Number(item.quantity || 0));

    const eligibleValue = roundMoney(
      Math.max(
        0,
        Number(item.line_total || 0) -
          Number(item.promotion_discount_value || 0),
      ),
    );

    originalEligibleTotal += eligibleValue;

    if (quantity <= 0) {
      continue;
    }

    const exchangedCount = Math.min(
      quantity,
      Number(exchangedCounts.get(Number(item.id)) || 0),
    );

    exchangedOriginalValue += eligibleValue * (exchangedCount / quantity);
  }

  if (originalEligibleTotal <= 0) {
    return 0;
  }

  const remainingRatio = Math.max(
    0,
    Math.min(
      1,
      (originalEligibleTotal - exchangedOriginalValue) / originalEligibleTotal,
    ),
  );

  return roundMoney(originalDiscount * remainingRatio);
}
