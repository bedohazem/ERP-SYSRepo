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
  forceCloseCashShift,
} from '../database/repositories/cash-shifts.repo'
import { requireAdminPassword } from './permission-helper'
import {
  requireAuthenticatedAdmin,
  requireAuthenticatedUser,
  requirePermission,
} from '../auth-session'
import {
  listUsers,
  userHasPermission,
} from '../database/repositories/user.repo'

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

    const canManageCash =
      user.role === 'admin' || userHasPermission(user.id, 'cash.manage')

    return getCashSummary({
      ...(input || {}),

      /*
       * store_safe تظل True Admin Only
       * حتى لو المستخدم لديه cash.manage.
       */
      exclude_payment_methods:
        user.role === 'admin' ? input?.exclude_payment_methods : ['store_safe'],

      created_by: canManageCash ? input?.created_by : user.id,
    })
  })

  ipcMain.handle('cash:transfer', (event, input) => {
    const actorId = requirePermission(event, 'cash.manage').id

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
    const actor = requirePermission(event, 'cash.manage')

    return listCashMovements({
      ...(input || {}),

      exclude_payment_methods:
        actor.role === 'admin'
          ? input?.exclude_payment_methods
          : ['store_safe'],
    })
  })

  ipcMain.handle('cash:create-movement', (event, input) => {
    const actorId = requirePermission(event, 'cash.manage').id

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

      const approval = requireAdminPassword(
        actorId,

        input?.admin_password,
      )

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
        approved_by: approval.id,
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

      const approval = requireAdminPassword(
        actorId,

        input?.admin_password,
      )

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
        approved_by: approval.id,
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
    requirePermission(event, 'shifts.manage')

    return getCashShiftDaySummary({
      business_date: String(input?.business_date || ''),

      user_id: input?.user_id ?? null,
    })
  })

  ipcMain.handle('cash-shifts:list', (event, input) => {
    requirePermission(event, 'shifts.manage')

    return listCashShifts({
      status: input?.status || 'all',

      user_id: input?.user_id ?? null,

      date_from: input?.date_from,

      date_to: input?.date_to,

      limit: Number(input?.limit || 50),

      offset: Number(input?.offset || 0),
    })
  })

  ipcMain.handle('cash-shifts:users', (event) => {
    requirePermission(event, 'shifts.manage')

    return listUsers('').map((user) => ({
      id: Number(user.id),

      name: String(user.name || ''),

      role: String(user.role || ''),
    }))
  })

  ipcMain.handle('cash-shifts:details', (event, shiftId) => {
    requirePermission(event, 'shifts.manage')

    return getCashShiftDetails(Number(shiftId))
  })

  ipcMain.handle('cash-shifts:list-variances', (event, input) => {
    requirePermission(event, 'shifts.manage')

    return listCashShiftVariances({
      status: input?.status || 'pending',

      user_id: input?.user_id ?? null,

      date_from: input?.date_from,

      date_to: input?.date_to,

      limit: Number(input?.limit || 50),

      offset: Number(input?.offset || 0),
    })
  })

  ipcMain.handle('cash-shifts:resolve-variance', (event, input) => {
    try {
      const actor = requireAuthenticatedUser(event)

      const approval = requireAdminPassword(
        actor.id,

        input?.admin_password,
      )

      const variance = resolveCashShiftVariance({
        variance_id: Number(input?.variance_id),

        resolution_type: input?.resolution_type,
        approved_by: approval.id,
        resolution_notes: String(input?.resolution_notes || ''),
        reversal_account: input?.reversal_account
          ? String(input.reversal_account)
          : null,

        corrected_opening_amount:
          input?.corrected_opening_amount === null ||
          input?.corrected_opening_amount === undefined
            ? null
            : Number(input.corrected_opening_amount),
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
    const actor = requirePermission(event, 'shifts.operate_own')

    const shift = getOpenCashShift()

    const canManageShifts =
      actor.role === 'admin' || userHasPermission(actor.id, 'shifts.manage')

    if (canManageShifts) {
      return shift
    }

    return getCashierShiftView(shift)
  })

  ipcMain.handle('cash-shifts:opening-preview', (event) => {
    const actor = requirePermission(event, 'shifts.operate_own')

    const preview = getCashShiftOpeningPreview()

    const canManageShifts =
      actor.role === 'admin' || userHasPermission(actor.id, 'shifts.manage')

    if (canManageShifts) {
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
    const actor = requirePermission(event, 'shifts.operate_own')

    const shift = openCashShift({
      opening_counted_amount: Number(input?.opening_counted_amount),

      opened_by: actor.id,
    })

    const canManageShifts =
      actor.role === 'admin' || userHasPermission(actor.id, 'shifts.manage')

    if (canManageShifts) {
      return shift
    }

    return getCashierShiftView(shift)
  })

  ipcMain.handle('cash-shifts:preview', (event, shiftId) => {
    requirePermission(event, 'shifts.manage')

    const shift = getCashShiftById(Number(shiftId))

    if (!shift) {
      throw new Error('الشفت غير موجود')
    }

    return getCashShiftExpectedBalance(shift.id)
  })

  ipcMain.handle('cash-shifts:close', (event, input) => {
    const actor = requirePermission(event, 'shifts.operate_own')

    const shiftId = Number(input?.shift_id)

    const shift = getCashShiftById(shiftId)

    if (!shift) {
      throw new Error('الشفت غير موجود')
    }

    if (actor.role !== 'admin' && Number(shift.opened_by) !== actor.id) {
      throw new Error('لا يمكنك إغلاق شفت مستخدم آخر')
    }

    const isAdminClosingOtherShift =
      actor.role === 'admin' && Number(shift.opened_by) !== actor.id

    let approvedBy: number | null = null

    if (isAdminClosingOtherShift) {
      approvedBy = requireAdminPassword(
        actor.id,

        input?.admin_password,
      ).id
    }

    const closedShift = closeCashShift({
      shift_id: shiftId,
      approved_by: approvedBy,
      closing_counted_amount: Number(input?.closing_counted_amount),

      left_for_next_shift: Number(input?.left_for_next_shift),

      close_reason: input?.close_reason,

      closed_by: actor.id,
    })

    const canManageShifts =
      actor.role === 'admin' || userHasPermission(actor.id, 'shifts.manage')

    if (canManageShifts) {
      return closedShift
    }

    return getCashierShiftView(closedShift)
  })

  ipcMain.handle('cash-shifts:force-close', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const approval = requireAdminPassword(
      actorId,

      input?.admin_password,
    )

    return forceCloseCashShift({
      shift_id: Number(input?.shift_id),

      closed_by: actorId,

      approved_by: approval.id,

      reason: String(input?.reason || ''),
    })
  })
}
