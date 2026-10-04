import { ipcMain } from 'electron';
import {
  cancelLiability,
  createLiability,
  getLiabilitiesSummary,
  getLiabilityStatement,
  listLiabilities,
  listLiabilitiesPage,
  cancelLiabilityPayment,
  recordLiabilityPayment,
  updateLiability,
  updateLiabilityPayment,
} from '../database/repositories/liabilities.repo';
import { requireAuthenticatedAdmin, requirePermission } from '../auth-session';
import { requireAdminPassword } from './permission-helper';
import {
  optionalDateOnly,
  optionalNonNegativeMoney,
  optionalStringValue,
  optionalTrimmedString,
  requireEnumValue,
  requireObjectInput,
  requirePositiveInteger,
  requirePositiveMoney,
  requireTrimmedString,
} from './input-validation';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع';
}

const LIABILITY_PAYMENT_METHODS = [
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

export function registerLiabilitiesIpc(): void {
  ipcMain.handle('liabilities:list', (event, input) => {
    requirePermission(event, 'liabilities.manage');

    return listLiabilities(input);
  });

  ipcMain.handle('liabilities:list-page', (event, input) => {
    requirePermission(event, 'liabilities.manage');

    return listLiabilitiesPage(input);
  });

  ipcMain.handle('liabilities:create', (event, input) => {
    try {
      const actor = requirePermission(event, 'liabilities.manage');

      const actorId = actor.id;

      const payload = requireObjectInput(input, 'بيانات الالتزام');

      const paymentMethod = requireEnumValue(
        payload.payment_method ?? 'cash',
        LIABILITY_PAYMENT_METHODS,
        'طريقة دفع الالتزام',
      );

      if (actor.role !== 'admin' && paymentMethod === 'store_safe') {
        throw new Error('الخزنة الآمنة متاحة لمدير النظام فقط');
      }

      input = {
        party_name: requireTrimmedString(
          payload.party_name,
          'اسم الشخص أو الجهة',
          200,
        ),

        title: requireTrimmedString(payload.title, 'عنوان الالتزام', 300),

        category: optionalTrimmedString(
          payload.category,
          'تصنيف الالتزام',
          100,
        ),

        total_amount: requirePositiveMoney(
          payload.total_amount,
          'قيمة الالتزام',
        ),

        paid_amount: optionalNonNegativeMoney(
          payload.paid_amount,
          'الدفعة المبدئية',
        ),

        payment_method: paymentMethod,

        due_date: optionalDateOnly(payload.due_date, 'تاريخ الاستحقاق'),

        notes: optionalTrimmedString(payload.notes, 'ملاحظات الالتزام', 2000),
      };

      return createLiability({
        ...input,
        actor_id: actorId,
      });
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('liabilities:update', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event);
      const payload = requireObjectInput(input, 'بيانات تعديل الالتزام');

      const adminPassword = optionalStringValue(
        payload.admin_password,
        'كلمة مرور المدير',
        256,
      );

      const approval = requireAdminPassword(
        actorId,

        adminPassword,
      );

      return updateLiability({
        id: requirePositiveInteger(payload.id, 'رقم الالتزام'),

        party_name: requireTrimmedString(
          payload.party_name,
          'اسم الشخص أو الجهة',
          200,
        ),

        title: requireTrimmedString(payload.title, 'عنوان الالتزام', 300),

        category: optionalTrimmedString(
          payload.category,
          'تصنيف الالتزام',
          100,
        ),

        total_amount: requirePositiveMoney(
          payload.total_amount,
          'قيمة الالتزام',
        ),

        due_date: optionalDateOnly(payload.due_date, 'تاريخ الاستحقاق'),

        notes: optionalTrimmedString(payload.notes, 'ملاحظات الالتزام', 2000),
        approved_by: approval.id,
        actor_id: actorId,
      });
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('liabilities:record-payment', (event, input) => {
    try {
      const actor = requirePermission(event, 'liabilities.manage');

      const actorId = actor.id;

      const payload = requireObjectInput(input, 'بيانات دفعة الالتزام');

      const paymentMethod = requireEnumValue(
        payload.payment_method ?? 'cash',
        LIABILITY_PAYMENT_METHODS,
        'طريقة دفع الالتزام',
      );

      if (actor.role !== 'admin' && paymentMethod === 'store_safe') {
        throw new Error('الخزنة الآمنة متاحة لمدير النظام فقط');
      }

      return recordLiabilityPayment({
        liability_id: requirePositiveInteger(
          payload.liability_id,
          'رقم الالتزام',
        ),

        amount: requirePositiveMoney(payload.amount, 'مبلغ دفعة الالتزام'),

        payment_method: paymentMethod,

        notes: optionalTrimmedString(
          payload.notes,
          'ملاحظات دفعة الالتزام',
          1000,
        ),

        actor_id: actorId,
      });
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('liabilities:statement', (event, liabilityId: unknown) => {
    requirePermission(event, 'liabilities.manage');

    return getLiabilityStatement(
      requirePositiveInteger(liabilityId, 'رقم الالتزام'),
    );
  });

  ipcMain.handle('liabilities:cancel', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event);
      const payload = requireObjectInput(input, 'بيانات إلغاء الالتزام');
      return cancelLiability({
        id: requirePositiveInteger(payload.id, 'رقم الالتزام'),

        reason: optionalTrimmedString(
          payload.reason,
          'سبب إلغاء الالتزام',
          500,
        ),

        actor_id: actorId,
      });
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('liabilities:summary', (event, input) => {
    requirePermission(event, 'liabilities.manage');

    return getLiabilitiesSummary(input);
  });

  ipcMain.handle('liabilities:cancel-payment', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event);
      const payload = requireObjectInput(input, 'بيانات إلغاء دفعة الالتزام');

      const adminPassword = optionalStringValue(
        payload.admin_password,
        'كلمة مرور المدير',
        256,
      );
      const approval = requireAdminPassword(
        actorId,

        adminPassword,
      );

      return cancelLiabilityPayment({
        payment_id: requirePositiveInteger(
          payload.payment_id,
          'رقم دفعة الالتزام',
        ),

        reason: optionalTrimmedString(
          payload.reason,
          'سبب إلغاء دفعة الالتزام',
          500,
        ),
        approved_by: approval.id,
        actor_id: actorId,
      });
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('liabilities:update-payment', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event);
      const payload = requireObjectInput(input, 'بيانات تحديث دفعة الالتزام');

      const adminPassword = optionalStringValue(
        payload.admin_password,
        'كلمة مرور المدير',
        256,
      );
      const approval = requireAdminPassword(
        actorId,

        adminPassword,
      );

      const paymentMethod = requireEnumValue(
        payload.payment_method,
        LIABILITY_PAYMENT_METHODS,
        'طريقة دفع الالتزام',
      );

      return updateLiabilityPayment({
        payment_id: requirePositiveInteger(
          payload.payment_id,
          'رقم دفعة الالتزام',
        ),

        approved_by: approval.id,

        amount: requirePositiveMoney(payload.amount, 'مبلغ دفعة الالتزام'),

        payment_method: paymentMethod,

        notes: optionalTrimmedString(
          payload.notes,
          'ملاحظات دفعة الالتزام',
          1000,
        ),

        actor_id: actorId,
      });
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      };
    }
  });
}
