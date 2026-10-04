import { ipcMain } from 'electron';
import {
  requireAdmin,
  requireAdminApprovalForActor,
} from './permission-helper';
import { runCriticalActionWithAudit } from './activity-helper';
import {
  adjustCustomerPoints,
  createCustomer,
  deleteCustomer,
  getCustomerById,
  getCustomerHistory,
  getCustomers,
  searchCustomers,
  updateCustomer,
  recordCustomerPayment,
  listCustomers,
  getCustomerStatement,
  cancelCustomerPaymentBatch,
  getCustomerPaymentBatchAccess,
  updateCustomerPaymentBatch,
} from '../database/repositories/customers.repo';
import { requireAuthenticatedAdmin, requirePermission } from '../auth-session';
import {
  optionalNonNegativeInteger,
  optionalNonNegativeMoney,
  optionalPositiveInteger,
  optionalStringValue,
  optionalTrimmedString,
  requireEnumValue,
  requireNonZeroInteger,
  requireObjectInput,
  requirePositiveInteger,
  requirePositiveMoney,
  requireTrimmedString,
} from './input-validation';

const CUSTOMER_PAYMENT_METHODS = [
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

function normalizeCustomerInput(input: unknown, withId = false) {
  const payload = requireObjectInput(input, 'بيانات العميل');

  return {
    ...(withId
      ? {
          id: requirePositiveInteger(payload.id, 'رقم العميل'),
        }
      : {}),

    name: requireTrimmedString(payload.name, 'اسم العميل', 200),

    phone: optionalTrimmedString(payload.phone, 'رقم هاتف العميل', 50),

    email: optionalTrimmedString(payload.email, 'البريد الإلكتروني', 320),

    address: optionalTrimmedString(payload.address, 'عنوان العميل', 500),

    notes: optionalTrimmedString(payload.notes, 'ملاحظات العميل', 2000),

    credit_limit: optionalNonNegativeMoney(
      payload.credit_limit,
      'الحد الائتماني',
    ),

    credit_days: optionalNonNegativeInteger(
      payload.credit_days,
      'مدة الائتمان',
    ),
  };
}

export function registerCustomersIpc(): void {
  ipcMain.handle('customers:list', (event) => {
    requirePermission(event, 'customers.view');

    return getCustomers();
  });

  ipcMain.handle('customers:list-page', (event, input) => {
    requirePermission(event, 'customers.view');

    return listCustomers(input);
  });

  ipcMain.handle('customers:search', (event, query: string) => {
    requirePermission(event, 'customers.view');

    return searchCustomers(query ?? '');
  });

  ipcMain.handle('customers:get-by-id', (event, id: unknown) => {
    requirePermission(event, 'customers.view');

    return getCustomerById(requirePositiveInteger(id, 'رقم العميل'));
  });

  ipcMain.handle('customers:create', (event, input) => {
    const actorId = requirePermission(event, 'customers.manage').id;
    input = normalizeCustomerInput(input);

    return runCriticalActionWithAudit(
      () => createCustomer(input) as any,

      (customer) => ({
        actor_id: actorId,

        action: 'customer_created',

        entity: 'customers',

        entity_id: Number(customer?.id || 0) || null,

        details: {
          name: customer?.name || input?.name,

          phone: customer?.phone || input?.phone,
        },
      }),
    );
  });

  ipcMain.handle('customers:update', (event, input) => {
    const actorId = requirePermission(event, 'customers.manage').id;
    input = normalizeCustomerInput(input, true);

    return runCriticalActionWithAudit(
      () => updateCustomer(input) as any,

      (customer) => ({
        actor_id: actorId,

        action: 'customer_updated',

        entity: 'customers',

        entity_id: Number(input?.id),

        details: {
          name: customer?.name || input?.name,

          phone: customer?.phone || input?.phone,
        },
      }),
    );
  });

  ipcMain.handle('customers:delete', (event, id: unknown) => {
    const actorId = requireAuthenticatedAdmin(event);

    const customerId = requirePositiveInteger(id, 'رقم العميل');

    const customer = getCustomerById(customerId) as any;

    return runCriticalActionWithAudit(
      () => deleteCustomer(customerId),

      () => ({
        actor_id: actorId,

        action: 'customer_deactivated',

        entity: 'customers',

        entity_id: customerId,

        details: {
          name: customer?.name || '',

          phone: customer?.phone || '',

          balance: Number(customer?.balance || 0),
        },
      }),
    );
  });

  ipcMain.handle('customers:history', (event, customerId: unknown) => {
    requirePermission(event, 'customers.view');

    return getCustomerHistory(requirePositiveInteger(customerId, 'رقم العميل'));
  });

  ipcMain.handle('customers:adjust-points', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event);
    const payload = requireObjectInput(input, 'بيانات تعديل النقاط');

    input = {
      customer_id: requirePositiveInteger(payload.customer_id, 'رقم العميل'),

      points: requireNonZeroInteger(payload.points, 'عدد النقاط'),

      notes: optionalTrimmedString(payload.notes, 'ملاحظات تعديل النقاط', 1000),
    };

    return runCriticalActionWithAudit(
      () => adjustCustomerPoints(input),

      () => ({
        actor_id: actorId,

        action: 'customer_points_adjusted',

        entity: 'customers',

        entity_id: Number(input?.customer_id),

        details: {
          customer_id: Number(input?.customer_id),

          points: Number(input?.points || 0),

          notes: input?.notes || '',
        },
      }),
    );
  });

  ipcMain.handle('customers:record-payment', (event, input) => {
    const actor = requirePermission(event, 'customers.payments');

    const actorId = actor.id;

    const payload = requireObjectInput(input, 'بيانات دفعة العميل');

    const paymentMethod = requireEnumValue(
      payload.payment_method ?? 'cash',
      CUSTOMER_PAYMENT_METHODS,
      'طريقة دفع العميل',
    );

    if (actor.role !== 'admin' && paymentMethod === 'store_safe') {
      throw new Error('الخزنة الآمنة متاحة لمدير النظام فقط');
    }

    input = {
      customer_id: requirePositiveInteger(payload.customer_id, 'رقم العميل'),

      sale_id: optionalPositiveInteger(payload.sale_id, 'رقم فاتورة البيع'),

      amount: requirePositiveMoney(payload.amount, 'مبلغ دفعة العميل'),

      payment_method: paymentMethod,

      notes: optionalTrimmedString(payload.notes, 'ملاحظات دفعة العميل', 1000),
    };

    return runCriticalActionWithAudit(
      () =>
        recordCustomerPayment({
          ...input,

          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        action: 'customer_payment_created',

        entity: 'customer_payment_batches',

        entity_id: result.payment_batch_id,

        details: {
          customer_id: result.customer_id,

          amount: result.paid_amount,

          payment_method: input?.payment_method || 'cash',

          allocations: result.allocations,

          shift_id: result.shift_id,
        },
      }),
    );
  });

  ipcMain.handle('customers:cancel-payment', (event, input) => {
    try {
      const actor = requirePermission(event, 'customers.payments');

      const actorId = actor.id;

      const payload = requireObjectInput(input, 'بيانات إلغاء دفعة العميل');

      input = {
        batch_id: requirePositiveInteger(payload.batch_id, 'رقم دفعة العميل'),

        reason: optionalTrimmedString(
          payload.reason,
          'سبب إلغاء دفعة العميل',
          500,
        ),

        admin_username: optionalTrimmedString(
          payload.admin_username,
          'اسم مستخدم المدير',
          128,
        ),

        admin_password: optionalStringValue(
          payload.admin_password,
          'كلمة مرور المدير',
          256,
        ),
      };

      let approvedBy: number | null = null;

      const access = getCustomerPaymentBatchAccess(input.batch_id, actorId);

      if (Number(access.created_by || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId);
      }

      if (access.requires_admin_password) {
        const approval = requireAdminApprovalForActor(
          actor,

          input?.admin_username,

          input?.admin_password,
        );

        approvedBy = approval.id;
      }

      const batchId = input.batch_id;

      const result = runCriticalActionWithAudit(
        () =>
          cancelCustomerPaymentBatch({
            batch_id: batchId,

            reason: input?.reason,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          approved_by: approvedBy,

          action: 'customer_payment_cancelled',

          entity: 'customer_payment_batches',

          entity_id: batchId,

          details: {
            customer_id: result.customer_id,

            amount: result.cancelled_amount,

            reason: input?.reason,

            shift_id: result.cancelled_shift_id,
          },
        }),
      );

      return result;
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر إلغاء دفعة العميل',
      };
    }
  });

  ipcMain.handle('customers:update-payment', (event, input) => {
    try {
      const actor = requirePermission(event, 'customers.payments');

      const actorId = actor.id;

      const payload = requireObjectInput(input, 'بيانات تعديل دفعة العميل');

      const paymentMethod = requireEnumValue(
        payload.payment_method,
        CUSTOMER_PAYMENT_METHODS,
        'طريقة دفع العميل',
      );

      if (actor.role !== 'admin' && paymentMethod === 'store_safe') {
        throw new Error('الخزنة الآمنة متاحة لمدير النظام فقط');
      }

      input = {
        batch_id: requirePositiveInteger(payload.batch_id, 'رقم دفعة العميل'),

        amount: requirePositiveMoney(payload.amount, 'مبلغ دفعة العميل'),

        payment_method: paymentMethod,

        notes: optionalTrimmedString(
          payload.notes,
          'ملاحظات دفعة العميل',
          1000,
        ),

        admin_username: optionalTrimmedString(
          payload.admin_username,
          'اسم مستخدم المدير',
          128,
        ),

        admin_password: optionalStringValue(
          payload.admin_password,
          'كلمة مرور المدير',
          256,
        ),
      };

      let approvedBy: number | null = null;

      const access = getCustomerPaymentBatchAccess(input.batch_id, actorId);

      if (Number(access.created_by || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId);
      }

      if (access.requires_admin_password) {
        const approval = requireAdminApprovalForActor(
          actor,

          input?.admin_username,

          input?.admin_password,
        );

        approvedBy = approval.id;
      }

      const batchId = input.batch_id;

      const result = runCriticalActionWithAudit(
        () =>
          updateCustomerPaymentBatch({
            batch_id: batchId,

            amount: input.amount,

            payment_method: input?.payment_method,

            notes: input?.notes,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          approved_by: approvedBy,

          action: 'customer_payment_updated',

          entity: 'customer_payment_batches',

          entity_id: batchId,

          details: {
            customer_id: result.customer_id,

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
          error instanceof Error ? error.message : 'تعذر تعديل دفعة العميل',
      };
    }
  });

  ipcMain.handle('customers:statement', (event, customerId: unknown) => {
    const actorId = requirePermission(event, 'customers.payments').id;

    return getCustomerStatement(
      requirePositiveInteger(customerId, 'رقم العميل'),
      actorId,
    );
  });
}
