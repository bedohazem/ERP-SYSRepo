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

  const getOriginalUnit = db.prepare(`
    SELECT
      id,
      original_sale_item_id
    FROM sale_promotion_units
    WHERE id = ?
      AND sale_id = ?
    LIMIT 1
  `);

  for (const unitIdInput of additionalRegularUnitIds) {
    const unitId = Number(unitIdInput);

    if (exchangedUnitIds.has(unitId)) {
      continue;
    }

    const unit = getOriginalUnit.get(unitId, saleId) as
      ExchangeUnit | undefined;

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

  /*
   * توزيع خصم الفاتورة مرة واحدة على الأصناف الأصلية.
   *
   * 100 + 100 + 120، خصم 20:
   *
   * الأنصبة الدقيقة: 6.25 + 6.25 + 7.50
   * الأنصبة المعتمدة: 6 + 6 + 8
   *
   * مجموع الأنصبة يجب أن يساوي الخصم الأصلي.
   * ولا نعيد تقريب الخصم المتبقي بعد كل استبدال.
   */
  const allocations = items.map((item) => ({
    itemId: Number(item.id),
    quantity: Number(item.quantity || 0),
    weight: roundMoney(
      Math.max(
        0,
        Number(item.line_total || 0) -
          Number(item.promotion_discount_value || 0),
      ),
    ),
    discount: 0,
    remainder: 0,
  }));

  const totalWeight = allocations.reduce((sum, item) => sum + item.weight, 0);

  if (totalWeight <= 0) {
    return 0;
  }

  /*
   * نقرب نصيب كل صنف أولًا لأقرب جنيه،
   * ثم نسوّي أي فرق حتى يساوي مجموع
   * الأنصبة خصم الفاتورة بالضبط.
   *
   * نحافظ على أولوية أول صنف عند
   * معالجة الزيادة، لتتوافق المرتجعات
   * مع ترتيب التقريب التاريخي.
   *
   * التوزيع ثابت ولا يتأثر بترتيب
   * الاستبدالات أو المرتجعات اللاحقة.
   */
  let allocatedTotal = 0;

  for (const item of allocations) {
    const numerator = originalDiscount * item.weight;

    item.discount = roundMoney(numerator / totalWeight);

    item.remainder = numerator - item.discount * totalWeight;

    allocatedTotal += item.discount;
  }

  const firstItemId = allocations[0]?.itemId;

  while (allocatedTotal !== originalDiscount) {
    if (allocatedTotal < originalDiscount) {
      /*
       * لو ناقص جنيه:
       * نضيفه للصنف صاحب أكبر عجز
       * عن نصيبه الدقيق.
       */
      const next = allocations
        .filter((item) => item.discount < item.weight)
        .sort((a, b) => b.remainder - a.remainder || a.itemId - b.itemId)[0];

      if (!next) {
        throw new Error('تعذر استكمال توزيع خصم الفاتورة');
      }

      next.discount += 1;
      next.remainder -= totalWeight;
      allocatedTotal += 1;
    } else {
      /*
       * لو التقريب زوّد جنيه:
       * نزيله من الأنصبة المقربة للأعلى،
       * مع الحفاظ على أولوية الصنف الأول.
       */
      const next = allocations
        .filter((item) => item.discount > 0)
        .sort(
          (a, b) =>
            Number(a.itemId === firstItemId) -
              Number(b.itemId === firstItemId) ||
            a.remainder - b.remainder ||
            a.itemId - b.itemId,
        )[0];

      if (!next) {
        throw new Error('تعذر تصحيح توزيع خصم الفاتورة');
      }

      next.discount -= 1;
      next.remainder += totalWeight;
      allocatedTotal -= 1;
    }
  }

  /*
   * القطع المتعددة من نفس الصنف:
   * نوزع نصيب الصنف بينها، بحيث كل وحدة
   * لها نصيب ثابت حسب ترتيب إنشائها.
   */
  const originalUnits = db
    .prepare(
      `
      SELECT
        id,
        original_sale_item_id
      FROM sale_promotion_units
      WHERE sale_id = ?
      ORDER BY
        original_sale_item_id ASC,
        id ASC
    `,
    )
    .all(saleId) as ExchangeUnit[];

  const unitsByItem = new Map<number, number[]>();

  for (const unit of originalUnits) {
    const itemId = Number(unit.original_sale_item_id);

    const ids = unitsByItem.get(itemId) || [];

    ids.push(Number(unit.id));

    unitsByItem.set(itemId, ids);
  }

  let removedDiscount = 0;

  for (const item of allocations) {
    const unitIds = unitsByItem.get(item.itemId) || [];

    const hasExchangedUnit = unitIds.some((id) => exchangedUnitIds.has(id));

    if (!hasExchangedUnit) {
      continue;
    }

    const quantity = item.quantity;

    if (
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      unitIds.length !== quantity
    ) {
      throw new Error('بيانات توزيع خصم وحدات الاستبدال غير مكتملة');
    }

    const baseDiscount = Math.floor(item.discount / quantity);

    const extraUnits = item.discount - baseDiscount * quantity;

    for (let index = 0; index < unitIds.length; index += 1) {
      if (!exchangedUnitIds.has(unitIds[index])) {
        continue;
      }

      removedDiscount += baseDiscount + (index < extraUnits ? 1 : 0);
    }
  }

  return Math.max(0, originalDiscount - removedDiscount);
}
