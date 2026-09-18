import { ipcMain } from 'electron'
import {
  cancelLiability,
  createLiability,
  getLiabilitiesSummary,
  getLiabilityStatement,
  listLiabilities,
  listLiabilitiesPage,
  cancelLiabilityPayment,
  recordLiabilityPayment,
  updateLiability,
  updateLiabilityPayment,
} from '../database/repositories/liabilities.repo'
import { requireAuthenticatedAdmin } from '../auth-session'
import { requireAdminPassword } from './permission-helper'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع'
}

export function registerLiabilitiesIpc(): void {
  ipcMain.handle('liabilities:list', (event, input) => {
    requireAuthenticatedAdmin(event)

    return listLiabilities(input)
  })

  ipcMain.handle('liabilities:list-page', (event, input) => {
    requireAuthenticatedAdmin(event)

    return listLiabilitiesPage(input)
  })

  ipcMain.handle('liabilities:create', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)

      return createLiability({
        ...input,
        actor_id: actorId,
      })
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('liabilities:update', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)
      requireAdminPassword(actorId, input?.admin_password)

      return updateLiability({
        id: Number(input?.id),

        party_name: input?.party_name,

        title: input?.title,

        category: input?.category,

        total_amount: Number(input?.total_amount),

        due_date: input?.due_date,

        notes: input?.notes,

        actor_id: actorId,
      })
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('liabilities:record-payment', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)

      return recordLiabilityPayment({
        ...input,
        actor_id: actorId,
      })
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('liabilities:statement', (event, liabilityId: number) => {
    requireAuthenticatedAdmin(event)

    return getLiabilityStatement(liabilityId)
  })

  ipcMain.handle('liabilities:cancel', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)
      return cancelLiability({
        ...input,
        actor_id: actorId,
      })
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('liabilities:summary', (event, input) => {
    requireAuthenticatedAdmin(event)

    return getLiabilitiesSummary(input)
  })

  ipcMain.handle('liabilities:cancel-payment', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)
      requireAdminPassword(actorId, input?.admin_password)

      return cancelLiabilityPayment({
        payment_id: Number(input?.payment_id),
        reason: input?.reason,
        actor_id: actorId,
      })
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('liabilities:update-payment', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)
      requireAdminPassword(actorId, input?.admin_password)

      return updateLiabilityPayment({
        payment_id: Number(input?.payment_id),

        amount: Number(input?.amount),

        payment_method: input?.payment_method,

        notes: input?.notes,

        actor_id: actorId,
      })
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      }
    }
  })
}
