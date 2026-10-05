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

import { requireAnyPermission, requirePermission } from '../auth-session';

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
}
