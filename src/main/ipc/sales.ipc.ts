import { ipcMain } from 'electron'
import { getActorId, logAction } from './activity-helper'
import {
  createSale,
  getSaleReceipt,
  listSales,
  createSaleReturn,
  getSaleReturnHistory,
  cancelSaleInvoice,
  cancelSaleReturn,
  listSaleReturns,
} from '../database/repositories/sales.repo'

import {
  getVariantByBarcode,
  searchSaleVariants,
} from '../database/repositories/product.repo'

import { requireAdminPassword } from './permission-helper'

export function registerSalesIpc(): void {
  ipcMain.handle(
    'sales:search-variants',
    (
      _,
      payload:
        | string
        | {
            query?: string
            categoryId?: number | string | null
            limit?: number
          },
    ) => {
      return searchSaleVariants(
        typeof payload === 'string'
          ? (payload ?? '')
          : (payload ?? { query: '' }),
      )
    },
  )

  ipcMain.handle('sales:get-variant-by-barcode', (_, barcode: string) => {
    return getVariantByBarcode(barcode ?? '')
  })

  ipcMain.handle('sales:create', (_, input) => {
    const result = createSale(input)

    logAction({
      actor_id: getActorId(input),
      action: 'sale_created',
      entity: 'sales',
      entity_id: result.saleId,
      details: {
        customer_id: input.customer_id ?? null,
        grand_total: result.grand_total ?? input.grand_total,
        paid: input.paid,
        payment_method: input.payment_method,
        items_count: input.items?.length || 0,
      },
    })

    return result
  })

  ipcMain.handle('sales:get-receipt', (_, saleId: number) => {
    return getSaleReceipt(Number(saleId))
  })

  ipcMain.handle('sales:return-history', (_, saleId: number) => {
    return getSaleReturnHistory(Number(saleId))
  })

  ipcMain.handle('sales:list', (_, input) => {
    return listSales(input)
  })

  ipcMain.handle('sales:list-returns', (_, input) => {
    return listSaleReturns(input)
  })

  ipcMain.handle('sales:return', (_, input) => {
    const result = createSaleReturn(input) as any

    logAction({
      actor_id: getActorId(input),
      action: 'sale_return_created',
      entity: 'sale_returns',
      entity_id: result.returnId ?? result.returnSaleId,
      details: {
        return_code: result.returnCode,
        original_sale_id: result.originalSaleId,
        refund_amount: result.refundAmount,
        reason: input.reason,
        items_count: input.items?.length || 0,
      },
    })

    return result
  })

  ipcMain.handle('sales:cancel', (_, input) => {
    try {
      const actorId = getActorId(input)

      requireAdminPassword(actorId, input?.admin_password)

      const result = cancelSaleInvoice({
        sale_id: Number(input?.sale_id),
        reason: input?.reason,
        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,
        action: 'sale_cancelled',
        entity: 'sales',
        entity_id: Number(input?.sale_id),
        details: {
          reason: input?.reason,
          refunded_amount: result.refunded_amount,
          removed_debt: result.removed_debt,
        },
      })

      return {
        success: true,
        ...result,
      }
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'تعذر إلغاء فاتورة البيع',
      }
    }
  })

  ipcMain.handle('sales:cancel-return', (_, input) => {
    try {
      const actorId = getActorId(input)

      requireAdminPassword(actorId, input?.admin_password)

      const result = cancelSaleReturn({
        return_id: Number(input?.return_id),
        reason: input?.reason,
        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,
        action: 'sale_return_cancelled',
        entity: 'sale_returns',
        entity_id: Number(input?.return_id),
        details: {
          reason: input?.reason,
          sale_id: result.sale_id,
          cash_restored: result.cash_restored,
          debt_restored: result.debt_restored,
        },
      })

      return {
        success: true,
        ...result,
      }
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'تعذر إلغاء مرتجع البيع',
      }
    }
  })
}
