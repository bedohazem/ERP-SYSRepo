import { ipcMain } from 'electron'
import { requireAdmin, requireAnyAdminPassword } from './permission-helper'
import { getActorId, logAction } from './activity-helper'
import {
  adjustCustomerPoints,
  createCustomer,
  deleteCustomer,
  getCustomerById,
  getCustomerHistory,
  getCustomers,
  searchCustomers,
  updateCustomer,
  recordCustomerPayment,
  listCustomers,
  getCustomerStatement,
  cancelCustomerPaymentBatch,
  getCustomerPaymentBatchAccess,
  updateCustomerPaymentBatch,
} from '../database/repositories/customers.repo'

export function registerCustomersIpc(): void {
  ipcMain.handle('customers:list', () => {
    return getCustomers()
  })

  ipcMain.handle('customers:list-page', (_, input) => {
    return listCustomers(input)
  })

  ipcMain.handle('customers:search', (_, query: string) => {
    return searchCustomers(query ?? '')
  })

  ipcMain.handle('customers:get-by-id', (_, id: number) => {
    return getCustomerById(Number(id))
  })

  ipcMain.handle('customers:create', (_, input) => {
    return createCustomer(input)
  })

  ipcMain.handle('customers:update', (_, input) => {
    return updateCustomer(input)
  })

  ipcMain.handle('customers:delete', (_, id: number, actorId?: number) => {
    requireAdmin(actorId ?? null)
    return deleteCustomer(Number(id))
  })

  ipcMain.handle('customers:history', (_, customerId: number) => {
    return getCustomerHistory(Number(customerId))
  })

  ipcMain.handle('customers:adjust-points', (_, input) => {
    requireAdmin(getActorId(input))
    return adjustCustomerPoints(input)
  })

  ipcMain.handle('customers:record-payment', (_, input) => {
    return recordCustomerPayment(input)
  })

  ipcMain.handle('customers:cancel-payment', (_, input) => {
    try {
      const actorId = getActorId(input)

      const access = getCustomerPaymentBatchAccess(
        Number(input?.batch_id),
        actorId,
      )

      if (Number(access.created_by || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      if (access.requires_admin_password) {
        requireAnyAdminPassword(input?.admin_password)
      }

      const result = cancelCustomerPaymentBatch({
        batch_id: Number(input?.batch_id),

        reason: input?.reason,

        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,

        action: 'customer_payment_cancelled',

        entity: 'customer_payment_batches',

        entity_id: Number(input?.batch_id),

        details: {
          customer_id: result.customer_id,

          amount: result.cancelled_amount,

          reason: input?.reason,
        },
      })

      return result
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر إلغاء دفعة العميل',
      }
    }
  })

  ipcMain.handle('customers:update-payment', (_, input) => {
    try {
      const actorId = getActorId(input)

      const access = getCustomerPaymentBatchAccess(
        Number(input?.batch_id),
        actorId,
      )

      if (Number(access.created_by || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      if (access.requires_admin_password) {
        requireAnyAdminPassword(input?.admin_password)
      }

      const result = updateCustomerPaymentBatch({
        batch_id: Number(input?.batch_id),

        amount: Number(input?.amount),

        payment_method: input?.payment_method,

        notes: input?.notes,

        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,

        action: 'customer_payment_updated',

        entity: 'customer_payment_batches',

        entity_id: Number(input?.batch_id),

        details: {
          customer_id: result.customer_id,

          replacement_batch_id: result.batch_id,

          old_amount: result.old_amount,

          new_amount: result.new_amount,

          payment_method: result.payment_method,
        },
      })

      return result
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر تعديل دفعة العميل',
      }
    }
  })

  ipcMain.handle(
    'customers:statement',
    (_, customerId: number, actorId?: number) => {
      return getCustomerStatement(Number(customerId), actorId ?? null)
    },
  )
}
