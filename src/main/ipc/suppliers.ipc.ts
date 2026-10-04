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

export function registerSuppliersIpc(): void {
  ipcMain.handle('suppliers:list', (event, search?: string) => {
    requireAnyPermission(event, ['suppliers.manage', 'purchases.manage']);

    return getSuppliers(search ?? '');
  });

  ipcMain.handle('suppliers:list-page', (event, input) => {
    requireAnyPermission(event, ['suppliers.manage', 'purchases.manage']);

    return listSuppliers(input);
  });

  ipcMain.handle('suppliers:get-by-id', (event, id: number) => {
    requireAnyPermission(event, ['suppliers.manage', 'purchases.manage']);

    return getSupplierById(Number(id));
  });

  ipcMain.handle('suppliers:create', (event, input) => {
    const actorId = requirePermission(event, 'suppliers.manage').id;

    return runCriticalActionWithAudit(
      () => createSupplier(input),

      (supplier: any) => ({
        actor_id: actorId,

        action: 'supplier_created',

        entity: 'suppliers',

        entity_id: supplier?.id ?? null,

        details: {
          name: input.name,

          phone: input.phone,
        },
      }),
    );
  });

  ipcMain.handle('suppliers:update', (event, input) => {
    const actorId = requirePermission(event, 'suppliers.manage').id;

    return runCriticalActionWithAudit(
      () => updateSupplier(input),

      () => ({
        actor_id: actorId,

        action: 'supplier_updated',

        entity: 'suppliers',

        entity_id: input.id,

        details: {
          name: input.name,

          phone: input.phone,
        },
      }),
    );
  });

  ipcMain.handle('suppliers:delete', (event, id: number) => {
    const actorId = requirePermission(event, 'suppliers.manage').id;

    const supplier = getSupplierById(Number(id)) as any;

    return runCriticalActionWithAudit(
      () => deleteSupplier(Number(id)),

      () => ({
        actor_id: actorId,

        action: 'supplier_deactivated',

        entity: 'suppliers',

        entity_id: Number(id),

        details: {
          name: supplier?.name || '',

          phone: supplier?.phone || '',

          balance: Number(supplier?.balance || 0),
        },
      }),
    );
  });
}
