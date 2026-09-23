import { ipcMain } from 'electron'
import { logAction } from './activity-helper'
import { requireAuthenticatedAdmin } from '../auth-session'
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
} from '../database/repositories/purchases.repo'

import { requireAdminPassword } from './permission-helper'

export function registerPurchasesIpc(): void {
  ipcMain.handle('purchases:create', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const result = createPurchaseInvoice({
      ...input,
      actor_id: actorId,
    })

    logAction({
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
    })

    return result
  })

  ipcMain.handle('purchases:list', (event, input) => {
    requireAuthenticatedAdmin(event)

    return listPurchaseInvoices(input)
  })

  ipcMain.handle('purchases:get-by-id', (event, purchaseId: number) => {
    requireAuthenticatedAdmin(event)

    return getPurchaseInvoice(Number(purchaseId))
  })

  ipcMain.handle('purchases:cancel', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const approval = requireAdminPassword(
      actorId,

      input?.admin_password,
    )

    const result = cancelPurchaseInvoice({
      purchase_id: Number(input.purchase_id),
      reason: input.reason || '',
      actor_id: actorId,
    })

    logAction({
      actor_id: actorId,
      approved_by: approval.id,
      action: 'purchase_cancelled',
      entity: 'purchase_invoices',
      entity_id: Number(input.purchase_id),
      details: {
        purchase_id: Number(input.purchase_id),
        reason: input.reason || '',
        reversed_total: result.reversed_total,
        reversed_paid: result.reversed_paid,
        reversed_remaining: result.reversed_remaining,
        items_count: result.items_count,
        shift_id: result.cancelled_shift_id,
      },
    })

    return result
  })

  ipcMain.handle('purchases:returns:create', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const result = createPurchaseReturn({
      ...input,
      purchase_id: Number(input.purchase_id),
      actor_id: actorId,
    })

    logAction({
      actor_id: actorId,
      action: 'purchase_return_created',
      entity: 'purchase_returns',
      entity_id: result.return_id,
      details: {
        purchase_id: Number(input.purchase_id),
        supplier_id: result.supplier_id,
        total_amount: result.total_amount,
        items_count: input.items?.length || 0,
        notes: input.notes || '',
        shift_id: result.shift_id,
      },
    })

    return result
  })

  ipcMain.handle('purchases:returns:list', (event, input) => {
    requireAuthenticatedAdmin(event)

    return listPurchaseReturns(input)
  })

  ipcMain.handle('purchases:returns:get-by-id', (event, returnId: number) => {
    requireAuthenticatedAdmin(event)

    return getPurchaseReturn(Number(returnId))
  })

  ipcMain.handle('suppliers:record-payment', (event, input) => {
    const actorId = requireAuthenticatedAdmin(event)

    const result = recordSupplierPayment({
      ...input,
      actor_id: actorId,
    })

    logAction({
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
    })

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

      const result = cancelSupplierPaymentBatch({
        batch_id: Number(input?.batch_id),

        reason: input?.reason,

        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,
        approved_by: approvedBy,
        action: 'supplier_payment_cancelled',

        entity: 'supplier_payment_batches',

        entity_id: Number(input?.batch_id),

        details: {
          supplier_id: result.supplier_id,

          amount: result.cancelled_amount,

          reason: input?.reason || '',
          shift_id: result.cancelled_shift_id,
        },
      })

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

      const result = updateSupplierPaymentBatch({
        batch_id: Number(input?.batch_id),

        amount: Number(input?.amount),

        payment_method: input?.payment_method,

        notes: input?.notes,

        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,
        approved_by: approvedBy,
        action: 'supplier_payment_updated',

        entity: 'supplier_payment_batches',

        entity_id: Number(input?.batch_id),

        details: {
          supplier_id: result.supplier_id,

          replacement_batch_id: result.batch_id,

          old_amount: result.old_amount,

          new_amount: result.new_amount,

          payment_method: result.payment_method,
          shift_id: result.shift_id,
        },
      })

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
    const actorId = requireAuthenticatedAdmin(event)

    return getSupplierStatement(Number(supplierId), actorId)
  })
}
