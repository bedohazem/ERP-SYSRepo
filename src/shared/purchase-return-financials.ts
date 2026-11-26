import {
  allocateMoneyValueByQuantity,
  preciseSubtract,
  preciseSum,
  truncateMoney,
} from './money';

export function calculatePurchaseReturnLineValue(input: {
  originalLineTotal: number;
  originalQuantity: number;
  alreadyReturnedQuantity: number;
  alreadyReturnedValue: number;
  requestedQuantity: number;
}): number {
  const originalTotal = truncateMoney(input.originalLineTotal);

  const previousValue = truncateMoney(input.alreadyReturnedValue);

  const cumulativeQuantity =
    input.alreadyReturnedQuantity + input.requestedQuantity;

  if (
    input.originalQuantity <= 0 ||
    input.requestedQuantity <= 0 ||
    originalTotal <= 0
  ) {
    return 0;
  }

  const cumulativeValue =
    cumulativeQuantity >= input.originalQuantity - 0.000001
      ? originalTotal
      : allocateMoneyValueByQuantity(
          originalTotal,
          cumulativeQuantity,
          input.originalQuantity,
        );

  return truncateMoney(
    Math.max(0, preciseSubtract(cumulativeValue, previousValue)),
  );
}

export const MAX_LEGACY_PURCHASE_DIFFERENCE_CENTS = 5;

function settlementCents(value: number): number {
  const cents = Math.round(value * 100);

  if (
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(cents) ||
    Math.abs(value - cents / 100) > 0.0000001
  ) {
    throw new Error('Invalid purchase settlement value');
  }

  return cents;
}

export function calculatePurchaseReturnSettlement(input: {
  invoiceTotal: number;
  invoiceCost: number;
  previouslyReturnedFinancial: number;
  previouslyReturnedCost: number;
  requestedCost: number;
  completesInvoice: boolean;
}) {
  const invoice = settlementCents(input.invoiceTotal);

  const invoiceCost = settlementCents(input.invoiceCost);

  const previousFinancial = settlementCents(input.previouslyReturnedFinancial);

  const previousCost = settlementCents(input.previouslyReturnedCost);

  const requestedCost = settlementCents(input.requestedCost);

  const originalDifference = invoice - invoiceCost;

  if (Math.abs(originalDifference) > MAX_LEGACY_PURCHASE_DIFFERENCE_CENTS) {
    throw new Error('Historical purchase difference requires manual review');
  }

  const remainingFinancial = invoice - previousFinancial;

  const remainingCost = invoiceCost - previousCost;

  if (
    remainingFinancial < 0 ||
    remainingCost < 0 ||
    requestedCost > remainingCost
  ) {
    throw new Error('Purchase return exceeds available value');
  }

  const remainingDifference = remainingFinancial - remainingCost;

  if (
    Math.abs(remainingDifference) > Math.abs(originalDifference) ||
    (remainingDifference !== 0 &&
      Math.sign(remainingDifference) !== Math.sign(originalDifference))
  ) {
    throw new Error('Inconsistent previous purchase settlement');
  }

  if (input.completesInvoice && requestedCost !== remainingCost) {
    throw new Error('Final purchase return cost mismatch');
  }

  // Financial settlement never exceeds the saved invoice.
  // The last return reconciles the remaining cents.

  const financial = input.completesInvoice
    ? remainingFinancial
    : Math.min(requestedCost, remainingFinancial);

  return {
    financialAmount: financial / 100,

    inventoryCost: requestedCost / 100,

    costAdjustment: (financial - requestedCost) / 100,

    remainingFinancial: (remainingFinancial - financial) / 100,

    remainingCost: (remainingCost - requestedCost) / 100,
  };
}

export function calculatePurchaseReturnInvoiceSettlement(input: {
  invoiceTotal: number;
  previouslyReturnedFinancial: number;
  requestedCost: number;
  items: readonly {
    quantity: number;
    lineTotal: number;
    returnedQuantity: number;
    returnedValue: number;
    requestedQuantity: number;
  }[];
}) {
  const invoiceCost = preciseSum(
    input.items.map((item) => truncateMoney(item.lineTotal)),
  );

  const previouslyReturnedCost = preciseSum(
    input.items.map((item) => truncateMoney(item.returnedValue)),
  );

  const completesInvoice =
    input.items.length > 0 &&
    input.items.every(
      (item) =>
        item.returnedQuantity + item.requestedQuantity >=
        item.quantity - 0.000001,
    );

  return calculatePurchaseReturnSettlement({
    invoiceTotal: input.invoiceTotal,
    invoiceCost,
    previouslyReturnedFinancial: input.previouslyReturnedFinancial,
    previouslyReturnedCost,
    requestedCost: input.requestedCost,
    completesInvoice,
  });
}
