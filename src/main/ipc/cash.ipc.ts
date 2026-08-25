import { ipcMain } from 'electron'

import {
  closeCashDay,
  createCashMovement,
  createCashTransfer,
  getCashDayClosePreview,
  getCashSummary,
  cancelCashMovement,
  listCashMovements,
} from '../database/repositories/cash.repo'
import { requireAdminPassword } from './permission-helper'

export function registerCashIpc(): void {
  ipcMain.handle('cash:summary', (_, input) => {
    return getCashSummary(input)
  })

  ipcMain.handle('cash:transfer', (_, input) => {
    return createCashTransfer(input)
  })

  ipcMain.handle('cash:list', (_, input) => {
    return listCashMovements(input)
  })

  ipcMain.handle('cash:create-movement', (_, input) => {
    return createCashMovement(input)
  })

  ipcMain.handle('cash:day-close-preview', (_, businessDate: string) => {
    return getCashDayClosePreview(businessDate)
  })

  ipcMain.handle('cash:close-day', (_, input) => {
    return closeCashDay(input)
  })

  ipcMain.handle('cash:cancel-movement', (_, input) => {
    try {
      requireAdminPassword(input?.actor_id, input?.admin_password)

      return cancelCashMovement({
        id: Number(input?.id),
        reason: input?.reason,
        actor_id: input?.actor_id ?? null,
      })
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'تعذر إلغاء حركة الخزنة',
      }
    }
  })
}
