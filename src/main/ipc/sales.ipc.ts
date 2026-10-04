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
import {
  optionalBooleanValue,
  optionalEnumValue,
  optionalNonNegativeInteger,
  optionalNonNegativeNumber,
  optionalPositiveInteger,
  optionalStringValue,
  optionalTrimmedString,
  requireArrayInput,
  requireEnumValue,
  requireNonNegativeNumber,
  requireObjectInput,
  requirePositiveInteger,
  requirePositiveNumber,
  requireTrimmedString,
  optionalNonNegativeMoney,
  requireNonNegativeMoney,
  requirePositiveMoney,
} from './input-validation'
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

const SALE_PAYMENT_METHOD_VALUES = [
  'cash',
  'card',
  'wallet',
  'bank',
  'bank_transfer',

  'store_cash',
  'store_safe',
  'owner_cash',
  'owner_bank',
  'owner_vodafone',
  'fawry_machine',

  'split',
] as const

const SALE_PAYMENT_ENTRY_METHOD_VALUES = [
  'cash',
  'card',
  'wallet',
  'bank',
  'bank_transfer',

  'store_cash',
  'store_safe',
  'owner_cash',
  'owner_bank',
  'owner_vodafone',
  'fawry_machine',
] as const

const SALE_PAYMENT_STATUS_VALUES = ['paid', 'partial', 'unpaid'] as const

const HELD_SALE_DISCOUNT_TYPES = ['amount', 'percent'] as const

const HELD_SALE_DELETE_MODES = ['resumed', 'discarded'] as const

function optionalSaleDate(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    throw new Error('تاريخ البيع غير صحيح')
  }

  const date = value.trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('تاريخ البيع غير صحيح')
  }

  return date
}

function normalizeSaleWriteInput(input: unknown) {
  const payload = requireObjectInput(input, 'بيانات فاتورة البيع')

  const rawItems = requireArrayInput(payload.items, 'أصناف فاتورة البيع', 500)

  if (rawItems.length === 0) {
    throw new Error('أصناف فاتورة البيع مطلوبة')
  }

  const items = rawItems.map((rawItem) => {
    const item = requireObjectInput(rawItem, 'بيانات صنف البيع')

    return {
      variant_id: requirePositiveInteger(item.variant_id, 'رقم صنف البيع'),

      product_name: requireTrimmedString(
        item.product_name,
        'اسم صنف البيع',
        300,
      ),

      barcode: optionalStringValue(item.barcode, 'باركود صنف البيع', 200),

      size: optionalStringValue(item.size, 'مقاس صنف البيع', 100),

      color: optionalStringValue(item.color, 'لون صنف البيع', 100),

      quantity: requirePositiveNumber(item.quantity, 'كمية صنف البيع'),

      unit_price: requireNonNegativeMoney(item.unit_price, 'سعر صنف البيع'),
    }
  })

  const paymentMethod = requireEnumValue(
    payload.payment_method === undefined ||
      payload.payment_method === null ||
      payload.payment_method === ''
      ? 'cash'
      : payload.payment_method,

    SALE_PAYMENT_METHOD_VALUES,

    'طريقة دفع فاتورة البيع',
  )

  const payments =
    payload.payments === undefined || payload.payments === null
      ? undefined
      : requireArrayInput(payload.payments, 'وسائل دفع فاتورة البيع', 10).map(
          (rawPayment) => {
            const payment = requireObjectInput(rawPayment, 'بيانات وسيلة الدفع')

            return {
              payment_method: requireEnumValue(
                payment.payment_method,
                SALE_PAYMENT_ENTRY_METHOD_VALUES,
                'طريقة الدفع',
              ),

              amount: requirePositiveMoney(payment.amount, 'مبلغ وسيلة الدفع'),
            }
          },
        )

  if (paymentMethod === 'split' && (!payments || payments.length < 2)) {
    throw new Error('الدفع المتعدد يحتاج وسيلتي دفع على الأقل')
  }

  const promotionIds =
    payload.promotion_ids === undefined || payload.promotion_ids === null
      ? undefined
      : requireArrayInput(payload.promotion_ids, 'العروض', 100).map((id) =>
          requirePositiveInteger(id, 'رقم العرض'),
        )

  return {
    customer_id: optionalPositiveInteger(payload.customer_id, 'رقم العميل'),

    business_date: optionalSaleDate(payload.business_date),

    promotion_id: optionalPositiveInteger(payload.promotion_id, 'رقم العرض'),

    promotion_ids: promotionIds,

    sub_total:
      optionalNonNegativeMoney(
        payload.sub_total,
        'إجمالي الفاتورة قبل الخصم',
      ) ?? 0,

    discount_value:
      optionalNonNegativeMoney(payload.discount_value, 'قيمة الخصم') ?? 0,

    grand_total:
      optionalNonNegativeMoney(payload.grand_total, 'إجمالي فاتورة البيع') ?? 0,

    change_amount:
      optionalNonNegativeMoney(payload.change_amount, 'الباقي للعميل') ?? 0,

    payment_method: paymentMethod,

    payments,

    notes: optionalTrimmedString(payload.notes, 'ملاحظات فاتورة البيع', 2000),

    loyalty_points_redeemed: optionalNonNegativeInteger(
      payload.loyalty_points_redeemed,
      'نقاط الولاء المستخدمة',
    ),

    loyalty_discount_value: optionalNonNegativeMoney(
      payload.loyalty_discount_value,
      'خصم نقاط الولاء',
    ),

    paid: optionalNonNegativeMoney(payload.paid, 'المبلغ المدفوع'),

    remaining_amount: optionalNonNegativeMoney(
      payload.remaining_amount,
      'المبلغ المتبقي',
    ),

    payment_status: optionalEnumValue(
      payload.payment_status,
      SALE_PAYMENT_STATUS_VALUES,
      'حالة دفع الفاتورة',
    ),

    items,

    credit_limit_override_requested: optionalBooleanValue(
      payload.credit_limit_override_requested,
      'طلب تجاوز الحد الائتماني',
    ),

    admin_username: optionalStringValue(
      payload.admin_username,
      'اسم مستخدم المدير',
      128,
    ),

    admin_password: optionalStringValue(
      payload.admin_password,
      'كلمة مرور المدير',
      256,
    ),
  }
}

function normalizeSaleUpdateInput(input: unknown) {
  const payload = requireObjectInput(input, 'بيانات تعديل فاتورة البيع')

  return {
    ...normalizeSaleWriteInput(payload),

    sale_id: requirePositiveInteger(payload.sale_id, 'رقم فاتورة البيع'),

    reason: requireTrimmedString(payload.reason, 'سبب تعديل فاتورة البيع', 500),
  }
}

function normalizeHeldSaleInput(input: unknown) {
  const payload = requireObjectInput(input, 'بيانات الفاتورة المعلقة')

  const rawItems = requireArrayInput(
    payload.items,
    'أصناف الفاتورة المعلقة',
    500,
  )

  if (rawItems.length === 0) {
    throw new Error('لا يمكن تعليق فاتورة فارغة')
  }

  const discountType =
    payload.discount_type === undefined ||
    payload.discount_type === null ||
    payload.discount_type === ''
      ? 'amount'
      : requireEnumValue(
          payload.discount_type,
          HELD_SALE_DISCOUNT_TYPES,
          'نوع خصم الفاتورة المعلقة',
        )

  const discountValue =
    discountType === 'amount'
      ? (optionalNonNegativeMoney(
          payload.discount_value,
          'قيمة خصم الفاتورة المعلقة',
        ) ?? 0)
      : (optionalNonNegativeNumber(
          payload.discount_value,
          'نسبة خصم الفاتورة المعلقة',
        ) ?? 0)

  if (discountType === 'percent' && discountValue > 100) {
    throw new Error('نسبة الخصم لا يمكن أن تتجاوز 100%')
  }

  return {
    customer_id: optionalPositiveInteger(payload.customer_id, 'رقم العميل'),

    title: optionalTrimmedString(payload.title, 'اسم الفاتورة المعلقة', 200),

    discount_type: discountType,

    discount_value: discountValue,

    notes: optionalTrimmedString(
      payload.notes,
      'ملاحظات الفاتورة المعلقة',
      2000,
    ),

    items: rawItems.map((rawItem) => {
      const item = requireObjectInput(rawItem, 'بيانات صنف الفاتورة المعلقة')

      return {
        variant_id: requirePositiveInteger(
          item.variant_id,
          'رقم صنف الفاتورة المعلقة',
        ),

        quantity: requirePositiveNumber(
          item.quantity,
          'كمية صنف الفاتورة المعلقة',
        ),
      }
    }),
  }
}

function normalizeHeldSaleDeleteInput(input: unknown) {
  const payload = requireObjectInput(input, 'بيانات حذف الفاتورة المعلقة')

  return {
    held_sale_id: requirePositiveInteger(
      payload.held_sale_id,
      'رقم الفاتورة المعلقة',
    ),

    mode: requireEnumValue(
      payload.mode,
      HELD_SALE_DELETE_MODES,
      'وضع حذف الفاتورة المعلقة',
    ),
  }
}

function normalizeSaleReturnInput(input: unknown) {
  const payload = requireObjectInput(input, 'بيانات مرتجع البيع')

  const rawItems = requireArrayInput(payload.items, 'أصناف مرتجع البيع', 500)

  if (rawItems.length === 0) {
    throw new Error('لا توجد أصناف للمرتجع')
  }

  return {
    original_sale_id: requirePositiveInteger(
      payload.original_sale_id,
      'رقم الفاتورة الأصلية',
    ),

    reason: optionalTrimmedString(payload.reason, 'سبب المرتجع', 500),

    refund_payment_method: optionalEnumValue(
      payload.refund_payment_method,
      SALE_PAYMENT_ENTRY_METHOD_VALUES,
      'طريقة رد قيمة المرتجع',
    ),

    items: rawItems.map((rawItem) => {
      const item = requireObjectInput(rawItem, 'بيانات صنف المرتجع')

      return {
        sale_item_id: requirePositiveInteger(
          item.sale_item_id,
          'رقم بند الفاتورة',
        ),

        variant_id: requirePositiveInteger(item.variant_id, 'رقم صنف المرتجع'),

        quantity: requirePositiveNumber(item.quantity, 'كمية المرتجع'),
      }
    }),
  }
}

function normalizeSaleExchangeInput(input: unknown) {
  const payload = requireObjectInput(input, 'بيانات استبدال البيع')

  const rawItems = requireArrayInput(payload.items, 'أصناف الاستبدال', 500)

  if (rawItems.length === 0) {
    throw new Error('لا توجد أصناف للاستبدال')
  }

  return {
    original_sale_id: requirePositiveInteger(
      payload.original_sale_id,
      'رقم الفاتورة الأصلية',
    ),

    payment_method: optionalEnumValue(
      payload.payment_method,
      SALE_PAYMENT_ENTRY_METHOD_VALUES,
      'طريقة دفع فرق الاستبدال',
    ),

    reason: optionalTrimmedString(payload.reason, 'سبب الاستبدال', 500),

    items: rawItems.map((rawItem) => {
      const item = requireObjectInput(rawItem, 'بيانات صنف الاستبدال')

      return {
        promotion_unit_id: requirePositiveInteger(
          item.promotion_unit_id,
          'رقم قطعة الاستبدال',
        ),

        new_variant_id: requirePositiveInteger(
          item.new_variant_id,
          'رقم الصنف البديل',
        ),
      }
    }),
  }
}

function normalizeSaleCancellationInput(input: unknown) {
  const payload = requireObjectInput(input, 'بيانات إلغاء فاتورة البيع')

  return {
    sale_id: requirePositiveInteger(payload.sale_id, 'رقم فاتورة البيع'),

    reason: optionalTrimmedString(
      payload.reason,
      'سبب إلغاء فاتورة البيع',
      500,
    ),

    admin_username: optionalStringValue(
      payload.admin_username,
      'اسم مستخدم المدير',
      128,
    ),

    admin_password: optionalStringValue(
      payload.admin_password,
      'كلمة مرور المدير',
      256,
    ),
  }
}

function normalizeSaleReturnCancellationInput(input: unknown) {
  const payload = requireObjectInput(input, 'بيانات إلغاء مرتجع البيع')

  return {
    return_id: requirePositiveInteger(payload.return_id, 'رقم مرتجع البيع'),

    reason: optionalTrimmedString(payload.reason, 'سبب إلغاء مرتجع البيع', 500),

    admin_username: optionalStringValue(
      payload.admin_username,
      'اسم مستخدم المدير',
      128,
    ),

    admin_password: optionalStringValue(
      payload.admin_password,
      'كلمة مرور المدير',
      256,
    ),
  }
}

function normalizeSaleExchangeCancellationInput(input: unknown) {
  const payload = requireObjectInput(input, 'بيانات إلغاء الاستبدال')

  return {
    exchange_id: requirePositiveInteger(
      payload.exchange_id,
      'رقم عملية الاستبدال',
    ),

    reason: optionalTrimmedString(payload.reason, 'سبب إلغاء الاستبدال', 500),

    admin_username: optionalStringValue(
      payload.admin_username,
      'اسم مستخدم المدير',
      128,
    ),

    admin_password: optionalStringValue(
      payload.admin_password,
      'كلمة مرور المدير',
      256,
    ),
  }
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

    input = normalizeSaleWriteInput(input)

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

    input = normalizeHeldSaleInput(input)

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
      held_sale_id: requirePositiveInteger(heldSaleId, 'رقم الفاتورة المعلقة'),

      actor_id: actor.id,

      is_admin: actor.role === 'admin',
    })

    return protectSalesCostData(actor, result)
  })

  ipcMain.handle('sales:delete-held', (event, input) => {
    const actor = requirePermission(event, 'sales.use')
    input = normalizeHeldSaleDeleteInput(input)
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
      input = normalizeSaleUpdateInput(input)

      const saleId = input.sale_id

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

    const result = getSaleReceipt(
      requirePositiveInteger(saleId, 'رقم فاتورة البيع'),
    )

    return protectSalesCostData(actor, result)
  })

  ipcMain.handle('sales:current-state', (event, saleId: number) => {
    const actor = requirePermission(event, 'sales.history')

    const result = getSaleCurrentState(
      requirePositiveInteger(saleId, 'رقم فاتورة البيع'),
    )

    return protectSalesCostData(actor, result)
  })

  ipcMain.handle('sales:return-history', (event, saleId: number) => {
    requirePermission(event, 'sales.history')

    return getSaleReturnHistory(
      requirePositiveInteger(saleId, 'رقم فاتورة البيع'),
    )
  })

  ipcMain.handle('sales:exchange-state', (event, saleId: number) => {
    const actor = requirePermission(event, 'sales.history')

    const result = getSaleExchangeState(
      requirePositiveInteger(saleId, 'رقم فاتورة البيع'),
    )

    return protectSalesCostData(actor, result)
  })

  ipcMain.handle('sales:exchange', (event, input) => {
    const actor = requirePermission(event, 'sales.exchanges')

    input = normalizeSaleExchangeInput(input)

    if (actor.role !== 'admin' && input.payment_method === 'store_safe') {
      throw new Error('الخزنة الآمنة متاحة لمدير النظام فقط')
    }

    const actorId = actor.id

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
      input = normalizeSaleExchangeCancellationInput(input)
      const access = getSaleExchangeCancellationAccess(
        input.exchange_id,

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
            exchange_id: input.exchange_id,

            reason: input.reason,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          approved_by: approvedBy,

          action: 'sale_exchange_cancelled',

          entity: 'sale_exchanges',

          entity_id: input.exchange_id,

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
    const actor = requirePermission(event, 'sales.returns')

    input = normalizeSaleReturnInput(input)

    if (
      actor.role !== 'admin' &&
      input.refund_payment_method === 'store_safe'
    ) {
      throw new Error('الخزنة الآمنة متاحة لمدير النظام فقط')
    }

    const actorId = actor.id

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
      input = normalizeSaleCancellationInput(input)
      const access = getSaleCancellationAccess(input.sale_id, actorId)

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
            sale_id: input.sale_id,

            reason: input.reason,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          approved_by: approvedBy,

          action: 'sale_cancelled',

          entity: 'sales',

          entity_id: input.sale_id,

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
      input = normalizeSaleReturnCancellationInput(input)
      const access = getSaleReturnCancellationAccess(input.return_id, actorId)

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
            return_id: input.return_id,

            reason: input.reason,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          approved_by: approvedBy,

          action: 'sale_return_cancelled',

          entity: 'sale_returns',

          entity_id: input.return_id,

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
