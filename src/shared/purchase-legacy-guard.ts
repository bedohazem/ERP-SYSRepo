import { calculatePurchaseFinancials } from './purchase-financials';
import { PRECISE_MONEY_EPSILON } from './money';

export const UNSAFE_LEGACY_PURCHASE_MESSAGE =
  'لا يمكن تعديل هذه الفاتورة بالطريقة العادية لاختلاف طريقة احتساب الخصم القديمة. تم حماية الفاتورة من تكرار الخصم وتغيير التكلفة.';

type StoredPurchase = {
  sub_total?: unknown;
  total_amount?: unknown;
  discount_type?: unknown;
  discount_input?: unknown;
  discount_value?: unknown;
};

type StoredPurchaseItem = {
  variant_id?: unknown;
  quantity?: unknown;
  unit_cost?: unknown;
};

export function hasUnsafeStoredPurchaseDiscount(
  purchase: StoredPurchase,
  items: readonly StoredPurchaseItem[],
): boolean {
  const discountValue = Number(purchase.discount_value ?? 0);

  const savedInput = Number(purchase.discount_input ?? 0);

  if (
    !Number.isFinite(discountValue) ||
    !Number.isFinite(savedInput) ||
    discountValue < 0 ||
    savedInput < 0
  ) {
    return true;
  }

  if (discountValue === 0 && savedInput === 0) {
    return false;
  }

  const discountType =
    purchase.discount_type === 'percent' ? 'percent' : 'amount';

  const discountInput =
    discountType === 'amount' && savedInput === 0 ? discountValue : savedInput;

  const storedSubtotal = Number(purchase.sub_total);

  const storedTotal = Number(purchase.total_amount);

  if (
    !items.length ||
    !Number.isFinite(storedSubtotal) ||
    !Number.isFinite(storedTotal)
  ) {
    return true;
  }

  try {
    const calculated = calculatePurchaseFinancials(
      items.map((item) => ({
        variantId: Number(item.variant_id),
        quantity: Number(item.quantity),
        unitCost: Number(item.unit_cost),
      })),
      discountType,
      discountInput,
    );

    return (
      Math.abs(calculated.subTotal - storedSubtotal) > PRECISE_MONEY_EPSILON ||
      Math.abs(calculated.totalAmount - storedTotal) > PRECISE_MONEY_EPSILON ||
      Math.abs(calculated.discountValue - discountValue) > PRECISE_MONEY_EPSILON
    );
  } catch {
    return true;
  }
}
