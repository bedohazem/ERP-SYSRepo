import Decimal from 'decimal.js';
Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_DOWN,
});

export const PRECISE_MONEY_EPSILON = 0.000000001;

export function isEffectivelyZero(value: unknown): boolean {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) {
    return true;
  }

  return Math.abs(amount) <= PRECISE_MONEY_EPSILON;
}

export function hasPositivePreciseAmount(value: unknown): boolean {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) {
    return false;
  }

  return amount > PRECISE_MONEY_EPSILON;
}

export function roundMoney(value: unknown): number {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  /*
   * Money policy:
   *
   * 10.49 -> 10
   * 10.50 -> 11
   * 10.99 -> 11
   *
   * ونطبق نفس المنطق
   * على الفروق السالبة:
   *
   * -10.49 -> -10
   * -10.50 -> -11
   */
  const roundedAbsolute = Math.floor(Math.abs(amount) + 0.5);

  if (roundedAbsolute === 0) {
    return 0;
  }

  return amount < 0 ? -roundedAbsolute : roundedAbsolute;
}

export function roundFinancial(value: unknown): number {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  /*
   * الأموال الفعلية التي تسمح
   * بالقروش مثل:
   *
   * - الخزنة
   * - المصاريف
   * - الالتزامات
   *
   * تحتفظ بمنزلتين عشريتين.
   */
  const rounded = Number(amount.toFixed(2));

  return Object.is(rounded, -0) ? 0 : rounded;
}

export function roundCost(value: unknown): number {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  const rounded = Number(amount.toFixed(2));

  return Object.is(rounded, -0) ? 0 : rounded;
}

function toDecimal(value: unknown): Decimal {
  try {
    const raw =
      value === null || value === undefined || value === ''
        ? '0'
        : String(value);

    const result = new Decimal(raw);

    return result.isFinite() ? result : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/*
 * يحافظ على الرقم بدون سياسة
 * تقريب تجارية.
 *
 * مهم:
 * العمليات الحسابية نفسها يجب
 * أن تستخدم precise* helpers
 * الموجودة تحت.
 */
export function preservePrecision(value: unknown): number {
  const result = toDecimal(value).toNumber();

  return Object.is(result, -0) ? 0 : result;
}

export function normalizePreciseZero(value: unknown): number {
  const amount = preservePrecision(value);

  return isEffectivelyZero(amount) ? 0 : amount;
}

export function preciseAdd(...values: unknown[]): number {
  const result = values.reduce<Decimal>(
    (sum, value) => sum.plus(toDecimal(value)),
    new Decimal(0),
  );

  return preservePrecision(result.toString());
}

export function preciseSubtract(left: unknown, right: unknown): number {
  return preservePrecision(toDecimal(left).minus(toDecimal(right)).toString());
}

export function preciseMultiply(left: unknown, right: unknown): number {
  return preservePrecision(toDecimal(left).times(toDecimal(right)).toString());
}

export function preciseDivide(left: unknown, right: unknown): number {
  const divisor = toDecimal(right);

  if (divisor.isZero()) {
    return 0;
  }

  return preservePrecision(toDecimal(left).div(divisor).toString());
}

export function preciseSum(values: unknown[]): number {
  return preciseAdd(...values);
}

export function truncateMoney(value: unknown, maxDecimals = 2): number {
  const decimals =
    Number.isInteger(maxDecimals) && maxDecimals >= 0 ? maxDecimals : 2;

  const scale = new Decimal(10).pow(decimals);

  let scaled = toDecimal(value).times(scale);

  /*
   * إزالة Floating Point noise فقط
   * لو الرقم قريب جدًا من حد صحيح.
   *
   * لا نستخدم ده كتقريب مالي.
   */
  const nearestInteger = scaled.toNearest(1, Decimal.ROUND_HALF_UP);

  if (scaled.minus(nearestInteger).abs().lte('0.0000000001')) {
    scaled = nearestInteger;
  }

  const truncated = scaled.trunc().div(scale).toNumber();

  return Object.is(truncated, -0) ? 0 : truncated;
}

export function allocateMoneyValueByQuantity(
  totalValue: unknown,
  quantityInput: unknown,
  totalQuantityInput: unknown,
): number {
  const total = toDecimal(truncateMoney(totalValue));

  const quantity = toDecimal(quantityInput);

  const totalQuantity = toDecimal(totalQuantityInput);

  if (total.lte(0) || quantity.lte(0) || totalQuantity.lte(0)) {
    return 0;
  }

  /*
   * آخر كمية تخرج تأخذ كل القيمة
   * المتبقية حتى لا يعلق قرش واحد.
   */
  if (quantity.gte(totalQuantity)) {
    return truncateMoney(total.toString());
  }

  const totalCents = total.times(100).trunc();

  let allocatedCents = totalCents
    .times(quantity)
    .div(totalQuantity)
    .toNearest(1, Decimal.ROUND_HALF_UP);

  if (allocatedCents.lt(0)) {
    allocatedCents = new Decimal(0);
  }

  if (allocatedCents.gt(totalCents)) {
    allocatedCents = totalCents;
  }

  return preservePrecision(allocatedCents.div(100).toString());
}

export function allocateTruncatedMoneyAcrossWeights(
  totalValue: unknown,
  weightInputs: unknown[],
): number[] {
  const total = toDecimal(truncateMoney(totalValue));

  const weights = weightInputs.map((value) => {
    const weight = toDecimal(value);

    return weight.gt(0) ? weight : new Decimal(0);
  });

  const totalWeight = weights.reduce(
    (sum, weight) => sum.plus(weight),
    new Decimal(0),
  );

  if (total.lte(0) || totalWeight.lte(0) || weights.length === 0) {
    return weights.map(() => 0);
  }

  let lastPositiveIndex = -1;

  for (let index = weights.length - 1; index >= 0; index -= 1) {
    if (weights[index].gt(0)) {
      lastPositiveIndex = index;
      break;
    }
  }

  let remainingCents = total.times(100).trunc();

  let remainingWeight = new Decimal(totalWeight);

  return weights.map((weight, index) => {
    if (weight.lte(0)) {
      return 0;
    }

    const allocatedCents =
      index === lastPositiveIndex
        ? remainingCents
        : remainingCents.times(weight).div(remainingWeight).trunc();

    remainingCents = remainingCents.minus(allocatedCents);

    remainingWeight = remainingWeight.minus(weight);

    return preservePrecision(allocatedCents.div(100).toString());
  });
}

export function truncateForDisplay(value: unknown, maxDecimals = 2): string {
  const decimals =
    Number.isInteger(maxDecimals) && maxDecimals >= 0 ? maxDecimals : 2;

  const scale = new Decimal(10).pow(decimals);

  let scaled = toDecimal(value).times(scale);

  /*
   * ده مش تقريب مالي.
   *
   * فقط إزالة Noise أقل من
   * 0.0000000001 عند حد العرض.
   */
  const nearestInteger = scaled.toNearest(1, Decimal.ROUND_HALF_UP);

  if (scaled.minus(nearestInteger).abs().lte('0.0000000001')) {
    scaled = nearestInteger;
  }

  const truncated = scaled.trunc().div(scale);

  let text = truncated.toFixed(decimals);

  if (text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '');
  }

  if (text === '-0' || text === '') {
    return '0';
  }

  return text;
}

export function formatPreciseMoney(value: unknown): string {
  return `${truncateForDisplay(value)} ج.م`;
}

export function formatSignedPreciseMoney(value: unknown): string {
  const amount = normalizePreciseZero(value);

  const sign = hasPositivePreciseAmount(amount) ? '+' : '';

  return `${sign}${truncateForDisplay(amount)} ج.م`;
}

export function allocateProportionalAmountPrecise(
  totalValue: unknown,
  quantityInput: unknown,
  totalQuantityInput: unknown,
): number {
  const total = toDecimal(totalValue);

  const quantity = toDecimal(quantityInput);

  const totalQuantity = toDecimal(totalQuantityInput);

  if (quantity.lte(0) || totalQuantity.lte(0)) {
    return 0;
  }

  if (quantity.eq(totalQuantity)) {
    return preservePrecision(total.toString());
  }

  return preservePrecision(total.times(quantity).div(totalQuantity).toString());
}

export function allocatePreciseTotalAcrossWeights(
  totalValue: unknown,
  weightInputs: unknown[],
): number[] {
  const total = toDecimal(totalValue);

  const weights = weightInputs.map((value) => {
    const weight = toDecimal(value);

    return weight.gt(0) ? weight : new Decimal(0);
  });

  const totalWeight = weights.reduce(
    (sum, weight) => sum.plus(weight),
    new Decimal(0),
  );

  if (total.lte(0) || totalWeight.lte(0) || weights.length === 0) {
    return weights.map(() => 0);
  }

  let lastPositiveIndex = -1;

  for (let index = weights.length - 1; index >= 0; index -= 1) {
    if (weights[index].gt(0)) {
      lastPositiveIndex = index;
      break;
    }
  }

  let remainingTotal = new Decimal(total);

  let remainingWeight = new Decimal(totalWeight);

  return weights.map((weight, index) => {
    if (weight.lte(0)) {
      return 0;
    }

    const allocated =
      index === lastPositiveIndex
        ? remainingTotal
        : remainingTotal.times(weight).div(remainingWeight);

    remainingTotal = remainingTotal.minus(allocated);

    remainingWeight = remainingWeight.minus(weight);

    return preservePrecision(allocated.toString());
  });
}

export function allocateProportionalAmount(
  totalValue: unknown,
  quantityInput: unknown,
  totalQuantityInput: unknown,
): number {
  const total = roundCost(totalValue);

  const quantity = Number(quantityInput);

  const totalQuantity = Number(totalQuantityInput);

  if (
    !Number.isFinite(quantity) ||
    !Number.isFinite(totalQuantity) ||
    quantity <= 0 ||
    totalQuantity <= 0
  ) {
    return 0;
  }

  /*
   * لو بناخد كل الكمية،
   * نرجع القيمة المتبقية بالكامل
   * حتى لا يضيع أي قرش.
   */
  if (Math.abs(quantity - totalQuantity) <= 0.000001) {
    return total;
  }

  return roundCost((total * quantity) / totalQuantity);
}

export function allocateRoundedTotalAcrossWeights(
  totalValue: unknown,
  weightInputs: unknown[],
): number[] {
  const total = roundCost(totalValue);

  const weights = weightInputs.map((value) => {
    const weight = Number(value ?? 0);

    return Number.isFinite(weight) && weight > 0 ? weight : 0;
  });

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (total <= 0 || totalWeight <= 0 || weights.length === 0) {
    return weights.map(() => 0);
  }

  let remainingTotal = total;
  let remainingWeight = totalWeight;

  return weights.map((weight, index) => {
    if (weight <= 0) {
      return 0;
    }

    const isLast = index === weights.length - 1;

    const allocated = isLast
      ? remainingTotal
      : allocateProportionalAmount(remainingTotal, weight, remainingWeight);

    const safeAllocated = roundCost(
      Math.max(0, Math.min(remainingTotal, allocated)),
    );

    remainingTotal = roundCost(Math.max(0, remainingTotal - safeAllocated));

    remainingWeight = Math.max(0, remainingWeight - weight);

    return safeAllocated;
  });
}

export function splitAmountAcrossUnits(
  totalValue: unknown,
  unitCountInput: unknown,
): number[] {
  const total = roundCost(totalValue);

  const unitCount = Math.trunc(Number(unitCountInput));

  if (!Number.isFinite(unitCount) || unitCount <= 0) {
    return [];
  }

  const sign = total < 0 ? -1 : 1;

  const totalCents = Math.round(Math.abs(total) * 100);

  const baseCents = Math.floor(totalCents / unitCount);

  const remainderCents = totalCents % unitCount;

  return Array.from(
    {
      length: unitCount,
    },

    (_, index) => (sign * (baseCents + (index < remainderCents ? 1 : 0))) / 100,
  );
}

export function resolveWholeMoneySettlement(
  requestedCashValue: unknown,
  outstandingValue: unknown,
) {
  const outstandingAmount = normalizePreciseZero(
    Math.max(0, Number(outstandingValue ?? 0)),
  );

  const cashAmount = roundMoney(requestedCashValue);

  const fullSettlementCash = roundMoney(outstandingAmount);

  const isFullSettlement =
    hasPositivePreciseAmount(outstandingAmount) &&
    cashAmount > 0 &&
    cashAmount === fullSettlementCash;

  const overpayment = cashAmount > outstandingAmount && !isFullSettlement;

  const allocatedAmount =
    cashAmount <= 0 || !hasPositivePreciseAmount(outstandingAmount)
      ? 0
      : isFullSettlement
        ? outstandingAmount
        : normalizePreciseZero(Math.min(cashAmount, outstandingAmount));

  const remainingAmount = normalizePreciseZero(
    Math.max(0, preciseSubtract(outstandingAmount, allocatedAmount)),
  );

  const roundingAdjustment = isFullSettlement
    ? normalizePreciseZero(preciseSubtract(cashAmount, allocatedAmount))
    : 0;

  return {
    cashAmount,

    allocatedAmount,

    remainingAmount,

    roundingAdjustment,

    isFullSettlement,

    overpayment,
  };
}

export function formatMoney(value: unknown): string {
  return `${roundFinancial(value)} ج.م`;
}
