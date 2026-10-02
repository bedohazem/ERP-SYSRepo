import { ipcMain } from 'electron'
import {
  logAction,
  runCriticalActionWithAudit,
  type ActionLogInput,
} from './activity-helper'
import { requireAuthenticatedUser, requirePermission } from '../auth-session'
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
  CreditLimitExceededError,
} from '../database/repositories/sales.repo'
import { userHasPermission } from '../database/repositories/user.repo'
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
import {
  createHeldSale,
  deleteHeldSale,
  getHeldSale,
  listHeldSales,
} from '../database/repositories/held-sales.repo'

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

function protectSalesCostData<T>(
  actor: {
    id: number
    role: string
  },

  value: T,
): T {
  if (actor.role === 'admin' || userHasPermission(actor.id, 'costs.view')) {
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
      const actor = requirePermission(event, 'sales.use')

      const result = searchSaleVariants(
        typeof payload === 'string'
          ? (payload ?? '')
          : (payload ?? { query: '' }),
      )

      return protectSalesCostData(actor, result)
    },
  )

  ipcMain.handle('sales:get-variant-by-barcode', (event, barcode: string) => {
    const actor = requirePermission(event, 'sales.use')

    const result = getVariantByBarcode(barcode ?? '')

    return protectSalesCostData(actor, result)
  })

  ipcMain.handle('sales:create', (event, input) => {
    const actor = requirePermission(event, 'sales.use')

    const runCreate = (approvedBy: number | null) =>
      createSale({
        ...input,

        user_id: actor.id,

        /*
         * لا نثق أبدًا في ID
         * جاي من الـRenderer.
         */
        credit_limit_override_approved_by: approvedBy,
      })

    const buildAudit = (
      result: ReturnType<typeof createSale>,
    ): ActionLogInput[] => {
      const logs: ActionLogInput[] = []

      if (result.credit_limit_override_approved_by) {
        logs.push({
          actor_id: actor.id,

          approved_by: result.credit_limit_override_approved_by,

          action: 'sale_credit_limit_overridden',

          entity: 'sales',

          entity_id: result.saleId,

          details: {
            customer_id: input?.customer_id ?? null,

            credit_limit: result.credit_limit_at_sale,

            customer_balance_before: result.customer_balance_before,

            additional_debt: result.remaining_amount,

            projected_debt:
              Number(result.customer_balance_before || 0) +
              Number(result.remaining_amount || 0),

            approved_by: result.credit_limit_override_approved_by,
          },
        })
      }

      logs.push({
        actor_id: actor.id,

        action: 'sale_created',

        entity: 'sales',

        entity_id: result.saleId,

        details: {
          customer_id: input?.customer_id ?? null,

          grand_total: result.grand_total ?? input?.grand_total,

          paid: input?.paid,

          payment_method: input?.payment_method,

          items_count: input?.items?.length || 0,

          shift_id: result.shift_id,

          payments: input?.payments ?? null,

          credit_limit_override_approved_by:
            result.credit_limit_override_approved_by ?? null,
        },
      })

      return logs
    }

    const runCreateWithAudit = (approvedBy: number | null) =>
      runCriticalActionWithAudit(() => runCreate(approvedBy), buildAudit)

    let result: ReturnType<typeof createSale>

    try {
      result = runCreateWithAudit(null)
    } catch (error) {
      if (!(error instanceof CreditLimitExceededError)) {
        throw error
      }

      if (!input?.credit_limit_override_requested) {
        return {
          success: false,

          code: error.code,

          message: error.message,

          credit: error.details,
        }
      }

      const approval = requireAdminApprovalForActor(
        actor,

        input?.admin_username,

        input?.admin_password,
      )

      result = runCreateWithAudit(approval.id)
    }

    return {
      success: true,

      ...result,
    }
  })

  ipcMain.handle('sales:hold', (event, input) => {
    const actor = requirePermission(event, 'sales.use')

    const result = createHeldSale({
      ...input,

      user_id: actor.id,
    })

    logAction({
      actor_id: actor.id,

      action: 'sale_held',

      entity: 'held_sales',

      entity_id: result.heldSaleId,

      details: {
        customer_id: input?.customer_id ?? null,

        title: input?.title || null,

        items_count: input?.items?.length || 0,
      },
    })

    return result
  })

  ipcMain.handle('sales:list-held', (event) => {
    const actor = requirePermission(event, 'sales.use')

    return listHeldSales({
      actor_id: actor.id,

      is_admin: actor.role === 'admin',
    })
  })

  ipcMain.handle('sales:get-held', (event, heldSaleId: number) => {
    const actor = requirePermission(event, 'sales.use')

    const result = getHeldSale({
      held_sale_id: Number(heldSaleId),

      actor_id: actor.id,

      is_admin: actor.role === 'admin',
    })

    return protectSalesCostData(actor, result)
  })

  ipcMain.handle('sales:delete-held', (event, input) => {
    const actor = requirePermission(event, 'sales.use')

    const mode = input?.mode === 'resumed' ? 'resumed' : 'discarded'

    const result = deleteHeldSale({
      held_sale_id: Number(input?.held_sale_id),

      actor_id: actor.id,

      is_admin: actor.role === 'admin',
    })

    logAction({
      actor_id: actor.id,

      action: mode === 'resumed' ? 'sale_hold_resumed' : 'sale_hold_discarded',

      entity: 'held_sales',

      entity_id: result.held_sale_id,

      details: {
        title: result.title,

        customer_id: result.customer_id ?? null,
      },
    })

    return result
  })

  ipcMain.handle('sales:update', (event, input) => {
    const actor = requirePermission(event, 'sales.history')

    const actorId = actor.id

    let approvedBy: number | null = null

    try {
      const saleId = Number(input?.sale_id || 0)

      const access = getSaleEditAccess(saleId, actorId)

      if (Number(access.user_id || 0) !== Number(actorId || 0)) {
        requireAdmin(actorId)
      }

      /*
       * Approval الخاص
       * بتعديل الفاتورة نفسه.
       */
      if (access.requires_admin_password) {
        const approval = requireAdminApprovalForActor(
          actor,

          input?.admin_username,

          input?.admin_password,
        )

        approvedBy = approval.id
      }

      let creditOverrideApprovedBy: number | null = null

      /*
       * لو الواجهة رجعت بعد
       * CREDIT_LIMIT_EXCEEDED
       * وتطلب Override.
       */
      if (input?.credit_limit_override_requested) {
        if (approvedBy) {
          creditOverrideApprovedBy = approvedBy
        } else {
          const approval = requireAdminApprovalForActor(
            actor,

            input?.admin_username,

            input?.admin_password,
          )

          approvedBy = approval.id

          creditOverrideApprovedBy = approval.id
        }
      }

      const before = getSaleReceipt(saleId)

      const criticalResult = runCriticalActionWithAudit(
        () => {
          const result = updateSaleInvoice({
            ...input,

            sale_id: saleId,

            actor_id: actorId,

            /*
             * Renderer لا يحدد
             * Approved ID بنفسه.
             */
            credit_limit_override_approved_by: creditOverrideApprovedBy,
          })

          const after = getSaleReceipt(saleId)

          return {
            result,
            after,
          }
        },

        ({ result, after }) => {
          const logs: ActionLogInput[] = []

          if (result.credit_limit_override_approved_by) {
            logs.push({
              actor_id: actorId,

              approved_by: result.credit_limit_override_approved_by,

              action: 'sale_credit_limit_overridden',

              entity: 'sales',

              entity_id: saleId,

              details: {
                edited: true,

                customer_id: input?.customer_id ?? null,

                credit_limit: result.credit_limit_at_sale,

                customer_balance_before: result.customer_balance_before,

                additional_debt: result.remaining_amount,

                approved_by: result.credit_limit_override_approved_by,
              },
            })
          }

          logs.push({
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

          return logs
        },
      )

      return {
        success: true,

        ...criticalResult.result,
      }
    } catch (error) {
      if (error instanceof CreditLimitExceededError) {
        return {
          success: false,

          code: error.code,

          message: error.message,

          credit: error.details,
        }
      }

      return {
        success: false,

        message:
          error instanceof Error ? error.message : 'تعذر تعديل فاتورة البيع',
      }
    }
  })

  ipcMain.handle('sales:get-receipt', (event, saleId: number) => {
    const actor = requirePermission(event, 'sales.history')

    const result = getSaleReceipt(Number(saleId))

    return protectSalesCostData(actor, result)
  })

  ipcMain.handle('sales:current-state', (event, saleId: number) => {
    const actor = requirePermission(event, 'sales.history')

    const result = getSaleCurrentState(Number(saleId))

    return protectSalesCostData(actor, result)
  })

  ipcMain.handle('sales:return-history', (event, saleId: number) => {
    requirePermission(event, 'sales.history')

    return getSaleReturnHistory(Number(saleId))
  })

  ipcMain.handle('sales:exchange-state', (event, saleId: number) => {
    const actor = requirePermission(event, 'sales.history')

    const result = getSaleExchangeState(Number(saleId))

    return protectSalesCostData(actor, result)
  })

  ipcMain.handle('sales:exchange', (event, input) => {
    const actorId = requirePermission(event, 'sales.exchanges').id

    const result = runCriticalActionWithAudit(
      () =>
        createSaleExchange({
          ...input,

          user_id: actorId,
        }),

      (result) => ({
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
      }),
    )

    return result
  })

  ipcMain.handle('sales:list-exchanges', (event, input) => {
    const actor = requirePermission(event, 'sales.history')
    const result = listSaleExchanges(input)

    return protectSalesCostData(actor, result)
  })

  ipcMain.handle('sales:cancel-exchange', (event, input) => {
    const actor = requirePermission(event, 'sales.exchanges')

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

      if (access.requires_admin_password) {
        const approval = requireAdminApprovalForActor(
          actor,

          input?.admin_username,

          input?.admin_password,
        )

        approvedBy = approval.id
      }

      const result = runCriticalActionWithAudit(
        () =>
          cancelSaleExchange({
            exchange_id: Number(input?.exchange_id),

            reason: input?.reason,

            actor_id: actorId,
          }),

        (result) => ({
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
        }),
      )

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
    requirePermission(event, 'sales.history')

    return listSales(input)
  })

  ipcMain.handle('sales:list-returns', (event, input) => {
    requirePermission(event, 'sales.history')

    return listSaleReturns(input)
  })

  ipcMain.handle('sales:return', (event, input) => {
    const actorId = requirePermission(event, 'sales.returns').id

    const result = runCriticalActionWithAudit(
      () =>
        createSaleReturn({
          ...input,

          user_id: actorId,
        }) as any,

      (result) => ({
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
      }),
    )

    return result
  })

  ipcMain.handle('sales:cancel', (event, input) => {
    const actor = requirePermission(event, 'sales.history')

    const actorId = actor.id

    let approvedBy: number | null = null

    try {
      const access = getSaleCancellationAccess(Number(input?.sale_id), actorId)

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

      const result = runCriticalActionWithAudit(
        () =>
          cancelSaleInvoice({
            sale_id: Number(input?.sale_id),

            reason: input?.reason,

            actor_id: actorId,
          }),

        (result) => ({
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
        }),
      )

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
    const actor = requirePermission(event, 'sales.returns')

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

      if (access.requires_admin_password) {
        const approval = requireAdminApprovalForActor(
          actor,

          input?.admin_username,

          input?.admin_password,
        )

        approvedBy = approval.id
      }

      const result = runCriticalActionWithAudit(
        () =>
          cancelSaleReturn({
            return_id: Number(input?.return_id),

            reason: input?.reason,

            actor_id: actorId,
          }),

        (result) => ({
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
        }),
      )

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
