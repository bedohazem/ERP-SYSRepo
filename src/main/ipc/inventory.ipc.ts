import { ipcMain } from 'electron'
import { logAction } from './activity-helper'
import { requireAuthenticatedUser } from '../auth-session'
import {
  adjustVariantStock,
  getInventoryList,
  getStockMovements,
  listInventoryPage,
} from '../database/repositories/inventory.repo'

export function registerInventoryIpc(): void {
  ipcMain.handle('inventory:list', (_, input) => {
    return getInventoryList(input)
  })

  ipcMain.handle('inventory:list-page', (_, input) => {
    return listInventoryPage(input)
  })

  ipcMain.handle('inventory:adjust-stock', (event, input) => {
    const actorId = requireAuthenticatedUser(event).id

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

  ipcMain.handle('inventory:movements', (_, input) => {
    return getStockMovements(input)
  })
}
