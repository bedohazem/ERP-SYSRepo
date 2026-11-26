import Decimal from 'decimal.js';

const D = Decimal.clone({
  precision: 60,
  rounding: Decimal.ROUND_DOWN,
});

export type PurchaseFinancialLineInput = {
  variantId: number;
  quantity: number;
  unitCost: number;
};

export type PurchaseDiscountType = 'amount' | 'percent';

function sum(values: Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), new D(0));
}

function nonNegative(value: number): Decimal {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Invalid purchase financial value');
  }

  return new D(String(value));
}

function toCents(value: Decimal): Decimal {
  const scaled = value.times(100);

  const nearest = scaled.toNearest(1, Decimal.ROUND_HALF_UP);

  // Same floating-point noise tolerance as money.ts.
  const normalized = scaled.minus(nearest).abs().lte('0.0000000001')
    ? nearest
    : scaled;

  const cents = normalized.trunc();

  if (!Number.isSafeInteger(cents.toNumber())) {
    throw new Error('Purchase total exceeds safe monetary range');
  }

  return cents;
}

function fromCents(value: Decimal): number {
  return value.div(100).toNumber();
}

function allocateCents(
  target: Decimal,
  quotas: Decimal[],
  variantIds: number[],
): Decimal[] {
  const allocated = quotas.map((quota) => quota.floor());

  const remaining = target.minus(sum(allocated));

  const ranked = quotas
    .map((quota, index) => ({
      index,
      variantId: variantIds[index],
      remainder: quota.minus(allocated[index]),
    }))
    .sort(
      (a, b) =>
        b.remainder.cmp(a.remainder) ||
        a.variantId - b.variantId ||
        a.index - b.index,
    );

  const remainingCount = remaining.toNumber();

  if (
    !Number.isSafeInteger(remainingCount) ||
    remainingCount < 0 ||
    remainingCount > ranked.length
  ) {
    throw new Error('Invalid purchase cent allocation');
  }

  for (let i = 0; i < remainingCount; i += 1) {
    const index = ranked[i].index;

    allocated[index] = allocated[index].plus(1);
  }

  if (!sum(allocated).eq(target)) {
    throw new Error('Purchase cent allocation mismatch');
  }

  return allocated;
}

export function calculatePurchaseFinancials(
  items: readonly PurchaseFinancialLineInput[],
  discountType: PurchaseDiscountType = 'amount',
  discountInput = 0,
) {
  if (discountType !== 'amount' && discountType !== 'percent') {
    throw new Error('Invalid purchase discount type');
  }

  const requestedDiscount = nonNegative(discountInput);

  if (discountType === 'percent' && requestedDiscount.gt(100)) {
    throw new Error('Purchase discount exceeds 100 percent');
  }

  const variantIds = items.map((item) => item.variantId);

  const rawGrossValues = items.map((item) =>
    nonNegative(item.quantity).times(nonNegative(item.unitCost)),
  );

  // No intermediate monetary truncation.
  const rawSubtotal = sum(rawGrossValues);

  const calculatedDiscount =
    discountType === 'percent'
      ? rawSubtotal.times(requestedDiscount).div(100)
      : requestedDiscount;

  const rawDiscount = D.min(rawSubtotal, calculatedDiscount);

  const rawTotal = rawSubtotal.minus(rawDiscount);

  // Financial posting boundaries.
  const subtotalCents = toCents(rawSubtotal);
  const totalCents = toCents(rawTotal);

  // Accounting discount reconciles posted subtotal and net.
  const discountCents = subtotalCents.minus(totalCents);

  const grossCents = allocateCents(
    subtotalCents,
    rawGrossValues.map((value) => value.times(100)),
    variantIds,
  );

  const discountQuotas = grossCents.map((value) =>
    subtotalCents.isZero()
      ? new D(0)
      : discountCents.times(value).div(subtotalCents),
  );

  const lineDiscountCents = allocateCents(
    discountCents,
    discountQuotas,
    variantIds,
  );

  const netCents = grossCents.map((value, index) =>
    value.minus(lineDiscountCents[index]),
  );

  if (netCents.some((value) => value.lt(0)) || !sum(netCents).eq(totalCents)) {
    throw new Error('Purchase net allocation mismatch');
  }

  const lines = items.map((item, index) => {
    const quantity = nonNegative(item.quantity);

    const netTotal = fromCents(netCents[index]);

    return {
      variantId: item.variantId,
      quantity: item.quantity,

      // Original supplier price remains unchanged.
      unitCost: item.unitCost,

      rawGrossTotal: rawGrossValues[index].toString(),

      grossTotal: fromCents(grossCents[index]),

      discount: fromCents(lineDiscountCents[index]),

      netTotal,

      effectiveUnitCost: quantity.isZero()
        ? 0
        : netCents[index].div(100).div(quantity).toNumber(),
    };
  });

  return {
    rawSubtotal: rawSubtotal.toString(),
    rawDiscount: rawDiscount.toString(),
    rawTotal: rawTotal.toString(),

    subTotal: fromCents(subtotalCents),
    discountValue: fromCents(discountCents),
    totalAmount: fromCents(totalCents),

    lines,
  };
}
