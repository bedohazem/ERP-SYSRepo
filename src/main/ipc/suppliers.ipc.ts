import { ipcMain } from 'electron';
import { getActorId, logAction } from './activity-helper';
import {
  createSupplier,
  deleteSupplier,
  getSupplierById,
  getSuppliers,
  updateSupplier
} from '../database/repositories/suppliers.repo';

export function registerSuppliersIpc(): void {
  ipcMain.handle('suppliers:list', (_, search?: string) => {
    return getSuppliers(search ?? '');
  });

  ipcMain.handle('suppliers:get-by-id', (_, id: number) => {
    return getSupplierById(Number(id));
  });

  ipcMain.handle('suppliers:create', (_, input) => {
    const supplier = createSupplier(input);

    logAction({
      actor_id: getActorId(input),
      action: 'supplier_created',
      entity: 'suppliers',
      entity_id: (supplier as any)?.id ?? null,
      details: {
        name: input.name,
        phone: input.phone
      }
    });

    return supplier;
  });

  ipcMain.handle('suppliers:update', (_, input) => {
    const supplier = updateSupplier(input);

    logAction({
      actor_id: getActorId(input),
      action: 'supplier_updated',
      entity: 'suppliers',
      entity_id: input.id,
      details: {
        name: input.name,
        phone: input.phone
      }
    });

    return supplier;
  });

  ipcMain.handle('suppliers:delete', (_, id: number, actorId?: number) => {
    const result = deleteSupplier(id);

    logAction({
      actor_id: actorId ?? null,
      action: 'supplier_deactivated',
      entity: 'suppliers',
      entity_id: id,
      details: {}
    });

    return result;
  });
}