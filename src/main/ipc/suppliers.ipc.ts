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
import { requireAuthenticatedAdmin } from '../auth-session';

import { createSupplierOpeningBalance } from '../database/repositories/supplier-opening-balances.repo';

import { requireEnumValue, requirePositiveMoney } from './input-validation';
import { requireAnyPermission, requirePermission } from '../auth-session';
import {
  createSupplierAdvancePayment,
  cancelSupplierAdvancePayment,
} from '../database/repositories/supplier-advances.repo';

import { requirePositiveFinancialMoney } from './input-validation';

import { resolveCashAccountKey } from '../../shared/cash-accounts';
import {
  optionalBooleanValue,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalTrimmedString,
  requireObjectInput,
  requirePositiveInteger,
  requireTrimmedString,
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
