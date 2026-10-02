import { ipcMain } from 'electron'
import { runCriticalActionWithAudit } from './activity-helper'
import { requireAuthenticatedAdmin, requirePermission } from '../auth-session'
import {
  createPurchaseInvoice,
  getPurchaseInvoice,
  listPurchaseInvoices,
  recordSupplierPayment,
  getSupplierStatement,
  cancelPurchaseInvoice,
  createPurchaseReturn,
  listPurchaseReturns,
  cancelSupplierPaymentBatch,
  getSupplierPaymentBatchAccess,
  updateSupplierPaymentBatch,
  getPurchaseReturn,
  updatePurchaseInvoice,
  cancelPurchaseReturn,
  updatePurchaseReturn,
} from '../database/repositories/purchases.repo'

import { requireAdminPassword } from './permission-helper'

export function registerPurchasesIpc(): void {
  ipcMain.handle('purchases:create', (event, input) => {
    const actorId = requirePermission(event, 'purchases.manage').id

    const result = runCriticalActionWithAudit(
      () =>
        createPurchaseInvoice({
          ...input,
          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        action: 'purchase_created',

        entity: 'purchase_invoices',

        entity_id: result.purchaseId,

        details: {
          supplier_id: input.supplier_id,

          total_amount: result.total_amount,

          paid_amount: result.paid_amount,

          remaining_amount: result.remaining_amount,

          payment_status: result.payment_status,

          items_count: input.items?.length || 0,

          shift_id: result.shift_id,
        },
      }),
    )

    return result
  })

  ipcMain.handle('purchases:update', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const approval = requireAdminPassword(actorId, input?.admin_password)

    const purchaseId = Number(input?.purchase_id || 0)

    const before = getPurchaseInvoice(purchaseId)

    const criticalResult = runCriticalActionWithAudit(
      () => {
        const result = updatePurchaseInvoice({
          ...input,

          purchase_id: purchaseId,

          actor_id: actorId,
        })

        const after = getPurchaseInvoice(purchaseId)

        return {
          result,
          after,
        }
      },

      ({ after }) => ({
        actor_id: actorId,

        approved_by: approval.id,

        action: 'purchase_updated',

        entity: 'purchase_invoices',

        entity_id: purchaseId,

        details: {
          reason: input?.reason || null,

          before: {
            purchase: before.purchase,

            items: before.items,

            payments: before.payments,
          },

          after: {
            purchase: after.purchase,

            items: after.items,

            payments: after.payments,
          },
        },
      }),
    )

    return criticalResult.result
  })

  ipcMain.handle('purchases:list', (event, input) => {
    requirePermission(event, 'purchases.manage')

    return listPurchaseInvoices(input)
  })

  ipcMain.handle('purchases:get-by-id', (event, purchaseId: number) => {
    requirePermission(event, 'purchases.manage')

    return getPurchaseInvoice(Number(purchaseId))
  })

  ipcMain.handle('purchases:cancel', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const approval = requireAdminPassword(
      actorId,

      input?.admin_password,
    )

    const purchaseId = Number(input?.purchase_id)

    const result = runCriticalActionWithAudit(
      () =>
        cancelPurchaseInvoice({
          purchase_id: purchaseId,

          reason: input?.reason || '',

          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        approved_by: approval.id,

        action: 'purchase_cancelled',

        entity: 'purchase_invoices',

        entity_id: purchaseId,

        details: {
          purchase_id: purchaseId,

          reason: input?.reason || '',

          reversed_total: result.reversed_total,

          reversed_paid: result.reversed_paid,

          reversed_remaining: result.reversed_remaining,

          items_count: result.items_count,

          shift_id: result.cancelled_shift_id,
        },
      }),
    )

    return result
  })

  ipcMain.handle('purchases:returns:create', (event, input) => {
    const actorId = requirePermission(event, 'purchases.manage').id

    const purchaseId = Number(input?.purchase_id)

    const result = runCriticalActionWithAudit(
      () =>
        createPurchaseReturn({
          ...input,

          purchase_id: purchaseId,

          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        action: 'purchase_return_created',

        entity: 'purchase_returns',

        entity_id: result.return_id,

        details: {
          purchase_id: purchaseId,

          supplier_id: result.supplier_id,

          total_amount: result.total_amount,

          items_count: input?.items?.length || 0,

          notes: input?.notes || '',

          shift_id: result.shift_id,
        },
      }),
    )

    return result
  })

  ipcMain.handle('purchases:returns:cancel', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const approval = requireAdminPassword(actorId, input?.admin_password)

    const returnId = Number(input?.return_id || 0)

    const before = getPurchaseReturn(returnId)

    const result = runCriticalActionWithAudit(
      () =>
        cancelPurchaseReturn({
          return_id: returnId,

          reason: input?.reason,

          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        approved_by: approval.id,

        action: 'purchase_return_cancelled',

        entity: 'purchase_returns',

        entity_id: returnId,

        details: {
          reason: input?.reason || null,

          purchase_id: result.purchase_id,

          restored_total: result.restored_total,

          restored_debt: result.restored_debt,

          reversed_cash: result.reversed_cash,

          items_count: result.items_count,

          cancelled_shift_id: result.cancelled_shift_id,

          before,
        },
      }),
    )

    return result
  })

  ipcMain.handle('purchases:returns:update', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const approval = requireAdminPassword(actorId, input?.admin_password)

    const returnId = Number(input?.return_id || 0)

    const before = getPurchaseReturn(returnId)

    const criticalResult = runCriticalActionWithAudit(
      () => {
        const result = updatePurchaseReturn({
          ...input,

          return_id: returnId,

          actor_id: actorId,
        })

        const after = getPurchaseReturn(result.return_id)

        return {
          result,
          after,
        }
      },

      ({ result, after }) => ({
        actor_id: actorId,

        approved_by: approval.id,

        action: 'purchase_return_updated',

        entity: 'purchase_returns',

        entity_id: returnId,

        details: {
          reason: input?.reason || null,

          replacement_return_id: result.return_id,

          before,

          after,
        },
      }),
    )

    return criticalResult.result
  })

  ipcMain.handle('purchases:returns:list', (event, input) => {
    requirePermission(event, 'purchases.manage')

    return listPurchaseReturns(input)
  })

  ipcMain.handle('purchases:returns:get-by-id', (event, returnId: number) => {
    requirePermission(event, 'purchases.manage')

    return getPurchaseReturn(Number(returnId))
  })

  ipcMain.handle('suppliers:record-payment', (event, input) => {
    const actorId = requirePermission(event, 'purchases.manage').id

    const result = runCriticalActionWithAudit(
      () =>
        recordSupplierPayment({
          ...input,

          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        action: 'supplier_payment_recorded',

        entity: 'supplier_payment_batches',

        entity_id: result.payment_batch_id,

        details: {
          supplier_id: result.supplier_id,

          amount: result.paid_amount,

          allocations: result.allocations,

          shift_id: result.shift_id,
        },
      }),
    )

    return result
  })

  ipcMain.handle('suppliers:cancel-payment', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)

      const access = getSupplierPaymentBatchAccess(
        Number(input?.batch_id),
        actorId,
      )

      let approvedBy: number | null = null

      if (access.requires_admin_password) {
        approvedBy = requireAdminPassword(
          actorId,

          input?.admin_password,
        ).id
      }

      const batchId = Number(input?.batch_id)

      const result = runCriticalActionWithAudit(
        () =>
          cancelSupplierPaymentBatch({
            batch_id: batchId,

            reason: input?.reason,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          approved_by: approvedBy,

          action: 'supplier_payment_cancelled',

          entity: 'supplier_payment_batches',

          entity_id: batchId,

          details: {
            supplier_id: result.supplier_id,

            amount: result.cancelled_amount,

            reason: input?.reason || '',

            shift_id: result.cancelled_shift_id,
          },
        }),
      )

      return result
    } catch (error) {
      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر إلغاء دفعة المورد',
      }
    }
  })

  ipcMain.handle('suppliers:update-payment', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)

      const access = getSupplierPaymentBatchAccess(
        Number(input?.batch_id),
        actorId,
      )

      let approvedBy: number | null = null

      if (access.requires_admin_password) {
        approvedBy = requireAdminPassword(
          actorId,

          input?.admin_password,
        ).id
      }

      const batchId = Number(input?.batch_id)

      const result = runCriticalActionWithAudit(
        () =>
          updateSupplierPaymentBatch({
            batch_id: batchId,

            amount: Number(input?.amount),

            payment_method: input?.payment_method,

            notes: input?.notes,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          approved_by: approvedBy,

          action: 'supplier_payment_updated',

          entity: 'supplier_payment_batches',

          entity_id: batchId,

          details: {
            supplier_id: result.supplier_id,

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
          error instanceof Error ? error.message : 'تعذر تعديل دفعة المورد',
      }
    }
  })

  ipcMain.handle('suppliers:statement', (event, supplierId: number) => {
    const actorId = requirePermission(event, 'purchases.manage').id

    return getSupplierStatement(Number(supplierId), actorId)
  })
}
