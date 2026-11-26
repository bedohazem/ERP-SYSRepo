import {
  normalizePreciseZero,
  preciseAdd,
  preciseSubtract,
  roundMoney,
} from './money';

export type PurchasePaymentPreviewInput = {
  totalAmount: number;
  paidAmount: number;
  availableCredit: number | null;
  earlierDebt?: number;
  settleFullInvoice?: boolean;
  isEditing?: boolean;
};

export function calculatePurchasePaymentPreview(
  input: PurchasePaymentPreviewInput,
) {
  const totalAmount = input.totalAmount;

  const creditPreviewReady = input.availableCredit !== null;

  const availableSupplierCredit = input.availableCredit ?? 0;

  const applicableSupplierCredit = Math.max(
    0,
    preciseSubtract(
      availableSupplierCredit,
      input.isEditing ? (input.earlierDebt ?? 0) : 0,
    ),
  );

  const cashPaidAmount = input.settleFullInvoice
    ? roundMoney(totalAmount)
    : roundMoney(Math.max(0, input.paidAmount));

  const purchaseOverpayment =
    !input.isEditing && !input.settleFullInvoice && cashPaidAmount > totalAmount
      ? normalizePreciseZero(preciseSubtract(cashPaidAmount, totalAmount))
      : 0;

  const valid =
    !(
      input.isEditing &&
      !input.settleFullInvoice &&
      cashPaidAmount > totalAmount
    ) && !(purchaseOverpayment > 0 && totalAmount <= 0);

  const cashAccountingAmount = input.settleFullInvoice
    ? totalAmount
    : Math.min(cashPaidAmount, totalAmount);

  const remainingAfterCash = normalizePreciseZero(
    Math.max(0, preciseSubtract(totalAmount, cashAccountingAmount)),
  );

  const supplierCreditApplied = input.settleFullInvoice
    ? 0
    : Math.min(remainingAfterCash, applicableSupplierCredit);

  const paid = normalizePreciseZero(
    preciseAdd(cashAccountingAmount, supplierCreditApplied),
  );

  const remaining = normalizePreciseZero(
    Math.max(0, preciseSubtract(totalAmount, paid)),
  );

  const roundingAdjustment = input.settleFullInvoice
    ? normalizePreciseZero(preciseSubtract(cashPaidAmount, totalAmount))
    : 0;

  return {
    valid,
    creditPreviewReady,
    paymentPreviewReady:
      valid && (creditPreviewReady || remainingAfterCash === 0),
    availableSupplierCredit,
    cashPaidAmount,
    cashAccountingAmount,
    supplierCreditApplied,
    purchaseOverpayment,
    paid,
    remaining,
    roundingAdjustment,
  };
}
