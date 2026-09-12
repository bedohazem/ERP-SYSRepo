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
import {
  closeCashShift,
  getCashShiftExpectedBalance,
  getOpenCashShift,
  openCashShift,
  getCashShiftOpeningPreview,
  getCashShiftById,
} from '../database/repositories/cash-shifts.repo'
import { requireAdminPassword } from './permission-helper'
import { requireAuthenticatedUser } from '../auth-session'

export function registerCashIpc(): void {
  ipcMain.handle('cash:summary', (_, input) => {
    return getCashSummary(input)
  })

  ipcMain.handle('cash:transfer', (event, input) => {
    const actorId = requireAuthenticatedUser(event).id

    return createCashTransfer({
      ...input,
      created_by: actorId,
    })
  })

  ipcMain.handle('cash:list', (_, input) => {
    return listCashMovements(input)
  })

  ipcMain.handle('cash:create-movement', (event, input) => {
    const actorId = requireAuthenticatedUser(event).id

    return createCashMovement({
      ...input,
      created_by: actorId,
    })
  })

  ipcMain.handle('cash:day-close-preview', (_, businessDate: string) => {
    return getCashDayClosePreview(businessDate)
  })

  ipcMain.handle('cash:close-day', (event, input) => {
    const actorId = requireAuthenticatedUser(event).id

    return closeCashDay({
      ...input,
      closed_by: actorId,
    })
  })

  ipcMain.handle('cash:cancel-day-close', (event, input) => {
    try {
      const actorId = requireAuthenticatedUser(event).id
      requireAdminPassword(actorId, input?.admin_password)

      return cancelCashDayClosing({
        closing_id: Number(input?.closing_id),

        reason: input?.reason,

        actor_id: actorId,
      })
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر إلغاء تقفيل اليوم',
      }
    }
  })

  ipcMain.handle('cash:update-day-close', (event, input) => {
    try {
      const actorId = requireAuthenticatedUser(event).id
      requireAdminPassword(actorId, input?.admin_password)

      return updateCashDayClosing({
        closing_id: Number(input?.closing_id),

        carry_over_amount: Number(input?.carry_over_amount),

        target_account: input?.target_account,

        actor_id: actorId,
      })
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر تعديل تقفيل اليوم',
      }
    }
  })

  ipcMain.handle('cash:update-movement', (event, input) => {
    try {
      const actorId = requireAuthenticatedUser(event).id
      requireAdminPassword(actorId, input?.admin_password)

      return updateCashMovement({
        id: Number(input?.id),

        type: input?.type,

        amount: Number(input?.amount),

        payment_method: input?.payment_method,

        from_account: input?.from_account,

        to_account: input?.to_account,

        notes: input?.notes,

        actor_id: actorId,
      })
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر تعديل حركة الخزنة',
      }
    }
  })

  ipcMain.handle('cash:cancel-movement', (event, input) => {
    try {
      const actorId = requireAuthenticatedUser(event).id
      requireAdminPassword(actorId, input?.admin_password)

      return cancelCashMovement({
        id: Number(input?.id),
        reason: input?.reason,
        actor_id: actorId,
      })
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'تعذر إلغاء حركة الخزنة',
      }
    }
  })

  ipcMain.handle('cash-shifts:get-open', (event) => {
    requireAuthenticatedUser(event)

    return getOpenCashShift()
  })

  ipcMain.handle('cash-shifts:opening-preview', (event) => {
    requireAuthenticatedUser(event)

    return getCashShiftOpeningPreview()
  })

  ipcMain.handle('cash-shifts:open', (event, input) => {
    const actorId = requireAuthenticatedUser(event).id

    return openCashShift({
      opening_counted_amount: Number(input?.opening_counted_amount),

      opened_by: actorId,
    })
  })

  ipcMain.handle('cash-shifts:preview', (event, shiftId) => {
    requireAuthenticatedUser(event)

    return getCashShiftExpectedBalance(Number(shiftId))
  })

  ipcMain.handle('cash-shifts:close', (event, input) => {
    const actor = requireAuthenticatedUser(event)

    const shiftId = Number(input?.shift_id)

    const shift = getCashShiftById(shiftId)

    if (!shift) {
      throw new Error('الشفت غير موجود')
    }

    const isAdminClosingOtherShift =
      actor.role === 'admin' && Number(shift.opened_by) !== actor.id

    if (isAdminClosingOtherShift) {
      requireAdminPassword(actor.id, input?.admin_password)
    }

    return closeCashShift({
      shift_id: shiftId,

      closing_counted_amount: Number(input?.closing_counted_amount),

      left_for_next_shift: Number(input?.left_for_next_shift),

      close_reason: input?.close_reason,

      closed_by: actor.id,
    })
  })
}
