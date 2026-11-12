import { roundMoney } from './money';

export type ExchangeDiscountType = 'amount' | 'percent';

export type ExchangeDiscountUnit = {
  id: number;
  payable: number;
  existingDiscount: number;
};

export type ExchangeDiscountCalculation = {
  appliedDiscount: number;
  previousGroupDiscount: number;
  nextGroupDiscount: number;
  discountDelta: number;
  allocatedByUnit: Map<number, number>;
};

function asMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('قيمة خصم الاستبدال غير صحيحة');
  return roundMoney(n);
}

/**
 * Calculate only the EXTRA discretionary exchange discount.
 * Existing discounts are preserved when possible, capped to what the
 * replacement group can actually carry, and allocated deterministically.
 * The caller must pass the positive amount the customer would otherwise owe
 * BEFORE granting this exchange's new discretionary discount.
 */
export function calculateExchangeDiscount(input: {
  type: ExchangeDiscountType;
  value: number;
  positiveDifference: number;
  units: ExchangeDiscountUnit[];
}): ExchangeDiscountCalculation {
  const rawInput = Number(input.value);
  if (!Number.isFinite(rawInput) || rawInput < 0) {
    throw new Error('قيمة خصم الاستبدال غير صحيحة');
  }
  if (input.type !== 'amount' && input.type !== 'percent') {
    throw new Error('نوع خصم الاستبدال غير صحيح');
  }
  if (input.type === 'percent' && rawInput > 100) {
    throw new Error('نسبة خصم الاستبدال لا يمكن أن تتجاوز 100%');
  }
  const positiveDifference = Math.max(0, asMoney(input.positiveDifference));
  const units = input.units.map((unit) => ({
    id: Number(unit.id),
    payable: Math.max(0, asMoney(unit.payable)),
    existingDiscount: Math.max(0, asMoney(unit.existingDiscount)),
  }));
  if (
    units.some((unit) => !Number.isInteger(unit.id) || unit.id <= 0) ||
    new Set(units.map((unit) => unit.id)).size !== units.length
  ) {
    throw new Error('وحدات خصم الاستبدال غير صحيحة');
  }
  const groupPayable = units.reduce((sum, unit) => sum + unit.payable, 0);
  const previousGroupDiscount = units.reduce(
    (sum, unit) => sum + unit.existingDiscount,
    0,
  );
  const retained = Math.min(previousGroupDiscount, groupPayable);
  const requested =
    input.type === 'percent'
      ? roundMoney((positiveDifference * rawInput) / 100)
      : asMoney(rawInput);
  const appliedDiscount = Math.min(
    Math.max(0, requested),
    positiveDifference,
    Math.max(0, groupPayable - retained),
  );
  const nextGroupDiscount = retained + appliedDiscount;
  const allocatedByUnit = new Map<number, number>(
    units.map((unit) => [unit.id, 0]),
  );
  if (groupPayable > 0 && nextGroupDiscount > 0) {
    const shares = units.map((unit) => {
      const exact = (nextGroupDiscount * unit.payable) / groupPayable;
      const floor = Math.floor(exact);
      allocatedByUnit.set(unit.id, floor);
      return { id: unit.id, fraction: exact - floor };
    });
    let remaining =
      nextGroupDiscount -
      [...allocatedByUnit.values()].reduce((sum, value) => sum + value, 0);
    shares.sort((a, b) => b.fraction - a.fraction || a.id - b.id);
    for (const share of shares) {
      if (remaining <= 0) break;
      allocatedByUnit.set(share.id, (allocatedByUnit.get(share.id) || 0) + 1);
      remaining--;
    }
  }
  return {
    appliedDiscount,
    previousGroupDiscount,
    nextGroupDiscount,
    discountDelta: nextGroupDiscount - previousGroupDiscount,
    allocatedByUnit,
  };
}
