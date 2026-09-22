import { ipcMain } from 'electron'
import { logAction } from './activity-helper'
import { requireAuthenticatedAdmin } from '../auth-session'
import {
  adjustVariantStock,
  getInventoryList,
  getStockMovements,
  listInventoryPage,
} from '../database/repositories/inventory.repo'

export function registerInventoryIpc(): void {
  ipcMain.handle('inventory:list', (event, input) => {
    requireAuthenticatedAdmin(event)

    return getInventoryList(input)
  })

  ipcMain.handle('inventory:list-page', (event, input) => {
    requireAuthenticatedAdmin(event)

    return listInventoryPage(input)
  })

  ipcMain.handle('inventory:adjust-stock', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const result = adjustVariantStock(input)

    if (Number(result.diff || 0) !== 0) {
      logAction({
        actor_id: actorId,
        action: 'inventory_stock_adjusted',
        entity: 'inventory',
        entity_id: Number(result.variant_id),
        details: {
          variant_id: Number(result.variant_id),

          old_stock: Number(result.old_stock),

          new_stock: Number(result.new_stock),

          diff: Number(result.diff),

          notes: input?.notes || '',
        },
      })
    }

    return result
  })

  ipcMain.handle('inventory:movements', (event, input) => {
    requireAuthenticatedAdmin(event)

    return getStockMovements(input)
  })
}
