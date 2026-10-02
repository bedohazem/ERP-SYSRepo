import { ipcMain } from 'electron'
import { requireAdmin, requireAdminApprovalForActor } from './permission-helper'
import { runCriticalActionWithAudit } from './activity-helper'
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
import { requireAuthenticatedAdmin, requirePermission } from '../auth-session'

export function registerCustomersIpc(): void {
  ipcMain.handle('customers:list', (event) => {
    requirePermission(event, 'customers.view')

    return getCustomers()
  })

  ipcMain.handle('customers:list-page', (event, input) => {
    requirePermission(event, 'customers.view')

    return listCustomers(input)
  })

  ipcMain.handle('customers:search', (event, query: string) => {
    requirePermission(event, 'customers.view')

    return searchCustomers(query ?? '')
  })

  ipcMain.handle('customers:get-by-id', (event, id: number) => {
    requirePermission(event, 'customers.view')

    return getCustomerById(Number(id))
  })

  ipcMain.handle('customers:create', (event, input) => {
    const actorId = requirePermission(event, 'customers.manage').id

    return runCriticalActionWithAudit(
      () => createCustomer(input) as any,

      (customer) => ({
        actor_id: actorId,

        action: 'customer_created',

        entity: 'customers',

        entity_id: Number(customer?.id || 0) || null,

        details: {
          name: customer?.name || input?.name,

          phone: customer?.phone || input?.phone,
        },
      }),
    )
  })

  ipcMain.handle('customers:update', (event, input) => {
    const actorId = requirePermission(event, 'customers.manage').id

    return runCriticalActionWithAudit(
      () => updateCustomer(input) as any,

      (customer) => ({
        actor_id: actorId,

        action: 'customer_updated',

        entity: 'customers',

        entity_id: Number(input?.id),

        details: {
          name: customer?.name || input?.name,

          phone: customer?.phone || input?.phone,
        },
      }),
    )
  })

  ipcMain.handle('customers:delete', (event, id: number) => {
    const actorId = requireAuthenticatedAdmin(event)

    const customer = getCustomerById(Number(id)) as any

    return runCriticalActionWithAudit(
      () => deleteCustomer(Number(id)),

      () => ({
        actor_id: actorId,

        action: 'customer_deactivated',

        entity: 'customers',

        entity_id: Number(id),

        details: {
          name: customer?.name || '',

          phone: customer?.phone || '',

          balance: Number(customer?.balance || 0),
        },
      }),
    )
  })

  ipcMain.handle('customers:history', (event, customerId: number) => {
    requirePermission(event, 'customers.view')

    return getCustomerHistory(Number(customerId))
  })

  ipcMain.handle('customers:adjust-points', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    return runCriticalActionWithAudit(
      () => adjustCustomerPoints(input),

      () => ({
        actor_id: actorId,

        action: 'customer_points_adjusted',

        entity: 'customers',

        entity_id: Number(input?.customer_id),

        details: {
          customer_id: Number(input?.customer_id),

          points: Number(input?.points || 0),

          notes: input?.notes || '',
        },
      }),
    )
  })

  ipcMain.handle('customers:record-payment', (event, input) => {
    const actorId = requirePermission(event, 'customers.payments').id

    return runCriticalActionWithAudit(
      () =>
        recordCustomerPayment({
          ...input,

          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        action: 'customer_payment_created',

        entity: 'customer_payment_batches',

        entity_id: result.payment_batch_id,

        details: {
          customer_id: result.customer_id,

          amount: result.paid_amount,

          payment_method: input?.payment_method || 'cash',

          allocations: result.allocations,

          shift_id: result.shift_id,
        },
      }),
    )
  })

  ipcMain.handle('customers:cancel-payment', (event, input) => {
    try {
      const actor = requirePermission(event, 'customers.payments')

      const actorId = actor.id

      let approvedBy: number | null = null

      const access = getCustomerPaymentBatchAccess(
        Number(input?.batch_id),
        actorId,
      )

      if (Number(access.created_by || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      if (access.requires_admin_password) {
        const approval = requireAdminApprovalForActor(
          actor,

          input?.admin_username,

          input?.admin_password,
        )

        approvedBy = approval.id
      }

      const batchId = Number(input?.batch_id)

      const result = runCriticalActionWithAudit(
        () =>
          cancelCustomerPaymentBatch({
            batch_id: batchId,

            reason: input?.reason,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          approved_by: approvedBy,

          action: 'customer_payment_cancelled',

          entity: 'customer_payment_batches',

          entity_id: batchId,

          details: {
            customer_id: result.customer_id,

            amount: result.cancelled_amount,

            reason: input?.reason,

            shift_id: result.cancelled_shift_id,
          },
        }),
      )

      return result
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر إلغاء دفعة العميل',
      }
    }
  })

  ipcMain.handle('customers:update-payment', (event, input) => {
    try {
      const actor = requirePermission(event, 'customers.payments')

      const actorId = actor.id

      let approvedBy: number | null = null

      const access = getCustomerPaymentBatchAccess(
        Number(input?.batch_id),
        actorId,
      )

      if (Number(access.created_by || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      if (access.requires_admin_password) {
        const approval = requireAdminApprovalForActor(
          actor,

          input?.admin_username,

          input?.admin_password,
        )

        approvedBy = approval.id
      }

      const batchId = Number(input?.batch_id)

      const result = runCriticalActionWithAudit(
        () =>
          updateCustomerPaymentBatch({
            batch_id: batchId,

            amount: Number(input?.amount),

            payment_method: input?.payment_method,

            notes: input?.notes,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          approved_by: approvedBy,

          action: 'customer_payment_updated',

          entity: 'customer_payment_batches',

          entity_id: batchId,

          details: {
            customer_id: result.customer_id,

            replacement_batch_id: result.batch_id,

            old_amount: result.old_amount,

            new_amount: result.new_amount,

            payment_method: result.payment_method,

            shift_id: result.shift_id,
          },
        }),
      )

      return result
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر تعديل دفعة العميل',
      }
    }
  })

  ipcMain.handle('customers:statement', (event, customerId: number) => {
    const actorId = requirePermission(event, 'customers.payments').id

    return getCustomerStatement(Number(customerId), actorId)
  })
}
