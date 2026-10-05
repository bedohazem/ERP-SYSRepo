import { ipcMain } from 'electron';

import {
  cancelExpense,
  createExpense,
  listExpensesPage,
  listExpenses,
  updateExpense,
} from '../database/repositories/expense.repo';

import { requireAdminPassword } from './permission-helper';
import { requirePermission } from '../auth-session';

import {
  optionalDateOnly,
  optionalEnumValue,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalStringValue,
  optionalTrimmedString,
  requireEnumValue,
  requireObjectInput,
  requirePositiveInteger,
  requirePositiveMoney,
  requireTrimmedString,
} from './input-validation';

const EXPENSE_PAYMENT_METHODS = [
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

function assertExpenseAccountAccess(role: string, paymentMethod?: string) {
  if (paymentMethod === 'store_safe' && role !== 'admin') {
    throw new Error('الخزنة الآمنة متاحة لمدير النظام فقط');
  }
}

export function registerExpenseIpc(): void {
  ipcMain.handle('expenses:create', (event, input) => {
    const user = requirePermission(event, 'expenses.manage');

    const payload = requireObjectInput(input, 'بيانات المصروف');

    const paymentMethod = requireEnumValue(
      payload.payment_method ?? 'cash',
      EXPENSE_PAYMENT_METHODS,
      'طريقة دفع المصروف',
    );

    assertExpenseAccountAccess(user.role, paymentMethod);

    return createExpense({
      title: requireTrimmedString(payload.title, 'عنوان المصروف', 500),

      category: optionalTrimmedString(payload.category, 'تصنيف المصروف', 500),

      amount: requirePositiveMoney(payload.amount, 'قيمة المصروف'),

      payment_method: paymentMethod,

      notes: optionalTrimmedString(payload.notes, 'ملاحظات المصروف', 2000),

      created_by: user.id,
    });
  });

  ipcMain.handle('expenses:list', (event, input) => {
    const user = requirePermission(event, 'expenses.view');

    const payload = requireObjectInput(input ?? {}, 'فلتر المصروفات');

    return listExpenses({
      date_from:
        optionalDateOnly(payload.date_from, 'تاريخ بداية المصروفات') ??
        undefined,

      date_to:
        optionalDateOnly(payload.date_to, 'تاريخ نهاية المصروفات') ?? undefined,

      created_by: user.role === 'admin' ? undefined : user.id,
    });
  });

  ipcMain.handle('expenses:list-page', (event, input) => {
    const user = requirePermission(event, 'expenses.view');

    const payload = requireObjectInput(input ?? {}, 'فلتر المصروفات');

    return listExpensesPage({
      date_from:
        optionalDateOnly(payload.date_from, 'تاريخ بداية المصروفات') ??
        undefined,

      date_to:
        optionalDateOnly(payload.date_to, 'تاريخ نهاية المصروفات') ?? undefined,

      created_by: user.role === 'admin' ? undefined : user.id,

      limit: optionalPositiveInteger(payload.limit, 'عدد النتائج') ?? undefined,

      offset:
        optionalNonNegativeInteger(payload.offset, 'بداية النتائج') ??
        undefined,
    });
  });

  ipcMain.handle('expenses:update', (event, input) => {
    try {
      const user = requirePermission(event, 'expenses.manage');

      const isAdmin = user.role === 'admin';

      const payload = requireObjectInput(input, 'بيانات تعديل المصروف');

      const adminPassword = optionalStringValue(
        payload.admin_password,
        'كلمة مرور المدير',
        256,
      );

      const paymentMethod = optionalEnumValue(
        payload.payment_method,
        EXPENSE_PAYMENT_METHODS,
        'طريقة دفع المصروف',
      );

      assertExpenseAccountAccess(user.role, paymentMethod);

      const approval = isAdmin
        ? requireAdminPassword(user.id, adminPassword)
        : null;

      return updateExpense({
        id: requirePositiveInteger(payload.id, 'رقم المصروف'),

        approved_by: approval?.id ?? null,

        title: requireTrimmedString(payload.title, 'عنوان المصروف', 500),

        category: optionalTrimmedString(payload.category, 'تصنيف المصروف', 500),

        amount: requirePositiveMoney(payload.amount, 'قيمة المصروف'),

        payment_method: paymentMethod,

        notes: optionalTrimmedString(payload.notes, 'ملاحظات المصروف', 2000),

        actor_id: user.id,

        can_manage_all: isAdmin,
      });
    } catch (error) {
      return {
        success: false,

        message: error instanceof Error ? error.message : 'تعذر تعديل المصروف',
      };
    }
  });

  ipcMain.handle('expenses:cancel', (event, input) => {
    try {
      const user = requirePermission(event, 'expenses.manage');

      const isAdmin = user.role === 'admin';

      const payload = requireObjectInput(input, 'بيانات إلغاء المصروف');

      const adminPassword = optionalStringValue(
        payload.admin_password,
        'كلمة مرور المدير',
        256,
      );

      const approval = isAdmin
        ? requireAdminPassword(user.id, adminPassword)
        : null;

      return cancelExpense({
        id: requirePositiveInteger(payload.id, 'رقم المصروف'),

        reason: optionalTrimmedString(payload.reason, 'سبب إلغاء المصروف', 500),

        approved_by: approval?.id ?? null,

        actor_id: user.id,

        can_manage_all: isAdmin,
      });
    } catch (error) {
      return {
        success: false,

        message: error instanceof Error ? error.message : 'تعذر إلغاء المصروف',
      };
    }
  });
}
