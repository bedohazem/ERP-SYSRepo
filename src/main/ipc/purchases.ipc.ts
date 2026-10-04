import { ipcMain } from 'electron';
import { runCriticalActionWithAudit } from './activity-helper';
import { requireAuthenticatedAdmin, requirePermission } from '../auth-session';
import {
  createPurchaseInvoice,
  getPurchaseInvoice,
  listPurchaseInvoices,
  recordSupplierPayment,
  getSupplierStatement,
  cancelPurchaseInvoice,
  createPurchaseReturn,
  listPurchaseReturns,
  cancelSupplierPaymentBatch,
  getSupplierPaymentBatchAccess,
  updateSupplierPaymentBatch,
  getPurchaseReturn,
  updatePurchaseInvoice,
  cancelPurchaseReturn,
  updatePurchaseReturn,
} from '../database/repositories/purchases.repo';
import {
  optionalEnumValue,
  optionalNonNegativeMoney,
  optionalNonNegativeNumber,
  optionalPositiveInteger,
  optionalStringValue,
  optionalTrimmedString,
  requireArrayInput,
  requireEnumValue,
  requireObjectInput,
  requirePositiveInteger,
  requirePositiveMoney,
  requirePositiveNumber,
} from './input-validation';
import { requireAdminPassword } from './permission-helper';

import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  getSmartReorderSuggestions,
  listPurchaseOrders,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
  updatePurchaseOrder,
} from '../database/repositories/purchase-orders.repo';

const PURCHASE_PAYMENT_METHODS = [
  'cash',
  'card',
  'wallet',
  'bank',
  'bank_transfer',

  'store_cash',
  'store_safe',

  'owner_cash',
  'owner_bank',
  'owner_vodafone',
  'fawry_machine',
] as const;

const PURCHASE_DISCOUNT_TYPES = ['amount', 'percent'] as const;

const PURCHASE_RETURN_MODES = ['cash', 'credit'] as const;

const PURCHASE_ORDER_STATUSES = [
  'all',
  'draft',
  'ordered',
  'received',
  'cancelled',
] as const;

function normalizePurchaseItems(value: unknown) {
  const rawItems = requireArrayInput(value, 'أصناف فاتورة الشراء', 500);

  if (rawItems.length === 0) {
    throw new Error('لا توجد أصناف في فاتورة الشراء');
  }

  return rawItems.map((rawItem) => {
    const item = requireObjectInput(rawItem, 'بيانات صنف الشراء');

    return {
      variant_id: requirePositiveInteger(item.variant_id, 'رقم صنف الشراء'),

      quantity: requirePositiveNumber(item.quantity, 'كمية صنف الشراء'),

      unit_cost: requirePositiveMoney(item.unit_cost, 'سعر شراء الصنف'),
    };
  });
}

function normalizePurchaseDiscount(payload: Record<string, unknown>) {
  const discountType =
    optionalEnumValue(
      payload.discount_type,
      PURCHASE_DISCOUNT_TYPES,
      'نوع خصم فاتورة الشراء',
    ) ?? 'amount';

  const discountInput =
    discountType === 'percent'
      ? optionalNonNegativeNumber(
          payload.discount_input,
          'نسبة خصم فاتورة الشراء',
        )
      : optionalNonNegativeMoney(
          payload.discount_input,
          'قيمة خصم فاتورة الشراء',
        );

  if (discountType === 'percent' && Number(discountInput ?? 0) > 100) {
    throw new Error('نسبة الخصم لا يمكن أن تتجاوز 100%');
  }

  return {
    discount_type: discountType,

    discount_input: discountInput,

    discount_value: optionalNonNegativeMoney(
      payload.discount_value,
      'قيمة خصم فاتورة الشراء',
    ),

    sub_total: optionalNonNegativeMoney(
      payload.sub_total,
      'إجمالي فاتورة الشراء قبل الخصم',
    ),
  };
}

function normalizePurchaseWriteInput(input: unknown) {
  const payload = requireObjectInput(input, 'بيانات فاتورة الشراء');

  return {
    supplier_id: requirePositiveInteger(payload.supplier_id, 'رقم المورد'),

    paid_amount: optionalNonNegativeMoney(
      payload.paid_amount,
      'المبلغ المدفوع',
    ),

    payment_method: requireEnumValue(
      payload.payment_method ?? 'cash',
      PURCHASE_PAYMENT_METHODS,
      'طريقة دفع فاتورة الشراء',
    ),

    notes: optionalTrimmedString(payload.notes, 'ملاحظات فاتورة الشراء', 2000),

    items: normalizePurchaseItems(payload.items),

    ...normalizePurchaseDiscount(payload),
  };
}

function normalizePurchaseReturnInput(input: unknown) {
  const payload = requireObjectInput(input, 'بيانات مرتجع الشراء');

  const rawItems = requireArrayInput(payload.items, 'أصناف مرتجع الشراء', 500);

  if (rawItems.length === 0) {
    throw new Error('لا توجد أصناف في المرتجع');
  }

  const items = rawItems.map((rawItem) => {
    const item = requireObjectInput(rawItem, 'بيانات صنف مرتجع الشراء');

    const purchaseItemId = optionalPositiveInteger(
      item.purchase_item_id,
      'رقم بند فاتورة الشراء',
    );

    const variantId = optionalPositiveInteger(
      item.variant_id,
      'رقم صنف مرتجع الشراء',
    );

    if (!purchaseItemId && !variantId) {
      throw new Error('صنف مرتجع الشراء غير صحيح');
    }

    return {
      purchase_item_id: purchaseItemId,

      variant_id: variantId,

      quantity: requirePositiveNumber(item.quantity, 'كمية مرتجع الشراء'),
    };
  });

  return {
    purchase_id: requirePositiveInteger(
      payload.purchase_id,
      'رقم فاتورة الشراء',
    ),

    refund_mode:
      optionalEnumValue(
        payload.refund_mode,
        PURCHASE_RETURN_MODES,
        'طريقة تسوية مرتجع الشراء',
      ) ?? 'cash',

    refund_payment_method: optionalEnumValue(
      payload.refund_payment_method,
      PURCHASE_PAYMENT_METHODS,
      'حساب رد مرتجع الشراء',
    ),

    notes: optionalTrimmedString(payload.notes, 'ملاحظات مرتجع الشراء', 2000),

    items,
  };
}

function normalizePurchaseOrderItems(value: unknown) {
  const rawItems = requireArrayInput(value, 'أصناف أمر الشراء', 500);

  if (rawItems.length === 0) {
    throw new Error('أضف صنفًا واحدًا على الأقل لأمر الشراء');
  }

  return rawItems.map((rawItem) => {
    const item = requireObjectInput(rawItem, 'بيانات صنف أمر الشراء');

    return {
      variant_id: requirePositiveInteger(item.variant_id, 'رقم صنف أمر الشراء'),

      quantity: requirePositiveNumber(item.quantity, 'كمية أمر الشراء'),

      unit_cost:
        optionalNonNegativeMoney(item.unit_cost, 'تكلفة صنف أمر الشراء') ??
        undefined,
    };
  });
}

export function registerPurchasesIpc(): void {
  ipcMain.handle('purchases:create', (event, input) => {
    const actor = requirePermission(event, 'purchases.manage');

    const actorId = actor.id;

    input = normalizePurchaseWriteInput(input);

    if (actor.role !== 'admin' && input.payment_method === 'store_safe') {
      throw new Error('الخزنة الآمنة متاحة لمدير النظام فقط');
    }

    const result = runCriticalActionWithAudit(
      () =>
        createPurchaseInvoice({
          ...input,
          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        action: 'purchase_created',

        entity: 'purchase_invoices',

        entity_id: result.purchaseId,

        details: {
          supplier_id: input.supplier_id,

          total_amount: result.total_amount,

          paid_amount: result.paid_amount,

          remaining_amount: result.remaining_amount,

          payment_status: result.payment_status,

          items_count: input.items?.length || 0,

          shift_id: result.shift_id,
        },
      }),
    );

    return result;
  });

  ipcMain.handle('purchases:update', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event);

    const payload = requireObjectInput(input, 'بيانات تعديل فاتورة الشراء');

    const adminPassword = optionalStringValue(
      payload.admin_password,
      'كلمة مرور المدير',
      256,
    );

    const approval = requireAdminPassword(actorId, adminPassword);

    const purchaseId = requirePositiveInteger(
      payload.purchase_id,
      'رقم فاتورة الشراء',
    );

    input = {
      ...normalizePurchaseWriteInput(payload),

      purchase_id: purchaseId,

      reason: optionalTrimmedString(
        payload.reason,
        'سبب تعديل فاتورة الشراء',
        500,
      ),
    };

    const before = getPurchaseInvoice(purchaseId);

    const criticalResult = runCriticalActionWithAudit(
      () => {
        const result = updatePurchaseInvoice({
          ...input,

          purchase_id: purchaseId,

          actor_id: actorId,
        });

        const after = getPurchaseInvoice(purchaseId);

        return {
          result,
          after,
        };
      },

      ({ after }) => ({
        actor_id: actorId,

        approved_by: approval.id,

        action: 'purchase_updated',

        entity: 'purchase_invoices',

        entity_id: purchaseId,

        details: {
          reason: input?.reason || null,

          before: {
            purchase: before.purchase,

            items: before.items,

            payments: before.payments,
          },

          after: {
            purchase: after.purchase,

            items: after.items,

            payments: after.payments,
          },
        },
      }),
    );

    return criticalResult.result;
  });

  ipcMain.handle('purchases:list', (event, input) => {
    requirePermission(event, 'purchases.manage');

    return listPurchaseInvoices(input);
  });

  ipcMain.handle('purchases:get-by-id', (event, purchaseId: number) => {
    requirePermission(event, 'purchases.manage');

    return getPurchaseInvoice(
      requirePositiveInteger(purchaseId, 'رقم فاتورة الشراء'),
    );
  });

  ipcMain.handle('purchases:cancel', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event);

    const payload = requireObjectInput(input, 'بيانات إلغاء فاتورة الشراء');

    const adminPassword = optionalStringValue(
      payload.admin_password,
      'كلمة مرور المدير',
      256,
    );
    const approval = requireAdminPassword(
      actorId,

      adminPassword,
    );

    const purchaseId = requirePositiveInteger(
      payload.purchase_id,
      'رقم فاتورة الشراء',
    );

    const reason = optionalTrimmedString(
      payload.reason,
      'سبب إلغاء فاتورة الشراء',
      500,
    );

    const result = runCriticalActionWithAudit(
      () =>
        cancelPurchaseInvoice({
          purchase_id: purchaseId,

          reason: reason || '',

          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        approved_by: approval.id,

        action: 'purchase_cancelled',

        entity: 'purchase_invoices',

        entity_id: purchaseId,

        details: {
          purchase_id: purchaseId,

          reason: reason || '',

          reversed_total: result.reversed_total,

          reversed_paid: result.reversed_paid,

          reversed_remaining: result.reversed_remaining,

          items_count: result.items_count,

          shift_id: result.cancelled_shift_id,
        },
      }),
    );

    return result;
  });

  ipcMain.handle('purchases:returns:create', (event, input) => {
    const actor = requirePermission(event, 'purchases.manage');

    const actorId = actor.id;

    input = normalizePurchaseReturnInput(input);

    if (
      actor.role !== 'admin' &&
      input.refund_payment_method === 'store_safe'
    ) {
      throw new Error('الخزنة الآمنة متاحة لمدير النظام فقط');
    }

    const purchaseId = input.purchase_id;

    const result = runCriticalActionWithAudit(
      () =>
        createPurchaseReturn({
          ...input,

          purchase_id: purchaseId,

          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        action: 'purchase_return_created',

        entity: 'purchase_returns',

        entity_id: result.return_id,

        details: {
          purchase_id: purchaseId,

          supplier_id: result.supplier_id,

          total_amount: result.total_amount,

          items_count: input?.items?.length || 0,

          notes: input?.notes || '',

          shift_id: result.shift_id,
        },
      }),
    );

    return result;
  });

  ipcMain.handle('purchases:returns:cancel', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event);
    const payload = requireObjectInput(input, 'بيانات إلغاء مرتجع الشراء');

    const adminPassword = optionalStringValue(
      payload.admin_password,
      'كلمة مرور المدير',
      256,
    );

    const returnId = requirePositiveInteger(
      payload.return_id,
      'رقم مرتجع الشراء',
    );

    const reason = optionalTrimmedString(
      payload.reason,
      'سبب إلغاء مرتجع الشراء',
      500,
    );
    const approval = requireAdminPassword(actorId, adminPassword);

    const before = getPurchaseReturn(returnId);

    const result = runCriticalActionWithAudit(
      () =>
        cancelPurchaseReturn({
          return_id: returnId,

          reason: reason,

          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        approved_by: approval.id,

        action: 'purchase_return_cancelled',

        entity: 'purchase_returns',

        entity_id: returnId,

        details: {
          reason: reason || null,

          purchase_id: result.purchase_id,

          restored_total: result.restored_total,

          restored_debt: result.restored_debt,

          reversed_cash: result.reversed_cash,

          items_count: result.items_count,

          cancelled_shift_id: result.cancelled_shift_id,

          before,
        },
      }),
    );

    return result;
  });

  ipcMain.handle('purchases:returns:update', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event);

    const payload = requireObjectInput(input, 'بيانات تعديل مرتجع الشراء');

    const adminPassword = optionalStringValue(
      payload.admin_password,
      'كلمة مرور المدير',
      256,
    );

    const returnId = requirePositiveInteger(
      payload.return_id,
      'رقم مرتجع الشراء',
    );

    input = {
      ...normalizePurchaseReturnInput({
        ...payload,

        purchase_id: payload.purchase_id ?? 1,
      }),

      return_id: returnId,

      reason: optionalTrimmedString(
        payload.reason,
        'سبب تعديل مرتجع الشراء',
        500,
      ),
    };

    delete (
      input as {
        purchase_id?: number;
      }
    ).purchase_id;

    const approval = requireAdminPassword(actorId, adminPassword);

    const before = getPurchaseReturn(returnId);

    const criticalResult = runCriticalActionWithAudit(
      () => {
        const result = updatePurchaseReturn({
          ...input,

          return_id: returnId,

          actor_id: actorId,
        });

        const after = getPurchaseReturn(result.return_id);

        return {
          result,
          after,
        };
      },

      ({ result, after }) => ({
        actor_id: actorId,

        approved_by: approval.id,

        action: 'purchase_return_updated',

        entity: 'purchase_returns',

        entity_id: returnId,

        details: {
          reason: input?.reason || null,

          replacement_return_id: result.return_id,

          before,

          after,
        },
      }),
    );

    return criticalResult.result;
  });

  ipcMain.handle('purchases:returns:list', (event, input) => {
    requirePermission(event, 'purchases.manage');

    return listPurchaseReturns(input);
  });

  ipcMain.handle('purchases:returns:get-by-id', (event, returnId: number) => {
    requirePermission(event, 'purchases.manage');

    return getPurchaseReturn(
      requirePositiveInteger(returnId, 'رقم مرتجع الشراء'),
    );
  });

  ipcMain.handle('suppliers:record-payment', (event, input) => {
    const actor = requirePermission(event, 'purchases.manage');

    const actorId = actor.id;

    const payload = requireObjectInput(input, 'بيانات دفعة المورد');

    const paymentMethod = requireEnumValue(
      payload.payment_method ?? 'cash',
      PURCHASE_PAYMENT_METHODS,
      'طريقة دفع المورد',
    );

    if (actor.role !== 'admin' && paymentMethod === 'store_safe') {
      throw new Error('الخزنة الآمنة متاحة لمدير النظام فقط');
    }

    input = {
      supplier_id: requirePositiveInteger(payload.supplier_id, 'رقم المورد'),

      purchase_id: optionalPositiveInteger(
        payload.purchase_id,
        'رقم فاتورة الشراء',
      ),

      amount: requirePositiveMoney(payload.amount, 'مبلغ دفعة المورد'),

      payment_method: paymentMethod,

      notes: optionalTrimmedString(payload.notes, 'ملاحظات دفعة المورد', 1000),
    };

    const result = runCriticalActionWithAudit(
      () =>
        recordSupplierPayment({
          ...input,

          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        action: 'supplier_payment_recorded',

        entity: 'supplier_payment_batches',

        entity_id: result.payment_batch_id,

        details: {
          supplier_id: result.supplier_id,

          amount: result.paid_amount,

          allocations: result.allocations,

          shift_id: result.shift_id,
        },
      }),
    );

    return result;
  });

  ipcMain.handle('suppliers:cancel-payment', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event);

      const payload = requireObjectInput(input, 'بيانات دفعة المورد');

      const batchId = requirePositiveInteger(
        payload.batch_id,
        'رقم دفعة المورد',
      );

      const access = getSupplierPaymentBatchAccess(batchId, actorId);

      let approvedBy: number | null = null;

      if (access.requires_admin_password) {
        approvedBy = requireAdminPassword(
          actorId,

          input?.admin_password,
        ).id;
      }

      const result = runCriticalActionWithAudit(
        () =>
          cancelSupplierPaymentBatch({
            batch_id: batchId,

            reason: input?.reason,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          approved_by: approvedBy,

          action: 'supplier_payment_cancelled',

          entity: 'supplier_payment_batches',

          entity_id: batchId,

          details: {
            supplier_id: result.supplier_id,

            amount: result.cancelled_amount,

            reason: optionalTrimmedString(
              payload.reason,
              'سبب إلغاء دفعة المورد',
              500,
            ),

            shift_id: result.cancelled_shift_id,
          },
        }),
      );

      return result;
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر إلغاء دفعة المورد',
      };
    }
  });

  ipcMain.handle('suppliers:update-payment', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event);

      const payload = requireObjectInput(input, 'بيانات دفعة المورد');

      const batchId = requirePositiveInteger(
        payload.batch_id,
        'رقم دفعة المورد',
      );

      const access = getSupplierPaymentBatchAccess(batchId, actorId);

      let approvedBy: number | null = null;

      if (access.requires_admin_password) {
        approvedBy = requireAdminPassword(
          actorId,

          input?.admin_password,
        ).id;
      }

      const result = runCriticalActionWithAudit(
        () =>
          updateSupplierPaymentBatch({
            batch_id: batchId,

            amount: requirePositiveMoney(payload.amount, 'مبلغ دفعة المورد'),

            payment_method: requireEnumValue(
              payload.payment_method,
              PURCHASE_PAYMENT_METHODS,
              'طريقة دفع المورد',
            ),

            notes: optionalTrimmedString(
              payload.notes,
              'ملاحظات دفعة المورد',
              1000,
            ),

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          approved_by: approvedBy,

          action: 'supplier_payment_updated',

          entity: 'supplier_payment_batches',

          entity_id: batchId,

          details: {
            supplier_id: result.supplier_id,

            replacement_batch_id: result.batch_id,

            old_amount: result.old_amount,

            new_amount: result.new_amount,

            payment_method: result.payment_method,

            shift_id: result.shift_id,
          },
        }),
      );

      return result;
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر تعديل دفعة المورد',
      };
    }
  });

  ipcMain.handle('suppliers:statement', (event, supplierId: number) => {
    const actorId = requirePermission(event, 'purchases.manage').id;

    return getSupplierStatement(
      requirePositiveInteger(supplierId, 'رقم المورد'),
      actorId,
    );
  });

  ipcMain.handle('purchases:reorder-suggestions', (event, input) => {
    requirePermission(event, 'purchases.manage');

    return getSmartReorderSuggestions(input);
  });

  ipcMain.handle('purchases:orders:list', (event, input) => {
    requirePermission(event, 'purchases.manage');

    return listPurchaseOrders(input);
  });

  ipcMain.handle('purchases:orders:get', (event, purchaseOrderId: number) => {
    requirePermission(event, 'purchases.manage');

    return getPurchaseOrder(
      requirePositiveInteger(purchaseOrderId, 'رقم أمر الشراء'),
    );
  });

  ipcMain.handle('purchases:orders:create', (event, input) => {
    const actorId = requirePermission(event, 'purchases.manage').id;

    const payload = requireObjectInput(input, 'بيانات أمر الشراء');

    input = {
      supplier_id: requirePositiveInteger(payload.supplier_id, 'رقم المورد'),

      notes: optionalTrimmedString(payload.notes, 'ملاحظات أمر الشراء', 2000),

      items: normalizePurchaseOrderItems(payload.items),
    };

    return runCriticalActionWithAudit(
      () =>
        createPurchaseOrder({
          ...input,

          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        action: 'purchase_order_created',

        entity: 'purchase_orders',

        entity_id: result.purchase_order_id,

        details: {
          supplier_id: input.supplier_id,

          items_count: result.items_count,

          total_amount: result.total_amount,
        },
      }),
    );
  });

  ipcMain.handle('purchases:orders:update', (event, input) => {
    const actorId = requirePermission(event, 'purchases.manage').id;

    const payload = requireObjectInput(input, 'بيانات تعديل أمر الشراء');

    const orderId = requirePositiveInteger(
      payload.purchase_order_id,
      'رقم أمر الشراء',
    );

    input = {
      purchase_order_id: orderId,

      supplier_id: requirePositiveInteger(payload.supplier_id, 'رقم المورد'),

      notes: optionalTrimmedString(payload.notes, 'ملاحظات أمر الشراء', 2000),

      items: normalizePurchaseOrderItems(payload.items),
    };

    return runCriticalActionWithAudit(
      () => updatePurchaseOrder(input),

      (result) => ({
        actor_id: actorId,

        action: 'purchase_order_updated',

        entity: 'purchase_orders',

        entity_id: orderId,

        details: {
          supplier_id: result.order.supplier_id,

          items_count: result.order.items_count,

          total_amount: result.order.total_amount,
        },
      }),
    );
  });

  ipcMain.handle('purchases:orders:mark-ordered', (event, input) => {
    const actorId = requirePermission(event, 'purchases.manage').id;

    const payload = requireObjectInput(input, 'بيانات اعتماد أمر الشراء');

    const orderId = requirePositiveInteger(
      payload.purchase_order_id,
      'رقم أمر الشراء',
    );

    return runCriticalActionWithAudit(
      () =>
        markPurchaseOrderOrdered({
          purchase_order_id: orderId,

          actor_id: actorId,
        }),

      () => ({
        actor_id: actorId,

        action: 'purchase_order_ordered',

        entity: 'purchase_orders',

        entity_id: orderId,

        details: {},
      }),
    );
  });

  ipcMain.handle('purchases:orders:cancel', (event, input) => {
    const actorId = requirePermission(event, 'purchases.manage').id;

    const payload = requireObjectInput(input, 'بيانات اعتماد أمر الشراء');

    const orderId = requirePositiveInteger(
      payload.purchase_order_id,
      'رقم أمر الشراء',
    );

    const reason = optionalTrimmedString(
      payload.reason,
      'سبب إلغاء أمر الشراء',
      500,
    );

    return runCriticalActionWithAudit(
      () =>
        cancelPurchaseOrder({
          purchase_order_id: orderId,

          reason: reason,

          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        action: 'purchase_order_cancelled',

        entity: 'purchase_orders',

        entity_id: orderId,

        details: {
          reason: reason,
        },
      }),
    );
  });

  ipcMain.handle('purchases:orders:receive', (event, input) => {
    const actor = requirePermission(event, 'purchases.manage');

    const actorId = actor.id;

    const payload = requireObjectInput(input, 'بيانات استلام أمر الشراء');

    const orderId = requirePositiveInteger(
      payload.purchase_order_id,
      'رقم أمر الشراء',
    );

    const paymentMethod = requireEnumValue(
      payload.payment_method ?? 'cash',
      PURCHASE_PAYMENT_METHODS,
      'طريقة دفع أمر الشراء',
    );

    if (actor.role !== 'admin' && paymentMethod === 'store_safe') {
      throw new Error('الخزنة الآمنة متاحة لمدير النظام فقط');
    }

    const discount = normalizePurchaseDiscount(payload);

    input = {
      purchase_order_id: orderId,

      paid_amount: optionalNonNegativeMoney(
        payload.paid_amount,
        'المبلغ المدفوع',
      ),

      payment_method: paymentMethod,

      notes: optionalTrimmedString(
        payload.notes,
        'ملاحظات استلام أمر الشراء',
        2000,
      ),

      ...discount,
    };

    return runCriticalActionWithAudit(
      () =>
        receivePurchaseOrder({
          ...input,

          purchase_order_id: orderId,

          actor_id: actorId,
        }),

      (result) => [
        {
          actor_id: actorId,

          action: 'purchase_created',

          entity: 'purchase_invoices',

          entity_id: result.purchaseId,

          details: {
            source: 'purchase_order',

            purchase_order_id: orderId,

            total_amount: result.total_amount,

            paid_amount: result.paid_amount,

            remaining_amount: result.remaining_amount,

            payment_status: result.payment_status,

            shift_id: result.shift_id,
          },
        },

        {
          actor_id: actorId,

          action: 'purchase_order_received',

          entity: 'purchase_orders',

          entity_id: orderId,

          details: {
            purchase_id: result.purchaseId,

            total_amount: result.total_amount,
          },
        },
      ],
    );
  });
}
