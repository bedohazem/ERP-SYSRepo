import { ipcMain } from 'electron'

import {
  closeCashDay,
  createCashMovement,
  createCashTransfer,
  getCashDayClosePreview,
  getCashSummary,
  cancelCashMovement,
  updateCashMovement,
  cancelCashDayClosing,
  updateCashDayClosing,
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

  ipcMain.handle('cash:cancel-day-close', (_, input) => {
    try {
      requireAdminPassword(input?.actor_id, input?.admin_password)

      return cancelCashDayClosing({
        closing_id: Number(input?.closing_id),

        reason: input?.reason,

        actor_id: input?.actor_id ?? null,
      })
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر إلغاء تقفيل اليوم',
      }
    }
  })

  ipcMain.handle('cash:update-day-close', (_, input) => {
    try {
      requireAdminPassword(input?.actor_id, input?.admin_password)

      return updateCashDayClosing({
        closing_id: Number(input?.closing_id),

        carry_over_amount: Number(input?.carry_over_amount),

        target_account: input?.target_account,

        actor_id: input?.actor_id ?? null,
      })
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر تعديل تقفيل اليوم',
      }
    }
  })

  ipcMain.handle('cash:update-movement', (_, input) => {
    try {
      requireAdminPassword(input?.actor_id, input?.admin_password)

      return updateCashMovement({
        id: Number(input?.id),

        type: input?.type,

        amount: Number(input?.amount),

        payment_method: input?.payment_method,

        from_account: input?.from_account,

        to_account: input?.to_account,

        notes: input?.notes,

        actor_id: input?.actor_id ?? null,
      })
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر تعديل حركة الخزنة',
      }
    }
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
