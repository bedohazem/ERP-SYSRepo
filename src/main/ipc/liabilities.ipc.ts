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
} from '../database/repositories/liabilities.repo'

import { requireAdmin, requireAdminPassword } from './permission-helper'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع'
}

export function registerLiabilitiesIpc(): void {
  ipcMain.handle('liabilities:list', (_, input) => {
    return listLiabilities(input)
  })

  ipcMain.handle('liabilities:list-page', (_, input) => {
    return listLiabilitiesPage(input)
  })

  ipcMain.handle('liabilities:create', (_, input) => {
    try {
      return createLiability(input)
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('liabilities:update', (_, input) => {
    try {
      requireAdminPassword(input?.actor_id, input?.admin_password)

      return updateLiability({
        id: Number(input?.id),

        party_name: input?.party_name,

        title: input?.title,

        category: input?.category,

        total_amount: Number(input?.total_amount),

        due_date: input?.due_date,

        notes: input?.notes,

        actor_id: input?.actor_id ?? null,
      })
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('liabilities:record-payment', (_, input) => {
    try {
      return recordLiabilityPayment(input)
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('liabilities:statement', (_, liabilityId: number) => {
    return getLiabilityStatement(liabilityId)
  })

  ipcMain.handle('liabilities:cancel', (_, input) => {
    try {
      requireAdmin(input?.actor_id)
      return cancelLiability(input)
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('liabilities:summary', (_, input) => {
    return getLiabilitiesSummary(input)
  })

  ipcMain.handle('liabilities:cancel-payment', (_, input) => {
    try {
      requireAdminPassword(input?.actor_id, input?.admin_password)

      return cancelLiabilityPayment({
        payment_id: Number(input?.payment_id),
        reason: input?.reason,
        actor_id: input?.actor_id ?? null,
      })
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })
}
