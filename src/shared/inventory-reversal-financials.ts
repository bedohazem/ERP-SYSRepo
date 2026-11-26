import {
  allocateMoneyValueByQuantity,
  preciseSubtract,
  truncateMoney,
} from './money';

const STOCK_EPSILON = 0.000001;

export function calculateInventoryCostReversal(input: {
  stock: number;
  inventoryValue: number;
  quantity: number;
  requestedCost: number;
}) {
  const { stock, inventoryValue, quantity, requestedCost } = input;

  if (
    !Number.isFinite(stock) ||
    !Number.isFinite(inventoryValue) ||
    !Number.isFinite(quantity) ||
    !Number.isFinite(requestedCost) ||
    stock <= 0 ||
    quantity <= 0 ||
    inventoryValue < 0 ||
    requestedCost < 0
  ) {
    throw new Error('Invalid inventory reversal values');
  }

  if (quantity > stock + STOCK_EPSILON) {
    throw new Error('Insufficient stock for reversal');
  }

  const currentValue = truncateMoney(inventoryValue);

  const originalCost = truncateMoney(requestedCost);

  const nextStock = stock - quantity <= STOCK_EPSILON ? 0 : stock - quantity;

  const exactRemainingValue = truncateMoney(
    preciseSubtract(currentValue, originalCost),
  );

  const canReverseExactly =
    exactRemainingValue >= 0 && (nextStock > 0 || exactRemainingValue === 0);

  const actualCost = canReverseExactly
    ? originalCost
    : nextStock === 0
      ? currentValue
      : allocateMoneyValueByQuantity(currentValue, quantity, stock);

  const remainingValue = truncateMoney(
    preciseSubtract(currentValue, actualCost),
  );

  if (
    actualCost < 0 ||
    actualCost > currentValue ||
    remainingValue < 0 ||
    (nextStock === 0 && remainingValue !== 0)
  ) {
    throw new Error('Inventory reversal cost mismatch');
  }

  return {
    requestedCost: originalCost,

    actualCost,

    costAdjustment: preciseSubtract(originalCost, actualCost),

    remainingStock: nextStock,

    remainingValue,

    usedAverageFallback: !canReverseExactly,
  };
}
