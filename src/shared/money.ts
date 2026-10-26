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

  /*
   * كل قيم التكلفة في النظام
   * أقصى دقة لها قرشين.
   *
   * 100      -> 100
   * 100.5    -> 100.5
   * 100.25   -> 100.25
   * 100.256  -> 100.26
   */
  const rounded = Number(amount.toFixed(2));

  return Object.is(rounded, -0) ? 0 : rounded;
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
  const outstandingAmount = roundFinancial(
    Math.max(0, Number(outstandingValue ?? 0)),
  );

  const cashAmount = roundMoney(requestedCashValue);

  const fullSettlementCash = roundMoney(outstandingAmount);

  /*
   * لو المبلغ المدفوع هو أقرب جنيه
   * لكامل المديونية، نعتبر الدين
   * مسددًا بالكامل.
   *
   * مثال:
   * 981.75 دين
   * 982 كاش
   *
   * accounting allocation = 981.75
   * cash = 982
   * rounding = +0.25
   */
  const isFullSettlement =
    outstandingAmount > 0 &&
    cashAmount > 0 &&
    cashAmount === fullSettlementCash;

  const overpayment = cashAmount > outstandingAmount && !isFullSettlement;

  const allocatedAmount =
    cashAmount <= 0 || outstandingAmount <= 0
      ? 0
      : isFullSettlement
        ? outstandingAmount
        : roundFinancial(Math.min(cashAmount, outstandingAmount));

  const remainingAmount = roundFinancial(
    Math.max(0, outstandingAmount - allocatedAmount),
  );

  const roundingAdjustment = isFullSettlement
    ? roundFinancial(cashAmount - allocatedAmount)
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
