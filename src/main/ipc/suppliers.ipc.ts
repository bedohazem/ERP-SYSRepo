import { ipcMain } from 'electron'
import { logAction } from './activity-helper'
import {
  createSupplier,
  deleteSupplier,
  getSupplierById,
  getSuppliers,
  listSuppliers,
  updateSupplier,
} from '../database/repositories/suppliers.repo'
import { requirePermission } from '../auth-session'

export function registerSuppliersIpc(): void {
  ipcMain.handle('suppliers:list', (event, search?: string) => {
    requirePermission(event, 'suppliers.manage')

    return getSuppliers(search ?? '')
  })

  ipcMain.handle('suppliers:list-page', (event, input) => {
    requirePermission(event, 'suppliers.manage')

    return listSuppliers(input)
  })

  ipcMain.handle('suppliers:get-by-id', (event, id: number) => {
    requirePermission(event, 'suppliers.manage')

    return getSupplierById(Number(id))
  })

  ipcMain.handle('suppliers:create', (event, input) => {
    const actorId = requirePermission(event, 'suppliers.manage').id

    const supplier = createSupplier(input)

    logAction({
      actor_id: actorId,
      action: 'supplier_created',
      entity: 'suppliers',
      entity_id: (supplier as any)?.id ?? null,
      details: {
        name: input.name,
        phone: input.phone,
      },
    })

    return supplier
  })

  ipcMain.handle('suppliers:update', (event, input) => {
    const actorId = requirePermission(event, 'suppliers.manage').id
    const supplier = updateSupplier(input)

    logAction({
      actor_id: actorId,
      action: 'supplier_updated',
      entity: 'suppliers',
      entity_id: input.id,
      details: {
        name: input.name,
        phone: input.phone,
      },
    })

    return supplier
  })

  ipcMain.handle('suppliers:delete', (event, id: number) => {
    const actorId = requirePermission(event, 'suppliers.manage').id

    const supplier = getSupplierById(Number(id)) as any

    const result = deleteSupplier(Number(id))

    logAction({
      actor_id: actorId,
      action: 'supplier_deactivated',
      entity: 'suppliers',
      entity_id: Number(id),
      details: {
        name: supplier?.name || '',
        phone: supplier?.phone || '',
        balance: Number(supplier?.balance || 0),
      },
    })

    return result
  })
}
