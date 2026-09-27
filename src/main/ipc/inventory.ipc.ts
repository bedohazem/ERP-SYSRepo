import { ipcMain } from 'electron'
import { logAction } from './activity-helper'
import { requirePermission } from '../auth-session'

import { userHasPermission } from '../database/repositories/user.repo'

import {
  adjustVariantStock,
  getInventoryList,
  getStockMovements,
  listInventoryPage,
} from '../database/repositories/inventory.repo'

const INVENTORY_COST_FIELDS = new Set([
  'buy_price',
  'average_cost',
  'inventory_value',
  'unit_cost',
  'cost_value',
  'total_buy_value',
])

function redactInventoryCosts<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(redactInventoryCosts) as T
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  const result: Record<string, unknown> = {}

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (INVENTORY_COST_FIELDS.has(key)) {
      result[key] = 0

      continue
    }

    result[key] = redactInventoryCosts(child)
  }

  return result as T
}

function protectInventoryCosts<T>(
  actor: {
    id: number
    role: string
  },

  value: T,
): T {
  if (actor.role === 'admin' || userHasPermission(actor.id, 'costs.view')) {
    return value
  }

  return redactInventoryCosts(value)
}

export function registerInventoryIpc(): void {
  ipcMain.handle('inventory:list', (event, input) => {
    const actor = requirePermission(event, 'inventory.view')

    return protectInventoryCosts(actor, getInventoryList(input))
  })

  ipcMain.handle('inventory:list-page', (event, input) => {
    const actor = requirePermission(event, 'inventory.view')

    return protectInventoryCosts(actor, listInventoryPage(input))
  })

  ipcMain.handle('inventory:adjust-stock', (event, input) => {
    const actorId = requirePermission(event, 'inventory.adjust').id

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
    const actor = requirePermission(event, 'inventory.view')

    return protectInventoryCosts(actor, listInventoryPage(input))
  })
}
