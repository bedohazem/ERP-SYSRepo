import { ipcMain } from 'electron'
import { logAction } from './activity-helper'
import { requireAuthenticatedUser } from '../auth-session'
import {
  createSale,
  getSaleReceipt,
  listSales,
  createSaleReturn,
  getSaleReturnHistory,
  cancelSaleInvoice,
  cancelSaleReturn,
  listSaleReturns,
  getSaleCancellationAccess,
  getSaleReturnCancellationAccess,
} from '../database/repositories/sales.repo'

import {
  getVariantByBarcode,
  searchSaleVariants,
} from '../database/repositories/product.repo'

import {
  cancelSaleExchange,
  createSaleExchange,
  getSaleExchangeCancellationAccess,
  getSaleExchangeState,
  listSaleExchanges,
} from '../database/repositories/sales-exchange.repo'

import { requireAdmin, requireAnyAdminPassword } from './permission-helper'

import { getSaleCurrentState } from '../database/repositories/sales-current-state.repo'

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

  ipcMain.handle('sales:create', (event, input) => {
    const actorId = requireAuthenticatedUser(event).id

    const result = createSale({
      ...input,
      user_id: actorId,
    })

    logAction({
      actor_id: actorId,
      action: 'sale_created',
      entity: 'sales',
      entity_id: result.saleId,
      details: {
        customer_id: input.customer_id ?? null,
        grand_total: result.grand_total ?? input.grand_total,
        paid: input.paid,
        payment_method: input.payment_method,
        items_count: input.items?.length || 0,
        shift_id: result.shift_id,
      },
    })

    return result
  })

  ipcMain.handle('sales:get-receipt', (_, saleId: number) => {
    return getSaleReceipt(Number(saleId))
  })

  ipcMain.handle('sales:current-state', (_, saleId: number) => {
    return getSaleCurrentState(Number(saleId))
  })

  ipcMain.handle('sales:return-history', (_, saleId: number) => {
    return getSaleReturnHistory(Number(saleId))
  })

  ipcMain.handle('sales:exchange-state', (_, saleId: number) => {
    return getSaleExchangeState(Number(saleId))
  })

  ipcMain.handle('sales:exchange', (event, input) => {
    const actorId = requireAuthenticatedUser(event).id
    const result = createSaleExchange({
      ...input,
      user_id: actorId,
    })

    logAction({
      actor_id: actorId,
      action: 'sale_exchange_created',
      entity: 'sale_exchanges',
      entity_id: result.exchangeId,
      details: {
        exchange_code: result.exchangeCode,
        original_sale_id: result.original_sale_id,
        promotion_group_id: result.promotion_group_id,
        old_group_total: result.old_group_total,
        new_group_total: result.new_group_total,
        difference_amount: result.difference_amount,
        amount_to_collect: result.amount_to_collect,
        amount_to_refund: result.amount_to_refund,
        debt_reduction_amount: result.debt_reduction_amount,
        payment_method: result.payment_method,
        items_count: input.items?.length || 0,
      },
    })

    return result
  })

  ipcMain.handle('sales:list-exchanges', (_, input) => {
    return listSaleExchanges(input)
  })

  ipcMain.handle('sales:cancel-exchange', (event, input) => {
    const actorId = requireAuthenticatedUser(event).id

    try {
      const access = getSaleExchangeCancellationAccess(
        Number(input?.exchange_id),

        actorId,
      )

      if (Number(access.user_id || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      if (access.requires_admin_password) {
        requireAnyAdminPassword(input?.admin_password)
      }

      const result = cancelSaleExchange({
        exchange_id: Number(input?.exchange_id),

        reason: input?.reason,

        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,

        action: 'sale_exchange_cancelled',

        entity: 'sale_exchanges',

        entity_id: Number(input?.exchange_id),

        details: {
          reason: input?.reason,

          sale_id: result.sale_id,

          cash_refunded: result.cash_refunded,

          cash_collected: result.cash_collected,

          debt_restored: result.debt_restored,

          loyalty_balance_reversed: result.loyalty_balance_reversed,
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
          error instanceof Error ? error.message : 'تعذر إلغاء عملية الاستبدال',
      }
    }
  })

  ipcMain.handle('sales:list', (_, input) => {
    return listSales(input)
  })

  ipcMain.handle('sales:list-returns', (_, input) => {
    return listSaleReturns(input)
  })

  ipcMain.handle('sales:return', (event, input) => {
    const actorId = requireAuthenticatedUser(event).id
    const result = createSaleReturn({
      ...input,
      user_id: actorId,
    }) as any

    logAction({
      actor_id: actorId,
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

  ipcMain.handle('sales:cancel', (event, input) => {
    const actorId = requireAuthenticatedUser(event).id

    try {
      const access = getSaleCancellationAccess(Number(input?.sale_id), actorId)

      if (Number(access.user_id || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      if (access.requires_admin_password) {
        requireAnyAdminPassword(input?.admin_password)
      }

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

  ipcMain.handle('sales:cancel-return', (event, input) => {
    const actorId = requireAuthenticatedUser(event).id

    try {
      const access = getSaleReturnCancellationAccess(
        Number(input?.return_id),
        actorId,
      )

      if (Number(access.user_id || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      if (access.requires_admin_password) {
        requireAnyAdminPassword(input?.admin_password)
      }

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
