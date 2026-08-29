import { ipcMain } from 'electron'
import { getActorId, logAction } from './activity-helper'
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

import {
  requireAdmin,
  requireAdminPassword,
  requireAnyAdminPassword,
} from './permission-helper'

export function registerPurchasesIpc(): void {
  ipcMain.handle('purchases:create', (_, input) => {
    const result = createPurchaseInvoice(input)

    logAction({
      actor_id: getActorId(input),
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
      },
    })

    return result
  })

  ipcMain.handle('purchases:list', (_, input) => {
    return listPurchaseInvoices(input)
  })

  ipcMain.handle('purchases:get-by-id', (_, purchaseId: number) => {
    return getPurchaseInvoice(Number(purchaseId))
  })

  ipcMain.handle('purchases:cancel', (_, input) => {
    requireAdminPassword(getActorId(input), input?.admin_password)
    const result = cancelPurchaseInvoice({
      purchase_id: Number(input.purchase_id),
      reason: input.reason || '',
      actor_id: getActorId(input),
    })

    logAction({
      actor_id: getActorId(input),
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
      },
    })

    return result
  })

  ipcMain.handle('purchases:returns:create', (_, input) => {
    const result = createPurchaseReturn({
      ...input,
      purchase_id: Number(input.purchase_id),
      actor_id: getActorId(input),
    })

    logAction({
      actor_id: getActorId(input),
      action: 'purchase_return_created',
      entity: 'purchase_returns',
      entity_id: result.return_id,
      details: {
        purchase_id: Number(input.purchase_id),
        supplier_id: result.supplier_id,
        total_amount: result.total_amount,
        items_count: input.items?.length || 0,
        notes: input.notes || '',
      },
    })

    return result
  })

  ipcMain.handle('purchases:returns:list', (_, input) => {
    return listPurchaseReturns(input)
  })

  ipcMain.handle('purchases:returns:get-by-id', (_, returnId: number) => {
    return getPurchaseReturn(Number(returnId))
  })

  ipcMain.handle('suppliers:record-payment', (_, input) => {
    const actorId = getActorId(input)

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
      },
    })

    return result
  })

  ipcMain.handle('suppliers:cancel-payment', (_, input) => {
    try {
      const actorId = getActorId(input)

      const access = getSupplierPaymentBatchAccess(
        Number(input?.batch_id),
        actorId,
      )

      if (Number(access.created_by || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      if (access.requires_admin_password) {
        requireAnyAdminPassword(input?.admin_password)
      }

      const result = cancelSupplierPaymentBatch({
        batch_id: Number(input?.batch_id),

        reason: input?.reason,

        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,

        action: 'supplier_payment_cancelled',

        entity: 'supplier_payment_batches',

        entity_id: Number(input?.batch_id),

        details: {
          supplier_id: result.supplier_id,

          amount: result.cancelled_amount,

          reason: input?.reason || '',
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

  ipcMain.handle('suppliers:update-payment', (_, input) => {
    try {
      const actorId = getActorId(input)

      const access = getSupplierPaymentBatchAccess(
        Number(input?.batch_id),
        actorId,
      )

      if (Number(access.created_by || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      if (access.requires_admin_password) {
        requireAnyAdminPassword(input?.admin_password)
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

        action: 'supplier_payment_updated',

        entity: 'supplier_payment_batches',

        entity_id: Number(input?.batch_id),

        details: {
          supplier_id: result.supplier_id,

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
          error instanceof Error ? error.message : 'تعذر تعديل دفعة المورد',
      }
    }
  })

  ipcMain.handle(
    'suppliers:statement',
    (_, supplierId: number, actorId?: number) => {
      return getSupplierStatement(Number(supplierId), actorId ?? null)
    },
  )
}
