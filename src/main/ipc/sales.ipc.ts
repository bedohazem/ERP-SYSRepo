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
  getSaleEditAccess,
  updateSaleInvoice,
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

import { requireAdmin, requireAdminApprovalForActor } from './permission-helper'

import { getSaleCurrentState } from '../database/repositories/sales-current-state.repo'

const SALES_COST_FIELDS = new Set([
  'buy_price',
  'unit_cost',
  'old_unit_cost',
  'new_unit_cost',
  'original_unit_cost',
  'current_unit_cost',
])

const SALES_COST_JSON_FIELDS = new Set([
  'before_state_json',
  'after_state_json',
])

function redactSalesCostData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSalesCostData(item)) as T
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  const source = value as Record<string, unknown>

  const result: Record<string, unknown> = {}

  for (const [key, child] of Object.entries(source)) {
    if (SALES_COST_FIELDS.has(key)) {
      result[key] = 0

      continue
    }

    /*
     * Exchange audit snapshots contain
     * cost values encoded inside JSON strings.
     */
    if (SALES_COST_JSON_FIELDS.has(key)) {
      result[key] = '[]'

      continue
    }

    result[key] = redactSalesCostData(child)
  }

  return result as T
}

function protectSalesCostData<T>(role: string, value: T): T {
  if (role === 'admin') {
    return value
  }

  return redactSalesCostData(value)
}

export function registerSalesIpc(): void {
  ipcMain.handle(
    'sales:search-variants',
    (
      event,
      payload:
        | string
        | {
            query?: string
            categoryId?: number | string | null
            limit?: number
          },
    ) => {
      const actor = requireAuthenticatedUser(event)

      const result = searchSaleVariants(
        typeof payload === 'string'
          ? (payload ?? '')
          : (payload ?? { query: '' }),
      )

      return protectSalesCostData(actor.role, result)
    },
  )

  ipcMain.handle('sales:get-variant-by-barcode', (event, barcode: string) => {
    const actor = requireAuthenticatedUser(event)

    const result = getVariantByBarcode(barcode ?? '')

    return protectSalesCostData(actor.role, result)
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
        payments: input.payments ?? null,
      },
    })

    return result
  })

  ipcMain.handle('sales:update', (event, input) => {
    const actor = requireAuthenticatedUser(event)

    const actorId = actor.id

    let approvedBy: number | null = null

    try {
      const saleId = Number(input?.sale_id || 0)

      const access = getSaleEditAccess(saleId, actorId)

      if (Number(access.user_id || 0) !== Number(actorId || 0)) {
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

      const before = getSaleReceipt(saleId)

      const result = updateSaleInvoice({
        ...input,

        sale_id: saleId,

        actor_id: actorId,
      })

      const after = getSaleReceipt(saleId)

      logAction({
        actor_id: actorId,
        approved_by: approvedBy,
        action: 'sale_updated',

        entity: 'sales',

        entity_id: saleId,

        details: {
          reason: input?.reason || null,

          before: {
            sale: before.sale,
            items: before.items,
            payments: before.payments,
          },

          after: {
            sale: after.sale,
            items: after.items,
            payments: after.payments,
          },
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
          error instanceof Error ? error.message : 'تعذر تعديل فاتورة البيع',
      }
    }
  })

  ipcMain.handle('sales:get-receipt', (event, saleId: number) => {
    const actor = requireAuthenticatedUser(event)

    const result = getSaleReceipt(Number(saleId))

    return protectSalesCostData(actor.role, result)
  })

  ipcMain.handle('sales:current-state', (event, saleId: number) => {
    const actor = requireAuthenticatedUser(event)

    const result = getSaleCurrentState(Number(saleId))

    return protectSalesCostData(actor.role, result)
  })

  ipcMain.handle('sales:return-history', (event, saleId: number) => {
    requireAuthenticatedUser(event)

    return getSaleReturnHistory(Number(saleId))
  })

  ipcMain.handle('sales:exchange-state', (event, saleId: number) => {
    const actor = requireAuthenticatedUser(event)

    const result = getSaleExchangeState(Number(saleId))

    return protectSalesCostData(actor.role, result)
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
        shift_id: result.shift_id,
        items_count: input.items?.length || 0,
      },
    })

    return result
  })

  ipcMain.handle('sales:list-exchanges', (event, input) => {
    const actor = requireAuthenticatedUser(event)

    const result = listSaleExchanges(input)

    return protectSalesCostData(actor.role, result)
  })

  ipcMain.handle('sales:cancel-exchange', (event, input) => {
    const actor = requireAuthenticatedUser(event)

    const actorId = actor.id

    let approvedBy: number | null = null

    try {
      const access = getSaleExchangeCancellationAccess(
        Number(input?.exchange_id),

        actorId,
      )

      if (Number(access.user_id || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      const approval = requireAdminApprovalForActor(
        actor,

        input?.admin_username,

        input?.admin_password,
      )

      approvedBy = approval.id

      const result = cancelSaleExchange({
        exchange_id: Number(input?.exchange_id),

        reason: input?.reason,

        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,
        approved_by: approvedBy,
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
          shift_id: result.cancelled_shift_id,
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

  ipcMain.handle('sales:list', (event, input) => {
    requireAuthenticatedUser(event)

    return listSales(input)
  })

  ipcMain.handle('sales:list-returns', (event, input) => {
    requireAuthenticatedUser(event)

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
        shift_id: result.shift_id,
      },
    })

    return result
  })

  ipcMain.handle('sales:cancel', (event, input) => {
    const actor = requireAuthenticatedUser(event)

    const actorId = actor.id

    let approvedBy: number | null = null

    try {
      const access = getSaleCancellationAccess(Number(input?.sale_id), actorId)

      if (Number(access.user_id || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      const approval = requireAdminApprovalForActor(
        actor,

        input?.admin_username,

        input?.admin_password,
      )

      approvedBy = approval.id

      const result = cancelSaleInvoice({
        sale_id: Number(input?.sale_id),
        reason: input?.reason,
        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,
        approved_by: approvedBy,
        action: 'sale_cancelled',
        entity: 'sales',
        entity_id: Number(input?.sale_id),
        details: {
          reason: input?.reason,
          refunded_amount: result.refunded_amount,
          removed_debt: result.removed_debt,
          shift_id: result.cancelled_shift_id,
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
    const actor = requireAuthenticatedUser(event)

    const actorId = actor.id

    let approvedBy: number | null = null

    try {
      const access = getSaleReturnCancellationAccess(
        Number(input?.return_id),
        actorId,
      )

      if (Number(access.user_id || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      const approval = requireAdminApprovalForActor(
        actor,

        input?.admin_username,

        input?.admin_password,
      )

      approvedBy = approval.id

      const result = cancelSaleReturn({
        return_id: Number(input?.return_id),
        reason: input?.reason,
        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,
        approved_by: approvedBy,
        action: 'sale_return_cancelled',
        entity: 'sale_returns',
        entity_id: Number(input?.return_id),
        details: {
          reason: input?.reason,
          sale_id: result.sale_id,
          cash_restored: result.cash_restored,
          debt_restored: result.debt_restored,
          shift_id: result.cancelled_shift_id,
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
