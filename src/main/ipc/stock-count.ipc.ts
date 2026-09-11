import { ipcMain } from 'electron'
import { logAction } from './activity-helper'
import {
  requireAuthenticatedAdmin,
  requireAuthenticatedUser,
} from '../auth-session'
import {
  approveStockCountSession,
  cancelStockCountSession,
  createStockCountSession,
  getStockCountSession,
  listStockCountSessions,
  scanStockCountBarcode,
  updateStockCountItem,
} from '../database/repositories/stock-count.repo'

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'حدث خطأ غير متوقع'
}

export function registerStockCountIpc(): void {
  ipcMain.handle('stock-count:list', () => {
    return listStockCountSessions()
  })

  ipcMain.handle('stock-count:get', (_, sessionId: number) => {
    return getStockCountSession(Number(sessionId))
  })

  ipcMain.handle('stock-count:create', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)

      const result = createStockCountSession({
        title: input.title,
        notes: input.notes,
        actor_id: actorId,
        categoryId: input.categoryId ?? null,
      })

      logAction({
        actor_id: actorId,
        action: 'stock_count_created',
        entity: 'stock_counts',
        entity_id: result.id,
        details: {
          title: input.title,
          items_count: result.items_count,
          categoryId: input.categoryId ?? null,
        },
      })

      return result
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('stock-count:update-item', (event, input) => {
    try {
      const actorId = requireAuthenticatedUser(event).id

      const result = updateStockCountItem(input)

      logAction({
        actor_id: actorId,
        action: 'stock_count_item_updated',
        entity: 'stock_counts',
        entity_id: Number(input.session_id),
        details: {
          item_id: Number(input.item_id),
          actual_stock: Number(input.actual_stock),
          notes: input.notes || '',
        },
      })

      return result
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('stock-count:scan', (event, input) => {
    try {
      const actorId = requireAuthenticatedUser(event).id

      const result = scanStockCountBarcode(input)

      logAction({
        actor_id: actorId,
        action: 'stock_count_barcode_scanned',
        entity: 'stock_counts',
        entity_id: Number(input.session_id),
        details: {
          item_id: result.item_id,
          barcode: result.barcode,
          product_name: result.product_name,
          actual_stock: result.actual_stock,
          quantity: Number(input.quantity || 1),
        },
      })

      return result
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('stock-count:approve', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)

      const result = approveStockCountSession({
        session_id: input.session_id,
        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,
        action: 'stock_count_approved',
        entity: 'stock_counts',
        entity_id: input.session_id,
        details: result,
      })

      return result
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('stock-count:cancel', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)

      const result = cancelStockCountSession({
        session_id: input.session_id,
        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,
        action: 'stock_count_canceled',
        entity: 'stock_counts',
        entity_id: input.session_id,
        details: {
          session_id: input.session_id,
        },
      })

      return result
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })
}
