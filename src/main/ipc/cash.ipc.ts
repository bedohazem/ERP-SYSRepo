import { ipcMain } from 'electron'

import {
  createCashMovement,
  createCashTransfer,
  getCashSummary,
  cancelCashMovement,
  updateCashMovement,
  getCashMovementMutationContext,
  listCashMovements,
} from '../database/repositories/cash.repo'
import {
  closeCashShift,
  getCashShiftExpectedBalance,
  getOpenCashShift,
  openCashShift,
  getCashShiftOpeningPreview,
  getCashShiftById,
  resolveFinancialOperationShift,
  getCashShiftDaySummary,
  listCashShiftVariances,
  listCashShifts,
  getCashShiftDetails,
  resolveCashShiftVariance,
  getCashShiftVarianceReview,
  addCashShiftVarianceCorrection,
  cancelCashShiftVarianceCorrection,
} from '../database/repositories/cash-shifts.repo'
import { requireAdmin, requireAdminPassword } from './permission-helper'
import {
  requireAuthenticatedAdmin,
  requireAuthenticatedUser,
} from '../auth-session'

function getCashierShiftView(shift: any) {
  if (!shift) {
    return null
  }

  return {
    id: Number(shift.id),

    status: shift.status,

    opened_by: Number(shift.opened_by),

    opened_by_name: shift.opened_by_name ?? null,

    opened_at: shift.opened_at,

    closed_at: shift.closed_at ?? null,
  }
}

export function registerCashIpc(): void {
  ipcMain.handle('cash:summary', (event, input) => {
    const user = requireAuthenticatedUser(event)

    return getCashSummary({
      ...(input || {}),

      created_by: user.role === 'admin' ? input?.created_by : user.id,
    })
  })

  ipcMain.handle('cash:transfer', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const openShift = resolveFinancialOperationShift(
      actorId,
      [input?.from_account, input?.to_account],
      'لا يمكن تنفيذ تحويل يؤثر على درج المحل بدون شفت مفتوح',
    )

    return createCashTransfer({
      ...input,
      created_by: actorId,
      shift_id: openShift?.id ?? null,
    })
  })

  ipcMain.handle('cash:list', (event, input) => {
    requireAuthenticatedAdmin(event)

    return listCashMovements(input)
  })
  ipcMain.handle('cash:create-movement', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const type =
      input?.type === 'deposit'
        ? 'deposit'
        : input?.type === 'withdraw'
          ? 'withdraw'
          : null

    if (!type) {
      throw new Error('نوع حركة الخزنة اليدوية غير صحيح')
    }

    const direction: 'in' | 'out' = type === 'deposit' ? 'in' : 'out'

    const paymentMethod = input?.payment_method || 'store_cash'

    const openShift = resolveFinancialOperationShift(
      actorId,
      [paymentMethod],
      'لا يمكن تسجيل حركة على درج المحل بدون شفت مفتوح',
    )

    return createCashMovement({
      type,
      direction,
      amount: Number(input?.amount),
      payment_method: paymentMethod,
      reference_id: null,
      reference_type: 'manual',
      notes: input?.notes,
      created_by: actorId,
      shift_id: openShift?.id ?? null,
    })
  })

  ipcMain.handle('cash:update-movement', (event, input) => {
    try {
      const actorId = requireAuthenticatedUser(event).id

      requireAdminPassword(actorId, input?.admin_password)

      const movementId = Number(input?.id)

      const mutationContext = getCashMovementMutationContext(movementId)

      const requestedAccounts: string[] = []

      if (mutationContext.kind === 'manual') {
        if (input?.payment_method) {
          requestedAccounts.push(String(input.payment_method))
        }
      } else {
        if (input?.from_account) {
          requestedAccounts.push(String(input.from_account))
        }

        if (input?.to_account) {
          requestedAccounts.push(String(input.to_account))
        }
      }

      const openShift = resolveFinancialOperationShift(
        actorId,
        [...mutationContext.accounts, ...requestedAccounts],
        'لا يمكن تعديل حركة تؤثر على درج المحل بدون شفت مفتوح',
      )

      return updateCashMovement({
        id: movementId,

        type: input?.type,

        amount: Number(input?.amount),

        payment_method: input?.payment_method,

        from_account: input?.from_account,

        to_account: input?.to_account,

        notes: input?.notes,

        actor_id: actorId,

        shift_id: openShift?.id ?? null,
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

      const movementId = Number(input?.id)

      const mutationContext = getCashMovementMutationContext(movementId)

      const openShift = resolveFinancialOperationShift(
        actorId,
        mutationContext.accounts,
        'لا يمكن إلغاء حركة تؤثر على درج المحل بدون شفت مفتوح',
      )

      return cancelCashMovement({
        id: movementId,

        reason: input?.reason,

        actor_id: actorId,

        shift_id: openShift?.id ?? null,
      })
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر إلغاء حركة الخزنة',
      }
    }
  })

  ipcMain.handle('cash-shifts:day-summary', (event, input) => {
    requireAuthenticatedAdmin(event)

    return getCashShiftDaySummary({
      business_date: String(input?.business_date || ''),

      user_id: input?.user_id ?? null,
    })
  })

  ipcMain.handle('cash-shifts:list', (event, input) => {
    const actor = requireAuthenticatedUser(event)

    requireAdmin(actor.id)

    return listCashShifts({
      status: input?.status || 'all',

      user_id: input?.user_id ?? null,

      date_from: input?.date_from,

      date_to: input?.date_to,

      limit: Number(input?.limit || 50),

      offset: Number(input?.offset || 0),
    })
  })

  ipcMain.handle('cash-shifts:details', (event, shiftId) => {
    const actor = requireAuthenticatedUser(event)

    requireAdmin(actor.id)

    return getCashShiftDetails(Number(shiftId))
  })

  ipcMain.handle('cash-shifts:list-variances', (event, input) => {
    const actor = requireAuthenticatedUser(event)

    requireAdmin(actor.id)

    return listCashShiftVariances({
      status: input?.status || 'pending',

      user_id: input?.user_id ?? null,

      date_from: input?.date_from,

      date_to: input?.date_to,

      limit: Number(input?.limit || 50),

      offset: Number(input?.offset || 0),
    })
  })

  ipcMain.handle('cash-shifts:variance-review', (event, varianceId) => {
    const actor = requireAuthenticatedUser(event)

    requireAdmin(actor.id)

    return getCashShiftVarianceReview(Number(varianceId))
  })

  ipcMain.handle('cash-shifts:add-variance-correction', (event, input) => {
    try {
      const actor = requireAuthenticatedUser(event)

      requireAdminPassword(actor.id, input?.admin_password)

      const review = addCashShiftVarianceCorrection({
        variance_id: Number(input?.variance_id),

        reason_code: input?.reason_code,

        amount: Number(input?.amount),

        notes: input?.notes,

        created_by: actor.id,
      })

      return {
        success: true,
        review,
      }
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر إضافة تصحيح فرق الشفت',
      }
    }
  })

  ipcMain.handle('cash-shifts:cancel-variance-correction', (event, input) => {
    try {
      const actor = requireAuthenticatedUser(event)

      requireAdminPassword(actor.id, input?.admin_password)

      const review = cancelCashShiftVarianceCorrection({
        correction_id: Number(input?.correction_id),

        reason: String(input?.reason || ''),

        cancelled_by: actor.id,
      })

      return {
        success: true,
        review,
      }
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر إلغاء تصحيح فرق الشفت',
      }
    }
  })

  ipcMain.handle('cash-shifts:resolve-variance', (event, input) => {
    try {
      const actor = requireAuthenticatedUser(event)

      requireAdminPassword(actor.id, input?.admin_password)

      const variance = resolveCashShiftVariance({
        variance_id: Number(input?.variance_id),

        resolution_type: input?.resolution_type,

        resolution_notes: String(input?.resolution_notes || ''),

        resolved_by: actor.id,
      })

      return {
        success: true,
        variance,
      }
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر مراجعة فرق الشفت',
      }
    }
  })

  ipcMain.handle('cash-shifts:get-open', (event) => {
    const actor = requireAuthenticatedUser(event)

    const shift = getOpenCashShift()

    if (actor.role === 'admin') {
      return shift
    }

    return getCashierShiftView(shift)
  })

  ipcMain.handle('cash-shifts:opening-preview', (event) => {
    const actor = requireAuthenticatedUser(event)

    const preview = getCashShiftOpeningPreview()

    if (actor.role === 'admin') {
      return preview
    }

    return {
      can_open: preview.can_open,

      open_shift: getCashierShiftView(preview.open_shift),

      /*
       * Blind count:
       * الكاشير لا يعرف تسليم
       * الشفت السابق قبل العد.
       */
      previous_shift_id: null,

      expected_opening_amount: null,

      previous_closed_at: null,
    }
  })

  ipcMain.handle('cash-shifts:open', (event, input) => {
    const actor = requireAuthenticatedUser(event)

    const shift = openCashShift({
      opening_counted_amount: Number(input?.opening_counted_amount),

      opened_by: actor.id,
    })

    if (actor.role === 'admin') {
      return shift
    }

    return getCashierShiftView(shift)
  })

  ipcMain.handle('cash-shifts:preview', (event, shiftId) => {
    requireAuthenticatedAdmin(event)

    const shift = getCashShiftById(Number(shiftId))

    if (!shift) {
      throw new Error('الشفت غير موجود')
    }

    return getCashShiftExpectedBalance(shift.id)
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

    const closedShift = closeCashShift({
      shift_id: shiftId,

      closing_counted_amount: Number(input?.closing_counted_amount),

      left_for_next_shift: Number(input?.left_for_next_shift),

      close_reason: input?.close_reason,

      closed_by: actor.id,
    })

    if (actor.role === 'admin') {
      return closedShift
    }

    return getCashierShiftView(closedShift)
  })
}
