import { ipcMain } from 'electron';

import {
  createCashMovement,
  createCashTransfer,
  getCashSummary,
  cancelCashMovement,
  updateCashMovement,
  getCashMovementMutationContext,
  listCashMovements,
} from '../database/repositories/cash.repo';
import {
  closeCashShift,
  getCashShiftExpectedBalance,
  getOpenCashShift,
  openCashShift,
  getCashShiftOpeningPreview,
  getCashShiftById,
  resolveFinancialOperationShift,
  getCashShiftDaySummary,
  listCashShiftVariances,
  listCashShifts,
  getCashShiftDetails,
  resolveCashShiftVariance,
  forceCloseCashShift,
} from '../database/repositories/cash-shifts.repo';
import {
  requireAdminApprovalForActor,
  requireAdminPassword,
} from './permission-helper';
import {
  optionalEnumValue,
  optionalBooleanValue,
  optionalNonNegativeNumber,
  optionalStringValue,
  optionalTrimmedString,
  requireEnumValue,
  requireNonNegativeNumber,
  requireObjectInput,
  requirePositiveInteger,
  requirePositiveNumber,
  requireTrimmedString,
  optionalNonNegativeMoney,
  requireNonNegativeMoney,
  requirePositiveMoney,
  optionalDateOnly,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  requireArrayInput,
} from './input-validation';
import {
  requireAuthenticatedAdmin,
  requireAuthenticatedUser,
  requirePermission,
} from '../auth-session';
import {
  listUsers,
  userHasPermission,
} from '../database/repositories/user.repo';
import { resolveFinancialBusinessDate } from '../database/financial-business-date';

const CASH_ACCOUNT_INPUT_VALUES = [
  'store_cash',
  'store_safe',
  'owner_cash',
  'owner_bank',
  'owner_vodafone',
  'fawry_machine',

  /*
   * Legacy aliases التي ما زال
   * النظام يدعمها.
   */
  'cash',
  'card',
  'wallet',
  'bank',
  'bank_transfer',
] as const;

const CASH_MOVEMENT_TYPES = ['deposit', 'withdraw'] as const;

const SHIFT_VARIANCE_RESOLUTION_TYPES = [
  'approved',
  'rejected',
  'corrected',
  'explained',
  'other',
] as const;

const CASH_FILTER_TYPES = [
  'all',

  'sale',
  'sale_return',
  'sale_exchange',
  'purchase_return',

  'customer_payment',
  'supplier_payment',
  'liability_payment',

  'expense',

  'withdraw',
  'deposit',
  'transfer',

  'shift_adjustment',
] as const;

const CASH_FILTER_DIRECTIONS = ['all', 'in', 'out'] as const;

const CASH_FILTER_ACCOUNTS = ['all', ...CASH_ACCOUNT_INPUT_VALUES] as const;

const CASH_SHIFT_STATUSES = ['all', 'open', 'closed'] as const;

const CASH_SHIFT_VARIANCE_STATUSES = ['all', 'pending', 'resolved'] as const;

function optionalEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requireArrayInput(value, label, 50).map((item) =>
    requireEnumValue(item, allowed, label),
  );
}

function normalizeCashFilterInput(input: unknown) {
  const payload = requireObjectInput(input ?? {}, 'فلتر حركات الخزنة');

  return {
    date_from:
      optionalDateOnly(payload.date_from, 'تاريخ البداية') ?? undefined,

    date_to: optionalDateOnly(payload.date_to, 'تاريخ النهاية') ?? undefined,

    type: optionalEnumValue(payload.type, CASH_FILTER_TYPES, 'نوع حركة الخزنة'),

    types: optionalEnumArray(
      payload.types,
      CASH_FILTER_TYPES,
      'أنواع حركات الخزنة',
    ),

    direction: optionalEnumValue(
      payload.direction,
      CASH_FILTER_DIRECTIONS,
      'اتجاه حركة الخزنة',
    ),

    directions: optionalEnumArray(
      payload.directions,
      CASH_FILTER_DIRECTIONS,
      'اتجاهات حركات الخزنة',
    ),

    payment_method: optionalEnumValue(
      payload.payment_method,
      CASH_FILTER_ACCOUNTS,
      'حساب حركة الخزنة',
    ),

    payment_methods: optionalEnumArray(
      payload.payment_methods,
      CASH_FILTER_ACCOUNTS,
      'حسابات حركات الخزنة',
    ),

    exclude_payment_methods: optionalEnumArray(
      payload.exclude_payment_methods,
      CASH_ACCOUNT_INPUT_VALUES,
      'الحسابات المستبعدة',
    ),

    search:
      optionalTrimmedString(payload.search, 'بحث حركات الخزنة', 500) ??
      undefined,

    include_corrected:
      optionalBooleanValue(
        payload.include_corrected,
        'إظهار الحركات المصححة',
      ) ?? false,

    reference_type:
      optionalTrimmedString(payload.reference_type, 'نوع المرجع', 200) ??
      undefined,

    created_by: optionalPositiveInteger(payload.created_by, 'رقم المستخدم'),

    shift_id: optionalPositiveInteger(payload.shift_id, 'رقم الشفت'),

    limit: optionalPositiveInteger(payload.limit, 'عدد النتائج') ?? undefined,

    offset:
      optionalNonNegativeInteger(payload.offset, 'بداية النتائج') ?? undefined,
  };
}

function getCashierShiftView(shift: any) {
  if (!shift) {
    return null;
  }

  return {
    id: Number(shift.id),

    status: shift.status,

    opened_by: Number(shift.opened_by),

    opened_by_name: shift.opened_by_name ?? null,

    opened_at: shift.opened_at,

    closed_at: shift.closed_at ?? null,
  };
}

export function registerCashIpc(): void {
  ipcMain.handle('cash:summary', (event, input) => {
    const user = requireAuthenticatedUser(event);

    const filter = normalizeCashFilterInput(input);

    const canManageCash =
      user.role === 'admin' || userHasPermission(user.id, 'cash.manage');

    return getCashSummary({
      ...filter,

      exclude_payment_methods:
        user.role === 'admin' ? filter.exclude_payment_methods : ['store_safe'],

      created_by: canManageCash ? filter.created_by : user.id,
    });
  });

  ipcMain.handle('cash:transfer', (event, input) => {
    const actorId = requirePermission(event, 'cash.manage').id;

    const payload = requireObjectInput(input, 'بيانات التحويل');

    const fromAccount = requireEnumValue(
      payload.from_account,
      CASH_ACCOUNT_INPUT_VALUES,
      'حساب التحويل المصدر',
    );

    const toAccount = requireEnumValue(
      payload.to_account,
      CASH_ACCOUNT_INPUT_VALUES,
      'حساب التحويل المستلم',
    );

    const amount = requirePositiveMoney(payload.amount, 'مبلغ التحويل');

    const notes = optionalTrimmedString(payload.notes, 'ملاحظات التحويل');

    const openShift = resolveFinancialOperationShift(
      actorId,
      [fromAccount, toAccount],
      'لا يمكن تنفيذ تحويل يؤثر على درج المحل بدون شفت مفتوح',
    );

    const businessDate = resolveFinancialBusinessDate(openShift?.id ?? null);

    return createCashTransfer({
      from_account: fromAccount,
      to_account: toAccount,
      amount,
      notes,
      created_by: actorId,
      business_date: businessDate,
      shift_id: openShift?.id ?? null,
    });
  });

  ipcMain.handle('cash:list', (event, input) => {
    const actor = requirePermission(event, 'cash.manage');

    const filter = normalizeCashFilterInput(input);

    return listCashMovements({
      ...filter,

      exclude_payment_methods:
        actor.role === 'admin'
          ? filter.exclude_payment_methods
          : ['store_safe'],
    });
  });
  ipcMain.handle('cash:create-movement', (event, input) => {
    const actorId = requirePermission(event, 'cash.manage').id;

    const payload = requireObjectInput(input, 'بيانات حركة الخزنة');

    const type = requireEnumValue(
      payload.type,
      CASH_MOVEMENT_TYPES,
      'نوع حركة الخزنة اليدوية',
    );

    const direction: 'in' | 'out' = type === 'deposit' ? 'in' : 'out';

    const rawPaymentMethod =
      payload.payment_method === undefined ||
      payload.payment_method === null ||
      payload.payment_method === ''
        ? 'store_cash'
        : payload.payment_method;

    const paymentMethod = requireEnumValue(
      rawPaymentMethod,
      CASH_ACCOUNT_INPUT_VALUES,
      'حساب حركة الخزنة',
    );

    const amount = requirePositiveMoney(payload.amount, 'مبلغ حركة الخزنة');

    const notes = optionalTrimmedString(payload.notes, 'ملاحظات حركة الخزنة');

    const openShift = resolveFinancialOperationShift(
      actorId,
      [paymentMethod],
      'لا يمكن تسجيل حركة على درج المحل بدون شفت مفتوح',
    );

    const businessDate = resolveFinancialBusinessDate(openShift?.id ?? null);

    return createCashMovement({
      type,
      direction,
      amount,
      payment_method: paymentMethod,
      reference_id: null,
      reference_type: 'manual',
      notes,
      created_by: actorId,
      business_date: businessDate,
      shift_id: openShift?.id ?? null,
    });
  });

  ipcMain.handle('cash:update-movement', (event, input) => {
    try {
      const actorId = requireAuthenticatedUser(event).id;

      const payload = requireObjectInput(input, 'بيانات تعديل حركة الخزنة');

      const adminPassword = optionalStringValue(
        payload.admin_password,
        'كلمة مرور المدير',
        256,
      );

      const approval = requireAdminPassword(actorId, adminPassword);

      const movementId = requirePositiveInteger(payload.id, 'رقم حركة الخزنة');

      const amount = requirePositiveMoney(payload.amount, 'مبلغ حركة الخزنة');

      const type = optionalEnumValue(
        payload.type,
        CASH_MOVEMENT_TYPES,
        'نوع حركة الخزنة',
      );

      const paymentMethod = optionalEnumValue(
        payload.payment_method,
        CASH_ACCOUNT_INPUT_VALUES,
        'حساب حركة الخزنة',
      );

      const fromAccount = optionalEnumValue(
        payload.from_account,
        CASH_ACCOUNT_INPUT_VALUES,
        'حساب التحويل المصدر',
      );

      const toAccount = optionalEnumValue(
        payload.to_account,
        CASH_ACCOUNT_INPUT_VALUES,
        'حساب التحويل المستلم',
      );

      const notes = optionalTrimmedString(payload.notes, 'ملاحظات حركة الخزنة');

      const mutationContext = getCashMovementMutationContext(movementId);

      const requestedAccounts: string[] = [];

      if (mutationContext.kind === 'manual') {
        if (paymentMethod) {
          requestedAccounts.push(paymentMethod);
        }
      } else {
        if (fromAccount) {
          requestedAccounts.push(fromAccount);
        }

        if (toAccount) {
          requestedAccounts.push(toAccount);
        }
      }

      const openShift = resolveFinancialOperationShift(
        actorId,
        [...mutationContext.accounts, ...requestedAccounts],
        'لا يمكن تعديل حركة تؤثر على درج المحل بدون شفت مفتوح',
      );

      const businessDate = resolveFinancialBusinessDate(openShift?.id ?? null);
      return updateCashMovement({
        id: movementId,

        type,

        approved_by: approval.id,

        amount,

        payment_method: paymentMethod,

        from_account: fromAccount,

        to_account: toAccount,

        notes,

        actor_id: actorId,
        business_date: businessDate,
        shift_id: openShift?.id ?? null,
      });
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر تعديل حركة الخزنة',
      };
    }
  });

  ipcMain.handle('cash:cancel-movement', (event, input) => {
    try {
      const actorId = requireAuthenticatedUser(event).id;

      const payload = requireObjectInput(input, 'بيانات إلغاء حركة الخزنة');

      const adminPassword = optionalStringValue(
        payload.admin_password,
        'كلمة مرور المدير',
        256,
      );

      const approval = requireAdminPassword(actorId, adminPassword);

      const movementId = requirePositiveInteger(payload.id, 'رقم حركة الخزنة');

      const reason = optionalTrimmedString(
        payload.reason,
        'سبب إلغاء حركة الخزنة',
        500,
      );

      const mutationContext = getCashMovementMutationContext(movementId);

      const openShift = resolveFinancialOperationShift(
        actorId,
        mutationContext.accounts,
        'لا يمكن إلغاء حركة تؤثر على درج المحل بدون شفت مفتوح',
      );

      const businessDate = resolveFinancialBusinessDate(openShift?.id ?? null);

      return cancelCashMovement({
        id: movementId,

        reason,

        approved_by: approval.id,

        actor_id: actorId,
        business_date: businessDate,
        shift_id: openShift?.id ?? null,
      });
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر إلغاء حركة الخزنة',
      };
    }
  });

  ipcMain.handle('cash-shifts:day-summary', (event, input) => {
    requirePermission(event, 'shifts.manage');

    const payload = requireObjectInput(input, 'فلتر ملخص الشفتات');

    const businessDate = optionalDateOnly(
      payload.business_date,
      'تاريخ ملخص الشفتات',
    );

    if (!businessDate) {
      throw new Error('تاريخ ملخص الشفتات غير صحيح');
    }

    return getCashShiftDaySummary({
      business_date: businessDate,

      user_id: optionalPositiveInteger(payload.user_id, 'رقم المستخدم') ?? null,
    });
  });

  ipcMain.handle('cash-shifts:list', (event, input) => {
    requirePermission(event, 'shifts.manage');

    const payload = requireObjectInput(input ?? {}, 'فلتر الشفتات');

    return listCashShifts({
      status:
        optionalEnumValue(payload.status, CASH_SHIFT_STATUSES, 'حالة الشفت') ??
        'all',

      user_id: optionalPositiveInteger(payload.user_id, 'رقم المستخدم') ?? null,

      date_from: optionalDateOnly(payload.date_from, 'تاريخ البداية') ?? null,

      date_to: optionalDateOnly(payload.date_to, 'تاريخ النهاية') ?? null,

      limit: optionalPositiveInteger(payload.limit, 'عدد النتائج') ?? 50,

      offset: optionalNonNegativeInteger(payload.offset, 'بداية النتائج') ?? 0,
    });
  });

  ipcMain.handle('cash-shifts:users', (event) => {
    requirePermission(event, 'shifts.manage');

    return listUsers('').map((user) => ({
      id: Number(user.id),

      name: String(user.name || ''),

      role: String(user.role || ''),
    }));
  });

  ipcMain.handle('cash-shifts:details', (event, shiftId) => {
    requirePermission(event, 'shifts.manage');

    return getCashShiftDetails(requirePositiveInteger(shiftId, 'رقم الشفت'));
  });

  ipcMain.handle('cash-shifts:list-variances', (event, input) => {
    requirePermission(event, 'shifts.manage');

    const payload = requireObjectInput(input ?? {}, 'فلتر فروق الشفتات');

    return listCashShiftVariances({
      status:
        optionalEnumValue(
          payload.status,
          CASH_SHIFT_VARIANCE_STATUSES,
          'حالة فرق الشفت',
        ) ?? 'pending',

      user_id: optionalPositiveInteger(payload.user_id, 'رقم المستخدم') ?? null,

      date_from: optionalDateOnly(payload.date_from, 'تاريخ البداية') ?? null,

      date_to: optionalDateOnly(payload.date_to, 'تاريخ النهاية') ?? null,

      limit: optionalPositiveInteger(payload.limit, 'عدد النتائج') ?? 50,

      offset: optionalNonNegativeInteger(payload.offset, 'بداية النتائج') ?? 0,
    });
  });

  ipcMain.handle('cash-shifts:resolve-variance', (event, input) => {
    try {
      const actor = requireAuthenticatedUser(event);

      const payload = requireObjectInput(input, 'بيانات مراجعة فرق الشفت');

      const adminPassword = optionalStringValue(
        payload.admin_password,
        'كلمة مرور المدير',
        256,
      );

      const approval = requireAdminPassword(actor.id, adminPassword);

      const varianceId = requirePositiveInteger(
        payload.variance_id,
        'رقم فرق الشفت',
      );

      const resolutionType = requireEnumValue(
        payload.resolution_type,
        SHIFT_VARIANCE_RESOLUTION_TYPES,
        'نوع مراجعة فرق الشفت',
      );

      const resolutionNotes = requireTrimmedString(
        payload.resolution_notes,
        'ملاحظات مراجعة فرق الشفت',
        1000,
      );

      const reversalAccount = optionalEnumValue(
        payload.reversal_account,
        CASH_ACCOUNT_INPUT_VALUES,
        'حساب عكس فرق الشفت',
      );

      const correctedOpeningAmount = optionalNonNegativeMoney(
        payload.corrected_opening_amount,
        'الجرد الصحيح عند افتتاح الشفت',
      );

      const variance = resolveCashShiftVariance({
        variance_id: varianceId,

        resolution_type: resolutionType,

        approved_by: approval.id,

        resolution_notes: resolutionNotes,

        reversal_account: reversalAccount ?? null,

        corrected_opening_amount: correctedOpeningAmount ?? null,

        resolved_by: actor.id,
      });

      return {
        success: true,
        variance,
      };
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر مراجعة فرق الشفت',
      };
    }
  });

  ipcMain.handle('cash-shifts:get-open', (event) => {
    const actor = requirePermission(event, 'shifts.operate_own');

    const shift = getOpenCashShift();

    const canManageShifts =
      actor.role === 'admin' || userHasPermission(actor.id, 'shifts.manage');

    if (canManageShifts) {
      return shift;
    }

    return getCashierShiftView(shift);
  });

  ipcMain.handle('cash-shifts:opening-preview', (event) => {
    const actor = requirePermission(event, 'shifts.operate_own');

    const preview = getCashShiftOpeningPreview();

    const canManageShifts =
      actor.role === 'admin' || userHasPermission(actor.id, 'shifts.manage');

    if (canManageShifts) {
      return preview;
    }

    return {
      can_open: preview.can_open,

      open_shift: getCashierShiftView(preview.open_shift),

      /*
       * Blind count:
       * الكاشير لا يرى تسليم
       * الشفت السابق.
       */
      previous_shift_id: preview.previous_shift_id,

      expected_opening_amount: null,

      previous_closed_at: null,

      /*
       * بيانات التاريخ ليست
       * بيانات مالية سرية.
       *
       * نحتاجها حتى يظهر تحذير
       * تغيير التاريخ للكاشير.
       */
      previous_business_date: preview.previous_business_date,

      suggested_business_date: preview.suggested_business_date,

      business_date_gap_days: preview.business_date_gap_days,

      clock_moved_backward: preview.clock_moved_backward,

      requires_date_confirmation: preview.requires_date_confirmation,
    };
  });

  ipcMain.handle('cash-shifts:open', (event, input) => {
    const actor = requirePermission(event, 'shifts.operate_own');

    const payload = requireObjectInput(input, 'بيانات فتح الشفت');

    const openingCountedAmount = requireNonNegativeMoney(
      payload.opening_counted_amount,
      'رصيد افتتاح الشفت',
    );

    const preview = getCashShiftOpeningPreview();

    if (preview.clock_moved_backward) {
      throw new Error(
        `تاريخ الجهاز أقدم من آخر شفت. صحح تاريخ ووقت Windows أولًا.`,
      );
    }

    const adminUsername = optionalStringValue(
      payload.admin_username,
      'اسم مستخدم المدير',
      200,
    );

    const adminPassword = optionalStringValue(
      payload.admin_password,
      'كلمة مرور المدير',
      256,
    );

    let approvedBy: number | null = null;

    if (preview.requires_date_confirmation) {
      const approval = requireAdminApprovalForActor(
        actor,

        adminUsername,

        adminPassword,
      );

      approvedBy = approval.id;
    }

    const shift = openCashShift({
      opening_counted_amount: openingCountedAmount,

      opened_by: actor.id,

      business_date: preview.suggested_business_date,

      approved_by: approvedBy,
    });

    const canManageShifts =
      actor.role === 'admin' || userHasPermission(actor.id, 'shifts.manage');

    if (canManageShifts) {
      return shift;
    }

    return getCashierShiftView(shift);
  });

  ipcMain.handle('cash-shifts:preview', (event, shiftId) => {
    requirePermission(event, 'shifts.manage');

    const safeShiftId = requirePositiveInteger(shiftId, 'رقم الشفت');

    const shift = getCashShiftById(safeShiftId);

    if (!shift) {
      throw new Error('الشفت غير موجود');
    }

    return getCashShiftExpectedBalance(shift.id);
  });

  ipcMain.handle('cash-shifts:close', (event, input) => {
    const actor = requirePermission(event, 'shifts.operate_own');

    const payload = requireObjectInput(input, 'بيانات إغلاق الشفت');

    const shiftId = requirePositiveInteger(payload.shift_id, 'رقم الشفت');

    const closingCountedAmount = requireNonNegativeMoney(
      payload.closing_counted_amount,
      'الجرد الفعلي عند إغلاق الشفت',
    );

    const leftForNextShift = requireNonNegativeMoney(
      payload.left_for_next_shift,
      'المبلغ المتروك للشفت التالي',
    );

    const closeReason = optionalTrimmedString(
      payload.close_reason,
      'سبب إغلاق الشفت',
      500,
    );

    const adminPassword = optionalStringValue(
      payload.admin_password,
      'كلمة مرور المدير',
      256,
    );

    const shift = getCashShiftById(shiftId);

    if (!shift) {
      throw new Error('الشفت غير موجود');
    }

    if (actor.role !== 'admin' && Number(shift.opened_by) !== actor.id) {
      throw new Error('لا يمكنك إغلاق شفت مستخدم آخر');
    }

    const isAdminClosingOtherShift =
      actor.role === 'admin' && Number(shift.opened_by) !== actor.id;

    let approvedBy: number | null = null;

    if (isAdminClosingOtherShift) {
      approvedBy = requireAdminPassword(actor.id, adminPassword).id;
    }

    const closedShift = closeCashShift({
      shift_id: shiftId,

      approved_by: approvedBy,

      closing_counted_amount: closingCountedAmount,

      left_for_next_shift: leftForNextShift,

      close_reason: closeReason,

      closed_by: actor.id,
    });

    const canManageShifts =
      actor.role === 'admin' || userHasPermission(actor.id, 'shifts.manage');

    if (canManageShifts) {
      return closedShift;
    }

    return getCashierShiftView(closedShift);
  });

  ipcMain.handle('cash-shifts:force-close', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event);

    const payload = requireObjectInput(input, 'بيانات الإغلاق الطارئ للشفت');

    const adminPassword = optionalStringValue(
      payload.admin_password,
      'كلمة مرور المدير',
      256,
    );

    const approval = requireAdminPassword(actorId, adminPassword);

    const shiftId = requirePositiveInteger(payload.shift_id, 'رقم الشفت');

    const reason = requireTrimmedString(
      payload.reason,
      'سبب الإغلاق الطارئ',
      500,
    );

    return forceCloseCashShift({
      shift_id: shiftId,

      closed_by: actorId,

      approved_by: approval.id,

      reason,
    });
  });
}
