import { ipcMain } from 'electron';
import { runCriticalActionWithAudit } from './activity-helper';
import {
  createSupplier,
  deleteSupplier,
  getSupplierById,
  getSuppliers,
  listSuppliers,
  updateSupplier,
} from '../database/repositories/suppliers.repo';
import {
  requireAuthenticatedAdmin,
  requireAnyPermission,
  requirePermission,
} from '../auth-session';
import {
  createSupplierOpeningBalance,
  changeSupplierOpeningBalance,
} from '../database/repositories/supplier-opening-balances.repo';
import {
  createSupplierAdvancePayment,
  cancelSupplierAdvancePayment,
  updateSupplierAdvancePayment,
} from '../database/repositories/supplier-advances.repo';
import { resolveCashAccountKey } from '../../shared/cash-accounts';
import {
  optionalBooleanValue,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalTrimmedString,
  requireObjectInput,
  requirePositiveInteger,
  requireTrimmedString,
  requireEnumValue,
  requirePositiveMoney,
  requirePositiveFinancialMoney,
} from './input-validation';
import { roundMoney } from '../../shared/money';

export function registerSuppliersIpc(): void {
  ipcMain.handle('suppliers:create-opening-balance', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event);

    const payload = requireObjectInput(input, 'بيانات الرصيد الافتتاحي');

    const openingInput = {
      supplier_id: requirePositiveInteger(payload.supplier_id, 'رقم المورد'),
      direction: requireEnumValue(
        payload.direction,
        ['payable', 'receivable'] as const,
        'نوع الرصيد الافتتاحي',
      ),
      amount: requirePositiveMoney(payload.amount, 'قيمة الرصيد الافتتاحي'),
      notes: requireTrimmedString(payload.notes, 'سبب الرصيد الافتتاحي', 2000),
      actor_id: actorId,
    };

    return runCriticalActionWithAudit(
      () => createSupplierOpeningBalance(openingInput),
      (result) => ({
        actor_id: actorId,
        action: 'supplier_opening_balance_created',
        entity: 'suppliers',
        entity_id: openingInput.supplier_id,
        details: {
          opening_balance_id: result.id,
          direction: result.direction,
          amount: result.amount,
          balance: result.balance,
          notes: openingInput.notes,
        },
      }),
    );
  });

  ipcMain.handle('suppliers:change-opening-balance', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event);
    const payload = requireObjectInput(input, 'تعديل الرصيد الافتتاحي');

    const mode = requireEnumValue(
      payload.mode,
      ['edit', 'cancel'] as const,
      'نوع العملية',
    );

    const openingInput = {
      opening_id: requirePositiveInteger(
        payload.opening_id,
        'رقم الرصيد الافتتاحي',
      ),
      direction: requireEnumValue(
        payload.direction,
        ['payable', 'receivable'] as const,
        'اتجاه الرصيد الافتتاحي',
      ),
      mode,
      amount:
        mode === 'edit'
          ? requirePositiveFinancialMoney(payload.amount, 'المبلغ الجديد')
          : undefined,
      notes: optionalTrimmedString(
        payload.notes,
        'ملاحظات الرصيد الافتتاحي',
        2000,
      ),
      reason: requireTrimmedString(
        payload.reason,
        'سبب التعديل أو الإلغاء',
        500,
      ),
      actor_id: actorId,
    };

    return runCriticalActionWithAudit(
      () => changeSupplierOpeningBalance(openingInput),
      (result) => ({
        actor_id: actorId,
        action:
          mode === 'edit'
            ? 'supplier_opening_balance_updated'
            : 'supplier_opening_balance_cancelled',
        entity:
          result.direction === 'payable'
            ? 'purchase_invoices'
            : 'supplier_account_credits',
        entity_id: result.opening_id,
        details: {
          ...result,
          reason: openingInput.reason,
          notes: openingInput.notes,
        },
      }),
    );
  });

  ipcMain.handle('suppliers:update-advance', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event);
    const payload = requireObjectInput(input, 'تعديل الدفعة المقدمة');

    const method = requireEnumValue(
      payload.payment_method,
      [
        'store_cash',
        'store_safe',
        'owner_cash',
        'owner_bank',
        'owner_vodafone',
        'fawry_machine',
      ] as const,
      'الحساب المالي',
    );

    const updateInput = {
      advance_id: requirePositiveInteger(
        payload.advance_id,
        'رقم الدفعة المقدمة',
      ),
      amount: requirePositiveFinancialMoney(payload.amount, 'المبلغ الجديد'),
      payment_method: resolveCashAccountKey(method),
      notes: optionalTrimmedString(
        payload.notes,
        'ملاحظات الدفعة المقدمة',
        1000,
      ),
      reason: requireTrimmedString(
        payload.reason,
        'سبب تعديل الدفعة المقدمة',
        500,
      ),
      actor_id: actorId,
    };

    return runCriticalActionWithAudit(
      () => updateSupplierAdvancePayment(updateInput),
      (result) => ({
        actor_id: actorId,
        action: 'supplier_advance_updated',
        entity: 'supplier_account_credits',
        entity_id: result.advance_id,
        details: {
          ...result,
          notes: updateInput.notes,
        },
      }),
    );
  });

  ipcMain.handle('suppliers:list', (event, search?: unknown) => {
    requireAnyPermission(event, ['suppliers.manage', 'purchases.manage']);

    return getSuppliers(
      optionalTrimmedString(search, 'بحث الموردين', 500) ?? '',
    );
  });

  ipcMain.handle('suppliers:list-page', (event, input) => {
    requireAnyPermission(event, ['suppliers.manage', 'purchases.manage']);

    const payload = requireObjectInput(input ?? {}, 'فلتر الموردين');

    return listSuppliers({
      search: optionalTrimmedString(payload.search, 'بحث الموردين', 500) ?? '',

      limit: optionalPositiveInteger(payload.limit, 'عدد النتائج') ?? undefined,

      offset:
        optionalNonNegativeInteger(payload.offset, 'بداية النتائج') ??
        undefined,

      include_summary:
        optionalBooleanValue(payload.include_summary, 'إظهار ملخص الموردين') ??
        false,
    });
  });

  ipcMain.handle('suppliers:get-by-id', (event, id: unknown) => {
    requireAnyPermission(event, ['suppliers.manage', 'purchases.manage']);

    return getSupplierById(requirePositiveInteger(id, 'رقم المورد'));
  });

  ipcMain.handle('suppliers:create', (event, input) => {
    const actorId = requirePermission(event, 'suppliers.manage').id;

    const payload = requireObjectInput(input, 'بيانات المورد');

    const supplierInput = {
      name: requireTrimmedString(payload.name, 'اسم المورد', 500),

      phone: optionalTrimmedString(payload.phone, 'هاتف المورد', 100),

      email: optionalTrimmedString(payload.email, 'بريد المورد', 500),

      address: optionalTrimmedString(payload.address, 'عنوان المورد', 1000),

      notes: optionalTrimmedString(payload.notes, 'ملاحظات المورد', 2000),

      credit_days: optionalNonNegativeInteger(
        payload.credit_days,
        'مدة ائتمان المورد',
      ),
    };

    return runCriticalActionWithAudit(
      () => createSupplier(supplierInput),

      (supplier: any) => ({
        actor_id: actorId,

        action: 'supplier_created',

        entity: 'suppliers',

        entity_id: supplier?.id ?? null,

        details: {
          name: supplierInput.name,

          phone: supplierInput.phone,
        },
      }),
    );
  });

  ipcMain.handle('suppliers:update', (event, input) => {
    const actorId = requirePermission(event, 'suppliers.manage').id;

    const payload = requireObjectInput(input, 'بيانات تعديل المورد');

    const supplierInput = {
      id: requirePositiveInteger(payload.id, 'رقم المورد'),

      name: requireTrimmedString(payload.name, 'اسم المورد', 500),

      phone: optionalTrimmedString(payload.phone, 'هاتف المورد', 100),

      email: optionalTrimmedString(payload.email, 'بريد المورد', 500),

      address: optionalTrimmedString(payload.address, 'عنوان المورد', 1000),

      notes: optionalTrimmedString(payload.notes, 'ملاحظات المورد', 2000),

      credit_days: optionalNonNegativeInteger(
        payload.credit_days,
        'مدة ائتمان المورد',
      ),
    };

    return runCriticalActionWithAudit(
      () => updateSupplier(supplierInput),

      () => ({
        actor_id: actorId,

        action: 'supplier_updated',

        entity: 'suppliers',

        entity_id: supplierInput.id,

        details: {
          name: supplierInput.name,

          phone: supplierInput.phone,
        },
      }),
    );
  });

  ipcMain.handle('suppliers:delete', (event, id: unknown) => {
    const actorId = requirePermission(event, 'suppliers.manage').id;

    const supplierId = requirePositiveInteger(id, 'رقم المورد');

    const supplier = getSupplierById(supplierId) as any;

    return runCriticalActionWithAudit(
      () => deleteSupplier(supplierId),

      () => ({
        actor_id: actorId,

        action: 'supplier_deactivated',

        entity: 'suppliers',

        entity_id: supplierId,

        details: {
          name: supplier?.name || '',

          phone: supplier?.phone || '',

          balance: roundMoney(supplier?.balance),
        },
      }),
    );
  });

  ipcMain.handle('suppliers:create-advance', (event, input) => {
    const actor = requirePermission(event, 'purchases.manage');

    const payload = requireObjectInput(input, 'بيانات الدفعة المقدمة');

    const paymentMethod = String(payload.payment_method ?? 'store_cash');

    const allowedMethods = [
      'store_cash',
      'store_safe',
      'owner_cash',
      'owner_bank',
      'owner_vodafone',
      'fawry_machine',
    ];

    if (!allowedMethods.includes(paymentMethod)) {
      throw new Error('الحساب المالي غير صحيح');
    }

    if (actor.role !== 'admin' && paymentMethod === 'store_safe') {
      throw new Error('الخزنة الآمنة متاحة للمدير فقط');
    }

    const advanceInput = {
      supplier_id: requirePositiveInteger(payload.supplier_id, 'رقم المورد'),
      amount: requirePositiveFinancialMoney(
        payload.amount,
        'مبلغ الدفعة المقدمة',
      ),
      payment_method: resolveCashAccountKey(paymentMethod),
      notes: optionalTrimmedString(
        payload.notes,
        'ملاحظات الدفعة المقدمة',
        1000,
      ),
      actor_id: actor.id,
    };

    return runCriticalActionWithAudit(
      () => createSupplierAdvancePayment(advanceInput),
      (result) => ({
        actor_id: actor.id,
        action: 'supplier_advance_created',
        entity: 'supplier_account_credits',
        entity_id: result.id,
        details: result,
      }),
    );
  });

  ipcMain.handle('suppliers:cancel-advance', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event);
    const payload = requireObjectInput(input, 'بيانات إلغاء الدفعة المقدمة');

    const cancelInput = {
      advance_id: requirePositiveInteger(
        payload.advance_id,
        'رقم الدفعة المقدمة',
      ),
      reason: requireTrimmedString(payload.reason, 'سبب الإلغاء', 500),
      actor_id: actorId,
    };

    return runCriticalActionWithAudit(
      () => cancelSupplierAdvancePayment(cancelInput),
      (result) => ({
        actor_id: actorId,
        action: 'supplier_advance_cancelled',
        entity: 'supplier_account_credits',
        entity_id: cancelInput.advance_id,
        details: {
          ...result,
          reason: cancelInput.reason,
        },
      }),
    );
  });
}
