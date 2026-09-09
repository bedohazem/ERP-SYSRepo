import { useEffect, useState } from 'react'
import { useAuthStore } from '../../store/auth.store'
import {
  CASH_ACCOUNT_OPTIONS,
  getPaymentMethodLabel,
} from '../../utils/payment-method'

import { printSaleReceiptHtml } from '../../utils/receiptPrint'
import { printSaleExchangeReceiptHtml } from '../../utils/exchangeReceiptPrint'
import FinancialCancelModal from '../../components/FinancialCancelModal'
import SaleExchangeModal from '../../components/SaleExchangeModal'

import { getActiveSaleReturnHistory } from '../../utils/sale-return-history'

type SaleRow = {
  id: number
  customer_name?: string | null
  customer_phone?: string | null
  cashier_name?: string | null
  sub_total: number
  discount_value: number
  promotion_id?: number | null
  promotion_name?: string | null
  promotion_discount_value?: number
  loyalty_discount_value: number
  grand_total: number
  paid: number
  remaining_amount: number
  payment_status: string
  change_amount: number
  payment_method: string
  loyalty_points_earned: number
  loyalty_points_redeemed: number
  created_at: string
  items_count: number
  total_quantity: number
  returned_quantity: number
  return_count: number
  total_return_amount: number
  cancelled_at?: string | null
  cancelled_by?: number | null
  cancel_reason?: string | null
  user_id?: number | null
  requires_admin_password?: number | boolean
  original_sub_total?: number
  original_grand_total?: number

  total_discount_value?: number

  current_net_total?: number
  current_paid_amount?: number

  exchange_count?: number
  cancelled_exchange_count?: number
  exchange_difference_total?: number
}

type InvoicesTab = 'sales' | 'returns' | 'exchanges'

type ExchangeItemRow = {
  id: number

  exchange_id: number

  promotion_unit_id: number

  old_variant_id: number
  new_variant_id: number

  old_unit_price: number
  new_unit_price: number

  old_is_gift: number
  new_is_gift: number

  quantity: number

  old_product_name: string

  old_size?: string | null
  old_color?: string | null

  new_product_name: string

  new_size?: string | null
  new_color?: string | null
}

type ExchangeRow = {
  id: number

  code: string

  original_sale_id: number

  user_id?: number | null

  promotion_group_id: string

  old_group_total: number
  new_group_total: number

  difference_amount: number

  cash_collection_amount: number

  debt_reduction_amount: number

  cash_refund_amount: number

  loyalty_earned_points_adjustment: number

  loyalty_redeemed_points_adjustment: number

  payment_method: string

  reason?: string | null

  business_date?: string | null

  accounting_date: string

  created_at: string

  cancelled_at?: string | null

  cancelled_by?: number | null

  cancel_reason?: string | null

  cancelled_by_name?: string | null

  customer_name?: string | null

  customer_phone?: string | null

  cashier_name?: string | null

  items_count: number

  total_quantity: number

  requires_admin_password?: number | boolean

  can_cancel: boolean

  cancel_block_reason?: string | null

  items: ExchangeItemRow[]
}

type ReturnRow = {
  id: number
  code: string
  original_sale_id: number
  customer_name?: string | null
  customer_phone?: string | null
  cashier_name?: string | null
  sub_total: number
  loyalty_discount_value: number
  refund_amount: number
  payment_method: string
  reason?: string | null
  loyalty_points_reversed: number
  created_at: string
  items_count: number
  total_quantity: number
  cancelled_at?: string | null
  cancelled_by?: number | null
  cancel_reason?: string | null
  user_id?: number | null
  requires_admin_password?: number | boolean
}

type ReceiptData = {
  sale: any
  items: any[]
  loyalty: any[]

  original_receipt?: {
    sale: any
    items: any[]
    loyalty: any[]
  }

  financials?: any

  exchanges?: any[]
}

type StoreReceiptInfo = {
  app_name?: string
  app_logo_url?: string
  store_phone?: string
  store_address?: string
  store_qr_enabled?: boolean
  store_qr_title?: string
  store_qr_primary_url?: string
}

type ReturnDraftSourceItem = {
  sale_item_id: number
  variant_id: number
  quantity: number
}

type ReturnBundleUnit = {
  id: number
  original_sale_item_id: number

  current_variant_id: number
  current_unit_price: number
  current_is_gift: number

  is_returned: number

  current_product_name: string
  current_size?: string | null
  current_color?: string | null
}

type ReturnDraftItem = {
  sale_item_id: number
  variant_id: number

  product_name: string
  size?: string | null
  color?: string | null

  sold_quantity: number
  returned_quantity: number
  returnable_quantity: number
  return_quantity: number

  unit_price: number
  promotion_discount_value: number

  is_promotion_bundle?: boolean

  promotion_group_id?: string | null

  source_items?: ReturnDraftSourceItem[]

  bundle_units?: ReturnBundleUnit[]
}

const INVOICE_PAGE_SIZE = 50

function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2))
}

async function loadCurrentReceiptData(saleId: number): Promise<ReceiptData> {
  const state = await window.api.getSaleCurrentState(saleId)

  return {
    ...state.current_receipt,

    original_receipt: state.original_receipt,

    financials: state.financials,

    exchanges: state.exchanges,
  }
}

function mapReceiptItemToReturnDraft(item: any): ReturnDraftItem {
  const soldQty = Number(item.quantity || 0)

  const returnedQty = Number(item.returned_quantity || 0)

  const returnableQty = Math.max(0, soldQty - returnedQty)

  return {
    sale_item_id: Number(item.id),

    variant_id: Number(item.variant_id),

    product_name: String(item.product_name || ''),

    size: item.size ?? null,
    color: item.color ?? null,

    sold_quantity: soldQty,
    returned_quantity: returnedQty,
    returnable_quantity: returnableQty,

    return_quantity: 0,

    unit_price: Number(item.unit_price || 0),

    promotion_discount_value: Number(item.promotion_discount_value || 0),

    is_promotion_bundle: false,

    promotion_group_id: item.promotion_group_id ?? null,
  }
}

function buildReturnDraftItems(
  receipt: ReceiptData,
  exchangeState: any | null,
): ReturnDraftItem[] {
  const receiptItems = Array.isArray(receipt.items) ? receipt.items : []

  if (
    !exchangeState ||
    exchangeState.snapshot?.promotion_type !== 'buy_x_get_y'
  ) {
    return receiptItems.map(mapReceiptItemToReturnDraft)
  }

  const groups = Array.isArray(exchangeState.groups) ? exchangeState.groups : []

  if (groups.length === 0) {
    throw new Error('بيانات العرض الحالية غير موجودة ولا يمكن تجهيز المرتجع')
  }

  const handledGroupIds = new Set<string>()

  const bundleDrafts: ReturnDraftItem[] = []

  groups.forEach((group: any, groupIndex: number) => {
    const groupId = String(group.promotion_group_id || '')

    const units = Array.isArray(group.units) ? group.units : []

    if (!groupId || units.length === 0) {
      throw new Error('بيانات إحدى مجموعات العرض غير مكتملة')
    }

    const sourceItems = receiptItems.filter(
      (item: any) => String(item.promotion_group_id || '') === groupId,
    )

    if (sourceItems.length === 0) {
      throw new Error('تعذر ربط العرض بأصناف الفاتورة الأصلية')
    }

    const sourceQuantity = sourceItems.reduce(
      (total: number, item: any) => total + Number(item.quantity || 0),
      0,
    )

    if (sourceQuantity !== units.length) {
      throw new Error('عدد قطع العرض الحالية لا يطابق الفاتورة الأصلية')
    }

    handledGroupIds.add(groupId)

    const hasReturnedUnit = units.some(
      (unit: any) => Number(unit.is_returned || 0) === 1,
    )

    const grossTotal = roundMoney(
      units.reduce(
        (total: number, unit: any) =>
          total + Number(unit.current_unit_price || 0),
        0,
      ),
    )

    const promotionDiscount = roundMoney(
      units.reduce(
        (total: number, unit: any) =>
          total +
          (Number(unit.current_is_gift || 0) === 1
            ? Number(unit.current_unit_price || 0)
            : 0),
        0,
      ),
    )

    bundleDrafts.push({
      /*
       * IDs الحقيقية موجبة.
       * نستخدم ID سالب للصف الصناعي
       * الخاص بالـBundle داخل الواجهة فقط.
       */
      sale_item_id: -(groupIndex + 1),

      variant_id: 0,

      product_name: `عرض ${groupIndex + 1}`,

      size: null,
      color: null,

      /*
       * الـBundle يعامل كوحدة واحدة
       * في شاشة المرتجع:
       * 0 = لا يرجع
       * 1 = يرجع كاملًا
       */
      sold_quantity: 1,

      returned_quantity: hasReturnedUnit ? 1 : 0,

      returnable_quantity: hasReturnedUnit ? 0 : 1,

      return_quantity: 0,

      /*
       * نخزن Gross المجموعة هنا،
       * ونخزن قيمة الهدية كخصم العرض.
       * بذلك حساب Preview الحالي يظل
       * مطابقًا لمنطق الـBackend.
       */
      unit_price: grossTotal,

      promotion_discount_value: promotionDiscount,

      is_promotion_bundle: true,

      promotion_group_id: groupId,

      source_items: sourceItems.map((item: any) => ({
        sale_item_id: Number(item.id),

        variant_id: Number(item.variant_id),

        quantity: Number(item.quantity || 0),
      })),

      bundle_units: units.map((unit: any) => ({
        id: Number(unit.id),

        original_sale_item_id: Number(unit.original_sale_item_id),

        current_variant_id: Number(unit.current_variant_id),

        current_unit_price: Number(unit.current_unit_price || 0),

        current_is_gift: Number(unit.current_is_gift || 0),

        is_returned: Number(unit.is_returned || 0),

        current_product_name: String(unit.current_product_name || ''),

        current_size: unit.current_size ?? null,

        current_color: unit.current_color ?? null,
      })),
    })
  })

  const regularDrafts = receiptItems
    .filter((item: any) => {
      const groupId = item.promotion_group_id

      if (!groupId) {
        return true
      }

      return !handledGroupIds.has(String(groupId))
    })
    .map(mapReceiptItemToReturnDraft)

  return [...bundleDrafts, ...regularDrafts]
}

export default function InvoicesPage() {
  const [rows, setRows] = useState<SaleRow[]>([])
  const [total, setTotal] = useState(0)
  const [salesPage, setSalesPage] = useState(1)
  const [activeTab, setActiveTab] = useState<InvoicesTab>('sales')
  const [returnRows, setReturnRows] = useState<ReturnRow[]>([])
  const [returnsTotal, setReturnsTotal] = useState(0)
  const [returnsPage, setReturnsPage] = useState(1)
  const [returnsLoading, setReturnsLoading] = useState(false)

  const [exchangeRows, setExchangeRows] = useState<ExchangeRow[]>([])

  const [exchangesTotal, setExchangesTotal] = useState(0)

  const [exchangesPage, setExchangesPage] = useState(1)

  const [exchangesLoading, setExchangesLoading] = useState(false)

  const [exchangeStatusFilter, setExchangeStatusFilter] = useState<
    'all' | 'active' | 'cancelled'
  >('all')

  const [selectedExchange, setSelectedExchange] = useState<ExchangeRow | null>(
    null,
  )

  const [cancelExchangeTarget, setCancelExchangeTarget] =
    useState<ExchangeRow | null>(null)

  const [cancelExchangeReason, setCancelExchangeReason] = useState('')

  const [cancelExchangePassword, setCancelExchangePassword] = useState('')

  const [cancellingExchange, setCancellingExchange] = useState(false)

  const [search, setSearch] = useState('')

  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid'>(
    'all',
  )

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptData | null>(
    null,
  )
  const [selectedReturnHistory, setSelectedReturnHistory] = useState<any[]>([])
  const [message, setMessage] = useState('')
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const [cancelSaleTarget, setCancelSaleTarget] = useState<SaleRow | null>(null)

  const [cancelSaleReason, setCancelSaleReason] = useState('')

  const [cancelSalePassword, setCancelSalePassword] = useState('')

  const [cancellingSale, setCancellingSale] = useState(false)

  const [cancelReturnTarget, setCancelReturnTarget] =
    useState<ReturnRow | null>(null)

  const [cancelReturnReason, setCancelReturnReason] = useState('')

  const [cancelReturnPassword, setCancelReturnPassword] = useState('')

  const [cancellingReturn, setCancellingReturn] = useState(false)
  const [returnReceipt, setReturnReceipt] = useState<ReceiptData | null>(null)
  const [returnItems, setReturnItems] = useState<ReturnDraftItem[]>([])
  const [returnReason, setReturnReason] = useState('')
  const [returnRefundAccount, setReturnRefundAccount] = useState('store_cash')
  const [savingReturn, setSavingReturn] = useState(false)
  const [exchangeSaleId, setExchangeSaleId] = useState<number | null>(null)

  async function loadInvoices(page = salesPage) {
    setLoading(true)

    try {
      const safePage = Math.max(1, Number(page || 1))

      const result = await window.api.listSales({
        search,

        payment_filter: paymentFilter,

        date_from: dateFrom || undefined,

        date_to: dateTo || undefined,

        actor_id: user?.id ?? null,

        limit: INVOICE_PAGE_SIZE,

        offset: (safePage - 1) * INVOICE_PAGE_SIZE,
      })

      setRows(Array.isArray(result.rows) ? result.rows : [])
      setTotal(Number(result.total || 0))
    } catch (error) {
      console.error('Failed to load invoices:', error)
      setMessage('حدث خطأ أثناء تحميل الفواتير')
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  async function loadReturns(page = returnsPage) {
    setReturnsLoading(true)

    try {
      const safePage = Math.max(1, Number(page || 1))

      const result = await window.api.listSaleReturns({
        search,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        actor_id: user?.id ?? null,
        limit: INVOICE_PAGE_SIZE,
        offset: (safePage - 1) * INVOICE_PAGE_SIZE,
      })

      setReturnRows(Array.isArray(result.rows) ? result.rows : [])
      setReturnsTotal(Number(result.total || 0))
    } catch (error) {
      console.error('Failed to load returns:', error)
      setMessage('حدث خطأ أثناء تحميل سجل المرتجعات')
      setReturnRows([])
      setReturnsTotal(0)
    } finally {
      setReturnsLoading(false)
    }
  }

  async function loadExchanges(page = exchangesPage) {
    setExchangesLoading(true)

    try {
      const safePage = Math.max(1, Number(page || 1))

      const result = await window.api.listSaleExchanges({
        search,

        date_from: dateFrom || undefined,

        date_to: dateTo || undefined,

        status: exchangeStatusFilter,

        actor_id: user?.id ?? null,

        limit: INVOICE_PAGE_SIZE,

        offset: (safePage - 1) * INVOICE_PAGE_SIZE,
      })

      setExchangeRows(Array.isArray(result.rows) ? result.rows : [])

      setExchangesTotal(Number(result.total || 0))
    } catch (error) {
      console.error('Failed to load exchanges:', error)

      setMessage('حدث خطأ أثناء تحميل سجل الاستبدالات')

      setExchangeRows([])
      setExchangesTotal(0)
    } finally {
      setExchangesLoading(false)
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      setSalesPage(1)

      setReturnsPage(1)

      setExchangesPage(1)

      void Promise.all([loadInvoices(1), loadReturns(1), loadExchanges(1)])
    }, 250)

    return () => clearTimeout(handle)
  }, [search, dateFrom, dateTo, paymentFilter, exchangeStatusFilter])

  useEffect(() => {
    if (!message) return

    const timer = window.setTimeout(() => {
      setMessage('')
    }, 1800)

    return () => {
      window.clearTimeout(timer)
    }
  }, [message])

  async function openReceipt(saleId: number) {
    try {
      const [receipt, history] = await Promise.all([
        loadCurrentReceiptData(saleId),

        window.api.getSaleReturnHistory(saleId),
      ])
      setSelectedReceipt(receipt)

      setSelectedReturnHistory(getActiveSaleReturnHistory(history))
    } catch (error) {
      console.error('Failed to open receipt:', error)
      setMessage('حدث خطأ أثناء فتح الفاتورة')
    }
  }

  async function printReceipt(receipt: ReceiptData, returnHistory: any[] = []) {
    await printSaleReceiptHtml({
      receipt,

      returnHistory: getActiveSaleReturnHistory(returnHistory),
      onBlocked: () => setMessage('لم يتم فتح نافذة الطباعة'),
    })
  }

  function resolveRefundAccountFromPaymentMethod(method?: string | null) {
    switch (method) {
      case 'store_cash':
      case 'owner_cash':
      case 'owner_bank':
      case 'owner_vodafone':
      case 'fawry_machine':
        return method

      case 'cash':
        return 'store_cash'

      case 'card':
        return 'fawry_machine'

      case 'wallet':
        return 'owner_vodafone'

      case 'bank':
      case 'bank_transfer':
        return 'owner_bank'

      default:
        return 'store_cash'
    }
  }

  function getErrorMessage(error: unknown, fallback: string) {
    const raw =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : ''

    const match = raw.match(
      /Error invoking remote method '[^']+': Error: (.*)$/,
    )

    return match?.[1] || raw || fallback
  }

  async function openReturnPopup(saleId: number) {
    try {
      const receipt = await window.api.getSaleReceipt(saleId)

      let exchangeState: any | null = null

      if (Number(receipt.sale?.promotion_id || 0) > 0) {
        try {
          const state = await window.api.getSaleExchangeState(saleId)

          if (state.snapshot?.promotion_type === 'buy_x_get_y') {
            exchangeState = state
          }
        } catch (exchangeError) {
          const exchangeMessage = getErrorMessage(
            exchangeError,
            'تعذر قراءة حالة العرض',
          )

          /*
           * الفواتير القديمة قبل إضافة
           * Promotion Snapshot تستمر
           * بالـlegacy return UI.
           */
          if (!exchangeMessage.includes('نسخة محفوظة')) {
            throw exchangeError
          }
        }
      }

      const draftItems = buildReturnDraftItems(receipt, exchangeState)

      setReturnReceipt(receipt)

      setReturnReason('')

      setReturnRefundAccount(
        resolveRefundAccountFromPaymentMethod(receipt.sale?.payment_method),
      )

      setReturnItems(draftItems)
    } catch (error) {
      console.error('Failed to open return popup:', error)

      setMessage(getErrorMessage(error, 'حدث خطأ أثناء فتح المرتجع'))
    }
  }

  function updateReturnQty(saleItemId: number, qty: number) {
    setReturnItems((prev) =>
      prev.map((item) =>
        item.sale_item_id === saleItemId
          ? {
              ...item,
              return_quantity: Math.max(
                0,
                Math.min(Number(qty || 0), item.returnable_quantity),
              ),
            }
          : item,
      ),
    )
  }

  async function submitReturn() {
    if (savingReturn) return

    if (!user?.id) {
      setMessage('المستخدم غير مسجل')
      return
    }

    if (!returnReceipt?.sale?.id) {
      setMessage('الفاتورة الأصلية غير موجودة')
      return
    }

    const rawSelectedItems = returnItems
      .filter((item) => item.return_quantity > 0)
      .flatMap((item) => {
        if (item.is_promotion_bundle) {
          return (item.source_items || []).map((sourceItem) => ({
            sale_item_id: sourceItem.sale_item_id,

            variant_id: sourceItem.variant_id,

            quantity: sourceItem.quantity,
          }))
        }

        return [
          {
            sale_item_id: item.sale_item_id,

            variant_id: item.variant_id,

            quantity: item.return_quantity,
          },
        ]
      })

    const selectedItems = Array.from(
      new Map(
        rawSelectedItems.map((item) => [item.sale_item_id, item]),
      ).values(),
    )

    if (selectedItems.length === 0) {
      setMessage('اختار كمية مرتجع أولا')
      return
    }

    setSavingReturn(true)

    try {
      const result = await window.api.createSaleReturn({
        original_sale_id: Number(returnReceipt.sale.id),
        user_id: Number(user.id),
        reason: returnReason.trim() || null,
        refund_payment_method: returnRefundAccount,
        items: selectedItems,
      })

      setMessage(
        `تم عمل مرتجع ${result.returnCode || `RET-${String(result.returnSaleId).padStart(5, '0')}`}`,
      )
      setReturnReceipt(null)
      setReturnItems([])
      setReturnReason('')
      setReturnRefundAccount('store_cash')
      await loadInvoices(salesPage)
      await loadReturns(returnsPage)

      if (returnReceipt?.sale?.id) {
        const saleId = Number(returnReceipt.sale.id)

        const [receipt, history] = await Promise.all([
          loadCurrentReceiptData(saleId),

          window.api.getSaleReturnHistory(saleId),
        ])

        setSelectedReceipt(receipt)

        setSelectedReturnHistory(getActiveSaleReturnHistory(history))
      }
    } catch (error) {
      console.error('Failed to create return:', error)
      setMessage(getErrorMessage(error, 'حدث خطأ أثناء حفظ المرتجع'))
    } finally {
      setSavingReturn(false)
    }
  }

  async function confirmCancelSale() {
    if (!cancelSaleTarget || cancellingSale) return

    setCancellingSale(true)

    try {
      const result = await window.api.cancelSaleInvoice({
        sale_id: cancelSaleTarget.id,
        reason:
          cancelSaleReason.trim() || `إلغاء فاتورة بيع #${cancelSaleTarget.id}`,
        actor_id: user?.id ?? null,
        admin_password: cancelSalePassword,
      })

      if (!result?.success) {
        if (result?.message?.includes('اكتب كلمة مرور المدير')) {
          setCancelSaleTarget((prev) =>
            prev
              ? {
                  ...prev,
                  requires_admin_password: true,
                }
              : prev,
          )
        }
        setMessage(result?.message || 'تعذر إلغاء فاتورة البيع')
        return
      }

      setCancelSaleTarget(null)
      setCancelSaleReason('')
      setCancelSalePassword('')
      setSelectedReceipt(null)

      setMessage(`تم إلغاء فاتورة #${cancelSaleTarget.id}`)

      await Promise.all([loadInvoices(salesPage), loadReturns(returnsPage)])
    } finally {
      setCancellingSale(false)
    }
  }

  async function confirmCancelReturn() {
    if (!cancelReturnTarget || cancellingReturn) return

    setCancellingReturn(true)

    try {
      const result = await window.api.cancelSaleReturn({
        return_id: cancelReturnTarget.id,
        reason:
          cancelReturnReason.trim() ||
          `إلغاء المرتجع ${cancelReturnTarget.code}`,
        actor_id: user?.id ?? null,
        admin_password: cancelReturnPassword,
      })

      if (!result?.success) {
        if (result?.message?.includes('اكتب كلمة مرور المدير')) {
          setCancelReturnTarget((prev) =>
            prev
              ? {
                  ...prev,
                  requires_admin_password: true,
                }
              : prev,
          )
        }
        setMessage(result?.message || 'تعذر إلغاء مرتجع البيع')
        return
      }

      setCancelReturnTarget(null)
      setCancelReturnReason('')
      setCancelReturnPassword('')
      setSelectedReceipt(null)

      setMessage(`تم إلغاء المرتجع ${cancelReturnTarget.code}`)

      await Promise.all([loadInvoices(salesPage), loadReturns(returnsPage)])
    } finally {
      setCancellingReturn(false)
    }
  }

  async function confirmCancelExchange() {
    if (!cancelExchangeTarget || cancellingExchange) {
      return
    }

    setCancellingExchange(true)

    try {
      const result = await window.api.cancelSaleExchange({
        exchange_id: cancelExchangeTarget.id,

        reason:
          cancelExchangeReason.trim() ||
          `إلغاء الاستبدال ${cancelExchangeTarget.code}`,

        actor_id: user?.id ?? null,

        admin_password: cancelExchangePassword,
      })

      if (!result?.success) {
        if (result?.message?.includes('اكتب كلمة مرور المدير')) {
          setCancelExchangeTarget((prev) =>
            prev
              ? {
                  ...prev,

                  requires_admin_password: true,
                }
              : prev,
          )
        }

        setMessage(result?.message || 'تعذر إلغاء عملية الاستبدال')

        return
      }

      const code = cancelExchangeTarget.code

      setCancelExchangeTarget(null)

      setCancelExchangeReason('')

      setCancelExchangePassword('')

      setSelectedExchange(null)

      setSelectedReceipt(null)

      setMessage(`تم إلغاء الاستبدال ${code}`)

      await Promise.all([
        loadInvoices(salesPage),

        loadReturns(returnsPage),

        loadExchanges(exchangesPage),
      ])
    } finally {
      setCancellingExchange(false)
    }
  }

  const returnGrossTotal = roundMoney(
    returnItems.reduce(
      (sum, item) => sum + item.return_quantity * item.unit_price,
      0,
    ),
  )

  const previousReturnGrossTotal = roundMoney(
    returnItems.reduce(
      (sum, item) => sum + item.returned_quantity * item.unit_price,
      0,
    ),
  )

  const previousPromotionDiscount = roundMoney(
    returnItems.reduce((sum, item) => {
      const soldQty = Math.max(0, Number(item.sold_quantity || 0))

      if (soldQty <= 0) {
        return sum
      }

      const returnedQty = Math.min(
        soldQty,
        Math.max(0, Number(item.returned_quantity || 0)),
      )

      const originalItemPromotion = Math.max(
        0,
        Number(item.promotion_discount_value || 0),
      )

      return sum + roundMoney(originalItemPromotion * (returnedQty / soldQty))
    }, 0),
  )

  const returnPromotionDiscountShare = roundMoney(
    returnItems.reduce((sum, item) => {
      const soldQty = Math.max(0, Number(item.sold_quantity || 0))

      if (soldQty <= 0 || item.return_quantity <= 0) {
        return sum
      }

      const previousQty = Math.min(
        soldQty,
        Math.max(0, Number(item.returned_quantity || 0)),
      )

      const cumulativeQty = Math.min(
        soldQty,
        previousQty + Math.max(0, Number(item.return_quantity || 0)),
      )

      const originalItemPromotion = Math.max(
        0,
        Number(item.promotion_discount_value || 0),
      )

      const previousTarget = roundMoney(
        originalItemPromotion * (previousQty / soldQty),
      )

      const cumulativeTarget = roundMoney(
        originalItemPromotion * (cumulativeQty / soldQty),
      )

      return sum + Math.max(0, cumulativeTarget - previousTarget)
    }, 0),
  )

  const originalSaleSubTotal = Number(returnReceipt?.sale?.sub_total || 0)

  const originalPromotionDiscount = Math.max(
    0,
    Number(returnReceipt?.sale?.promotion_discount_value || 0),
  )

  const originalAfterPromotion = Math.max(
    0,
    originalSaleSubTotal - originalPromotionDiscount,
  )

  const previousAfterPromotion = Math.max(
    0,
    previousReturnGrossTotal - previousPromotionDiscount,
  )

  const returnAfterPromotion = Math.max(
    0,
    returnGrossTotal - returnPromotionDiscountShare,
  )

  const cumulativeAfterPromotion = previousAfterPromotion + returnAfterPromotion

  const originalNormalDiscount = Math.max(
    0,
    Number(returnReceipt?.sale?.discount_value || 0),
  )

  const previousNormalTarget =
    originalAfterPromotion > 0
      ? roundMoney(
          originalNormalDiscount *
            Math.min(previousAfterPromotion / originalAfterPromotion, 1),
        )
      : 0

  const cumulativeNormalTarget =
    originalAfterPromotion > 0
      ? roundMoney(
          originalNormalDiscount *
            Math.min(cumulativeAfterPromotion / originalAfterPromotion, 1),
        )
      : 0

  const returnDiscountShare = Math.max(
    0,
    roundMoney(cumulativeNormalTarget - previousNormalTarget),
  )

  const currentBeforeLoyalty = Math.max(
    0,
    returnAfterPromotion - returnDiscountShare,
  )

  const originalBeforeLoyalty = Math.max(
    0,
    originalAfterPromotion - originalNormalDiscount,
  )

  const previousBeforeLoyalty = Math.max(
    0,
    previousAfterPromotion - previousNormalTarget,
  )

  const cumulativeBeforeLoyalty = previousBeforeLoyalty + currentBeforeLoyalty

  const originalLoyaltyDiscount = Math.max(
    0,
    Number(returnReceipt?.sale?.loyalty_discount_value || 0),
  )

  const previousLoyaltyTarget =
    originalBeforeLoyalty > 0
      ? roundMoney(
          originalLoyaltyDiscount *
            Math.min(previousBeforeLoyalty / originalBeforeLoyalty, 1),
        )
      : 0

  const cumulativeLoyaltyTarget =
    originalBeforeLoyalty > 0
      ? roundMoney(
          originalLoyaltyDiscount *
            Math.min(cumulativeBeforeLoyalty / originalBeforeLoyalty, 1),
        )
      : 0

  const returnLoyaltyDiscountShare = Math.max(
    0,
    roundMoney(cumulativeLoyaltyTarget - previousLoyaltyTarget),
  )

  const returnTotal = Math.max(
    0,
    roundMoney(currentBeforeLoyalty - returnLoyaltyDiscountShare),
  )

  const returnDebtReduction = returnReceipt?.sale?.customer_id
    ? Math.min(returnTotal, Number(returnReceipt?.sale?.remaining_amount || 0))
    : 0

  const returnCashRefund = Math.max(0, returnTotal - returnDebtReduction)

  const salesTotalPages = Math.max(1, Math.ceil(total / INVOICE_PAGE_SIZE))

  const returnsTotalPages = Math.max(
    1,
    Math.ceil(returnsTotal / INVOICE_PAGE_SIZE),
  )

  const exchangesTotalPages = Math.max(
    1,

    Math.ceil(exchangesTotal / INVOICE_PAGE_SIZE),
  )

  return (
    <div
      style={{
        display: 'grid',
        gap: '18px',
        height: '100%',
        minHeight: 0,
        gridTemplateRows: 'auto auto minmax(0, 1fr)',
        alignContent: 'stretch',
        width: '100%',
        boxSizing: 'border-box',
        paddingLeft: '28px',
      }}
    >
      {message && (
        <div
          style={{
            position: 'fixed',
            top: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000001,
            padding: '12px 18px',
            borderRadius: '14px',
            background: 'rgba(239,68,68,0.95)',
            color: '#fff',
            fontWeight: 800,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        >
          {message}
        </div>
      )}

      <div
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '18px',
          display: 'grid',
          gap: '14px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '14px',
            flexWrap: 'wrap',
            direction: 'rtl',
          }}
        >
          <div>
            <h2
              style={{
                margin: '0 0 6px',
              }}
            >
              {activeTab === 'sales'
                ? 'سجل الفواتير'
                : activeTab === 'returns'
                  ? 'سجل المرتجعات'
                  : 'سجل الاستبدالات'}
            </h2>

            <p
              style={{
                margin: 0,
                color: '#94a3b8',
                fontWeight: 700,
              }}
            >
              {activeTab === 'sales'
                ? 'عرض الفواتير القديمة وإعادة الطباعة'
                : activeTab === 'returns'
                  ? 'متابعة المرتجعات الفعالة والملغاة'
                  : 'متابعة عمليات الاستبدال والطباعة والإلغاء'}
            </p>
          </div>

          <div style={{ color: '#cbd5e1', fontWeight: 800 }}>
            {activeTab === 'sales'
              ? `عدد الفواتير: ${total}`
              : activeTab === 'returns'
                ? `عدد المرتجعات: ${returnsTotal}`
                : `عدد الاستبدالات: ${exchangesTotal}`}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              activeTab === 'sales'
                ? 'minmax(260px, 1fr) 170px 180px 180px 120px'
                : activeTab === 'exchanges'
                  ? 'minmax(260px, 1fr) 170px 180px 180px 120px'
                  : 'minmax(260px, 1fr) 180px 180px 120px',
            gap: '12px',
            direction: 'rtl',
          }}
        >
          <input
            placeholder={
              activeTab === 'exchanges'
                ? 'بحث برقم الاستبدال / الفاتورة / العميل / الكاشير'
                : activeTab === 'returns'
                  ? 'بحث برقم المرتجع / الفاتورة / العميل / الكاشير'
                  : 'بحث برقم الفاتورة مثل #405 / العميل / الهاتف / الكاشير'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={inputStyle}
          />

          {activeTab === 'sales' && (
            <select
              value={paymentFilter}
              onChange={(e) =>
                setPaymentFilter(e.target.value as 'all' | 'paid' | 'unpaid')
              }
              style={inputStyle}
            >
              <option value="all">كل الفواتير</option>

              <option value="paid">مدفوعة</option>

              <option value="unpaid">غير مدفوعة</option>
            </select>
          )}

          {activeTab === 'exchanges' && (
            <select
              value={exchangeStatusFilter}
              onChange={(e) =>
                setExchangeStatusFilter(
                  e.target.value as 'all' | 'active' | 'cancelled',
                )
              }
              style={inputStyle}
            >
              <option value="all">كل الاستبدالات</option>

              <option value="active">الفعالة</option>

              <option value="cancelled">الملغاة</option>
            </select>
          )}

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={inputStyle}
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={inputStyle}
          />

          <button
            type="button"
            onClick={() => {
              void Promise.all([
                loadInvoices(salesPage),

                loadReturns(returnsPage),

                loadExchanges(exchangesPage),
              ])
            }}
            style={primaryButtonStyle}
          >
            تحديث
          </button>
        </div>
      </div>

      <div
        className="glass-card"
        style={{
          borderRadius: '18px',
          padding: '10px',
          display: 'flex',
          gap: '10px',
          flexWrap: 'wrap',
          direction: 'rtl',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('sales')}
          style={tabButtonStyle(activeTab === 'sales')}
        >
          سجل المبيعات
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('returns')}
          style={tabButtonStyle(activeTab === 'returns')}
        >
          سجل المرتجعات
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('exchanges')}
          style={tabButtonStyle(activeTab === 'exchanges')}
        >
          سجل الاستبدالات
        </button>
      </div>
      {activeTab === 'sales' && (
        <div
          className="glass-card invoice-list-scroll"
          style={{
            padding: '18px',
            borderRadius: '18px',
            overflow: 'auto',
            height: '100%',
            minHeight: 0,
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <h3 style={{ margin: 0 }}>سجل المبيعات</h3>

          <PaginationBar
            page={salesPage}
            totalPages={salesTotalPages}
            totalItems={total}
            pageSize={INVOICE_PAGE_SIZE}
            loading={loading}
            onPageChange={(page) => {
              setSalesPage(page)
              void loadInvoices(page)
            }}
          />

          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              direction: 'rtl',
            }}
          >
            <thead>
              <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                <th style={thStyle}>رقم</th>
                <th style={thStyle}>العميل</th>
                <th style={thStyle}>الكاشير</th>
                <th style={thStyle}>مرتجع / استبدال</th>
                <th style={thStyle}>قبل الخصم</th>
                <th style={thStyle}>الخصم</th>
                <th style={thStyle}>الإجمالي</th>
                <th style={thStyle}>الدفع / النقاط</th>
                <th style={thStyle}>الحالة</th>
                <th style={thStyle}>إجراءات</th>
              </tr>
            </thead>

            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ ...tdStyle, textAlign: 'center' }}>
                    جاري التحميل...
                  </td>
                </tr>
              )}

              {rows.map((sale) => (
                <tr
                  key={sale.id}
                  style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <td style={tdStyle}>#{sale.id}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'grid', gap: '4px' }}>
                      <strong>{sale.customer_name || 'عميل نقدي'}</strong>
                      {sale.customer_phone && (
                        <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                          {sale.customer_phone}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={tdStyle}>{sale.cashier_name || '—'}</td>
                  <td style={tdStyle}>
                    {Number(sale.return_count || 0) > 0 ||
                    Number(sale.exchange_count || 0) > 0 ||
                    Number(sale.cancelled_exchange_count || 0) > 0 ? (
                      <div
                        style={{
                          display: 'grid',
                          gap: '7px',
                          minWidth: '150px',
                        }}
                      >
                        {Number(sale.return_count || 0) > 0 && (
                          <div
                            style={{
                              display: 'grid',
                              gap: '3px',
                            }}
                          >
                            <strong style={{ color: '#fdba74' }}>
                              مرتجع {Number(sale.returned_quantity || 0)} من أصل{' '}
                              {Number(sale.total_quantity || 0)}
                            </strong>

                            <span
                              style={{
                                color: '#94a3b8',
                                fontSize: '12px',
                              }}
                            >
                              عدد المرتجعات: {Number(sale.return_count || 0)}
                            </span>
                          </div>
                        )}

                        {Number(sale.exchange_count || 0) > 0 && (
                          <div
                            style={{
                              display: 'grid',
                              gap: '3px',
                            }}
                          >
                            <strong style={{ color: '#86efac' }}>
                              استبدال
                            </strong>

                            <span
                              style={{
                                color: '#94a3b8',
                                fontSize: '12px',
                              }}
                            >
                              عدد عمليات الاستبدال:{' '}
                              {Number(sale.exchange_count || 0)}
                            </span>
                          </div>
                        )}

                        {Number(sale.cancelled_exchange_count || 0) > 0 && (
                          <div
                            style={{
                              display: 'grid',

                              gap: '3px',
                            }}
                          >
                            <strong
                              style={{
                                color: '#f87171',
                              }}
                            >
                              استبدال ملغي
                            </strong>

                            <span
                              style={{
                                color: '#94a3b8',

                                fontSize: '12px',
                              }}
                            >
                              عدد الملغي:{' '}
                              {Number(sale.cancelled_exchange_count || 0)}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: '#64748b' }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>{money(sale.sub_total)}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'grid', gap: '3px' }}>
                      <strong>
                        {money(
                          sale.total_discount_value ??
                            Number(sale.discount_value || 0) +
                              Number(sale.promotion_discount_value || 0) +
                              Number(sale.loyalty_discount_value || 0),
                        )}
                      </strong>

                      {Number(
                        sale.total_discount_value ??
                          Number(sale.discount_value || 0) +
                            Number(sale.promotion_discount_value || 0) +
                            Number(sale.loyalty_discount_value || 0),
                      ) > 0 && (
                        <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                          عادي: {money(sale.discount_value || 0)}
                          {' / '}
                          عرض: {money(sale.promotion_discount_value || 0)}
                          {' / '}
                          نقاط: {money(sale.loyalty_discount_value || 0)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 900, color: '#6ee7b7' }}>
                    <div
                      style={{ display: 'grid', gap: '4px', minWidth: '120px' }}
                    >
                      <strong>
                        {money(
                          sale.current_net_total ??
                            Math.max(
                              0,
                              Number(sale.grand_total || 0) -
                                Number(sale.total_return_amount || 0),
                            ),
                        )}
                      </strong>

                      {Number(sale.total_return_amount || 0) > 0 && (
                        <>
                          <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                            الأصل: {money(sale.grand_total)}
                          </span>

                          <span style={{ color: '#fdba74', fontSize: '12px' }}>
                            مرتجع: {money(sale.total_return_amount)}
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div
                      style={{ display: 'grid', gap: '5px', minWidth: '135px' }}
                    >
                      <span
                        style={{
                          padding: '4px 8px',
                          borderRadius: '999px',
                          background: 'rgba(37,99,235,0.14)',
                          border: '1px solid rgba(37,99,235,0.25)',
                          color: '#bfdbfe',
                          fontWeight: 900,
                          width: 'fit-content',
                        }}
                      >
                        {getPaymentMethodLabel(sale.payment_method)}
                      </span>

                      <span
                        style={{
                          color: '#6ee7b7',
                          fontSize: '12px',
                          fontWeight: 900,
                        }}
                      >
                        مدفوع:{' '}
                        {money(
                          sale.current_paid_amount ??
                            Math.max(
                              0,
                              Number(
                                sale.current_net_total ?? sale.grand_total ?? 0,
                              ) - Number(sale.remaining_amount || 0),
                            ),
                        )}
                      </span>

                      <span
                        style={{
                          color:
                            Number(sale.remaining_amount || 0) > 0
                              ? '#fca5a5'
                              : '#94a3b8',
                          fontSize: '12px',
                          fontWeight: 900,
                        }}
                      >
                        باقي / مديونية: {money(sale.remaining_amount || 0)}
                      </span>

                      <span style={{ fontSize: '12px' }}>
                        <span style={{ color: '#22c55e' }}>
                          +{sale.loyalty_points_earned || 0}
                        </span>
                        {' / '}
                        <span style={{ color: '#f87171' }}>
                          -{sale.loyalty_points_redeemed || 0}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    {sale.cancelled_at ? (
                      <div style={{ display: 'grid', gap: '4px' }}>
                        <strong style={{ color: '#f87171' }}>ملغاة</strong>

                        {sale.cancel_reason && (
                          <span
                            style={{
                              color: '#94a3b8',
                              fontSize: '11px',
                            }}
                          >
                            {sale.cancel_reason}
                          </span>
                        )}
                      </div>
                    ) : (
                      <strong style={{ color: '#34d399' }}>فعالة</strong>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <div
                      style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}
                    >
                      <button
                        type="button"
                        onClick={() => openReceipt(sale.id)}
                        style={smallButtonStyle}
                      >
                        عرض
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          const [receipt, history] = await Promise.all([
                            loadCurrentReceiptData(sale.id),

                            window.api.getSaleReturnHistory(sale.id),
                          ])

                          void printReceipt(
                            receipt,
                            Array.isArray(history) ? history : [],
                          )
                        }}
                        style={smallButtonStyle}
                      >
                        طباعة
                      </button>

                      {!sale.cancelled_at &&
                        Number(sale.promotion_id || 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => setExchangeSaleId(sale.id)}
                            style={{
                              ...smallButtonStyle,
                              borderColor: '#22c55e',
                              color: '#86efac',
                              background: 'rgba(34,197,94,0.10)',
                            }}
                          >
                            استبدال
                          </button>
                        )}

                      {!sale.cancelled_at && (
                        <button
                          type="button"
                          onClick={() => openReturnPopup(sale.id)}
                          style={{
                            ...smallButtonStyle,
                            borderColor: '#f97316',
                            color: '#fdba74',
                            background: 'rgba(249,115,22,0.10)',
                          }}
                        >
                          مرتجع
                        </button>
                      )}
                      {!sale.cancelled_at &&
                        Number(sale.return_count || 0) === 0 &&
                        (isAdmin ||
                          Number(sale.user_id || 0) ===
                            Number(user?.id || 0)) && (
                          <button
                            type="button"
                            onClick={() => {
                              setCancelSaleTarget(sale)
                              setCancelSaleReason(
                                `إلغاء فاتورة بيع #${sale.id}`,
                              )
                              setCancelSalePassword('')
                            }}
                            style={{
                              ...smallButtonStyle,
                              borderColor: '#ef4444',
                              color: '#fca5a5',
                              background: 'rgba(239,68,68,0.10)',
                            }}
                          >
                            إلغاء
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    style={{
                      ...tdStyle,
                      textAlign: 'center',
                      color: '#94a3b8',
                      padding: '28px',
                    }}
                  >
                    لا توجد فواتير
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'returns' && (
        <div
          className="glass-card invoice-list-scroll"
          style={{
            padding: '18px',
            borderRadius: '18px',
            overflow: 'auto',
            height: '100%',
            minHeight: 0,
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              marginBottom: '14px',
              direction: 'rtl',
            }}
          >
            <h3 style={{ margin: 0 }}>سجل المرتجعات</h3>
          </div>

          <PaginationBar
            page={returnsPage}
            totalPages={returnsTotalPages}
            totalItems={returnsTotal}
            pageSize={INVOICE_PAGE_SIZE}
            loading={returnsLoading}
            onPageChange={(page) => {
              setReturnsPage(page)
              void loadReturns(page)
            }}
          />

          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              direction: 'rtl',
            }}
          >
            <thead>
              <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                <th style={thStyle}>المرتجع</th>
                <th style={thStyle}>الفاتورة</th>
                <th style={thStyle}>العميل</th>
                <th style={thStyle}>المستخدم</th>
                <th style={thStyle}>الأصناف / الكمية</th>
                <th style={thStyle}>القيمة / السبب</th>
                <th style={thStyle}>الحالة</th>
                <th style={thStyle}>إجراءات</th>
              </tr>
            </thead>

            <tbody>
              {returnsLoading && returnRows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ ...tdStyle, textAlign: 'center' }}>
                    جاري التحميل...
                  </td>
                </tr>
              )}

              {returnRows.map((ret) => (
                <tr
                  key={ret.id}
                  style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <td style={{ ...tdStyle, fontWeight: 900, color: '#fdba74' }}>
                    {ret.code}
                  </td>
                  <td style={tdStyle}>#{ret.original_sale_id}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'grid', gap: '4px' }}>
                      <strong>{ret.customer_name || 'عميل نقدي'}</strong>
                      {ret.customer_phone && (
                        <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                          {ret.customer_phone}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={tdStyle}>{ret.cashier_name || '—'}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'grid', gap: '3px' }}>
                      <strong>{ret.items_count || 0} صنف</strong>
                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                        كمية: {Number(ret.total_quantity || 0)}
                      </span>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'grid', gap: '3px' }}>
                      <strong style={{ color: '#fca5a5' }}>
                        {money(ret.refund_amount)}
                      </strong>
                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                        {ret.reason || '—'}
                      </span>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    {ret.cancelled_at ? (
                      <div style={{ display: 'grid', gap: '4px' }}>
                        <strong style={{ color: '#f87171' }}>ملغي</strong>

                        {ret.cancel_reason && (
                          <span
                            style={{
                              color: '#94a3b8',
                              fontSize: '11px',
                            }}
                          >
                            {ret.cancel_reason}
                          </span>
                        )}
                      </div>
                    ) : (
                      <strong style={{ color: '#34d399' }}>فعال</strong>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <div
                      style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}
                    >
                      <button
                        type="button"
                        onClick={() => openReceipt(ret.original_sale_id)}
                        style={smallButtonStyle}
                      >
                        عرض الفاتورة
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const [receipt, history] = await Promise.all([
                            window.api.getSaleReceipt(ret.original_sale_id),
                            window.api.getSaleReturnHistory(
                              ret.original_sale_id,
                            ),
                          ])

                          void printReceipt(
                            receipt,
                            Array.isArray(history) ? history : [],
                          )
                        }}
                        style={smallButtonStyle}
                      >
                        طباعة الفاتورة
                      </button>
                      {!ret.cancelled_at &&
                        (isAdmin ||
                          Number(ret.user_id || 0) ===
                            Number(user?.id || 0)) && (
                          <button
                            type="button"
                            onClick={() => {
                              setCancelReturnTarget(ret)
                              setCancelReturnReason(`إلغاء المرتجع ${ret.code}`)
                              setCancelReturnPassword('')
                            }}
                            style={{
                              ...smallButtonStyle,
                              borderColor: '#ef4444',
                              color: '#fca5a5',
                              background: 'rgba(239,68,68,0.10)',
                            }}
                          >
                            إلغاء
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}

              {!returnsLoading && returnRows.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    style={{
                      ...tdStyle,
                      textAlign: 'center',
                      color: '#94a3b8',
                      padding: '28px',
                    }}
                  >
                    لا توجد مرتجعات
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'exchanges' && (
        <div
          className="glass-card invoice-list-scroll"
          style={{
            padding: '18px',

            borderRadius: '18px',

            overflow: 'auto',

            height: '100%',

            minHeight: 0,

            width: '100%',

            boxSizing: 'border-box',
          }}
        >
          <h3
            style={{
              margin: 0,
            }}
          >
            سجل الاستبدالات
          </h3>

          <PaginationBar
            page={exchangesPage}
            totalPages={exchangesTotalPages}
            totalItems={exchangesTotal}
            pageSize={INVOICE_PAGE_SIZE}
            loading={exchangesLoading}
            onPageChange={(page) => {
              setExchangesPage(page)

              void loadExchanges(page)
            }}
          />

          <table
            style={{
              width: '100%',

              borderCollapse: 'collapse',

              direction: 'rtl',
            }}
          >
            <thead>
              <tr
                style={{
                  color: '#cbd5e1',

                  textAlign: 'right',
                }}
              >
                <th style={thStyle}>الاستبدال</th>

                <th style={thStyle}>الفاتورة</th>

                <th style={thStyle}>العميل</th>

                <th style={thStyle}>المستخدم</th>

                <th style={thStyle}>القديم ← الجديد</th>

                <th style={thStyle}>فرق السعر / التسوية</th>

                <th style={thStyle}>النقاط</th>

                <th style={thStyle}>الحالة</th>

                <th style={thStyle}>إجراءات</th>
              </tr>
            </thead>

            <tbody>
              {exchangesLoading && exchangeRows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      ...tdStyle,

                      textAlign: 'center',
                    }}
                  >
                    جاري التحميل...
                  </td>
                </tr>
              )}

              {exchangeRows.map((exchange) => (
                <tr
                  key={exchange.id}
                  style={{
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <td
                    style={{
                      ...tdStyle,

                      fontWeight: 900,

                      color: exchange.cancelled_at ? '#f87171' : '#86efac',
                    }}
                  >
                    {exchange.code}

                    <div
                      style={{
                        marginTop: '4px',

                        color: '#94a3b8',

                        fontSize: '11px',
                      }}
                    >
                      {formatDate(exchange.created_at)}
                    </div>
                  </td>

                  <td style={tdStyle}>#{exchange.original_sale_id}</td>

                  <td style={tdStyle}>
                    <div
                      style={{
                        display: 'grid',

                        gap: '3px',
                      }}
                    >
                      <strong>{exchange.customer_name || 'عميل نقدي'}</strong>

                      {exchange.customer_phone && (
                        <span
                          style={{
                            color: '#94a3b8',

                            fontSize: '11px',
                          }}
                        >
                          {exchange.customer_phone}
                        </span>
                      )}
                    </div>
                  </td>

                  <td style={tdStyle}>{exchange.cashier_name || '—'}</td>

                  <td style={tdStyle}>
                    <div
                      style={{
                        display: 'grid',

                        gap: '7px',

                        minWidth: '270px',
                      }}
                    >
                      {(exchange.items || []).map((item) => (
                        <div
                          key={item.id}
                          style={{
                            display: 'grid',

                            gridTemplateColumns: '1fr auto 1fr',

                            gap: '7px',

                            alignItems: 'center',

                            padding: '6px 8px',

                            borderRadius: '8px',

                            background: 'rgba(255,255,255,0.04)',
                          }}
                        >
                          <span>
                            {item.old_product_name}

                            {' — '}

                            {money(item.old_unit_price)}
                          </span>

                          <strong>←</strong>

                          <span>
                            {item.new_product_name}

                            {' — '}

                            {money(item.new_unit_price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </td>

                  <td style={tdStyle}>
                    <div
                      style={{
                        display: 'grid',

                        gap: '4px',
                      }}
                    >
                      <strong
                        style={{
                          color:
                            Number(exchange.difference_amount || 0) > 0
                              ? '#fbbf24'
                              : Number(exchange.difference_amount || 0) < 0
                                ? '#6ee7b7'
                                : '#cbd5e1',
                        }}
                      >
                        {Number(exchange.difference_amount || 0) > 0 ? '+' : ''}
                        {money(exchange.difference_amount)}
                      </strong>

                      {Number(exchange.cash_collection_amount || 0) > 0 && (
                        <span
                          style={{
                            fontSize: '11px',

                            color: '#fbbf24',
                          }}
                        >
                          تحصيل: {money(exchange.cash_collection_amount)}
                        </span>
                      )}

                      {Number(exchange.cash_refund_amount || 0) > 0 && (
                        <span
                          style={{
                            fontSize: '11px',

                            color: '#6ee7b7',
                          }}
                        >
                          رد: {money(exchange.cash_refund_amount)}
                        </span>
                      )}

                      {Number(exchange.debt_reduction_amount || 0) > 0 && (
                        <span
                          style={{
                            fontSize: '11px',

                            color: '#93c5fd',
                          }}
                        >
                          خفض مديونية: {money(exchange.debt_reduction_amount)}
                        </span>
                      )}
                    </div>
                  </td>

                  <td style={tdStyle}>
                    <div
                      style={{
                        display: 'grid',

                        gap: '3px',

                        fontSize: '12px',
                      }}
                    >
                      <span
                        style={{
                          color: '#22c55e',
                        }}
                      >
                        مكتسبة:{' '}
                        {Number(
                          exchange.loyalty_earned_points_adjustment || 0,
                        ) >= 0
                          ? '+'
                          : ''}
                        {Number(exchange.loyalty_earned_points_adjustment || 0)}
                      </span>

                      <span
                        style={{
                          color: '#fbbf24',
                        }}
                      >
                        مستخدمة:{' '}
                        {Number(
                          exchange.loyalty_redeemed_points_adjustment || 0,
                        ) >= 0
                          ? '+'
                          : ''}
                        {Number(
                          exchange.loyalty_redeemed_points_adjustment || 0,
                        )}
                      </span>
                    </div>
                  </td>

                  <td style={tdStyle}>
                    {exchange.cancelled_at ? (
                      <div
                        style={{
                          display: 'grid',

                          gap: '3px',
                        }}
                      >
                        <strong
                          style={{
                            color: '#f87171',
                          }}
                        >
                          ملغي
                        </strong>

                        {exchange.cancel_reason && (
                          <span
                            style={{
                              color: '#94a3b8',

                              fontSize: '11px',
                            }}
                          >
                            {exchange.cancel_reason}
                          </span>
                        )}

                        {exchange.cancelled_by_name && (
                          <span
                            style={{
                              color: '#64748b',

                              fontSize: '10px',
                            }}
                          >
                            بواسطة: {exchange.cancelled_by_name}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'grid',

                          gap: '3px',
                        }}
                      >
                        <strong
                          style={{
                            color: '#34d399',
                          }}
                        >
                          فعال
                        </strong>

                        {!exchange.can_cancel &&
                          exchange.cancel_block_reason && (
                            <span
                              style={{
                                color: '#fbbf24',

                                fontSize: '10px',
                              }}
                            >
                              {exchange.cancel_block_reason}
                            </span>
                          )}
                      </div>
                    )}
                  </td>

                  <td style={tdStyle}>
                    <div
                      style={{
                        display: 'flex',

                        gap: '7px',

                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedExchange(exchange)}
                        style={smallButtonStyle}
                      >
                        تفاصيل
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void printSaleExchangeReceiptHtml({
                            exchange,

                            onBlocked: () =>
                              setMessage('لم يتم فتح نافذة الطباعة'),

                            onError: (msg) => setMessage(msg),
                          })
                        }
                        style={smallButtonStyle}
                      >
                        طباعة
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void openReceipt(exchange.original_sale_id)
                        }
                        style={smallButtonStyle}
                      >
                        الفاتورة
                      </button>

                      {!exchange.cancelled_at &&
                        exchange.can_cancel &&
                        (isAdmin ||
                          Number(exchange.user_id || 0) ===
                            Number(user?.id || 0)) && (
                          <button
                            type="button"
                            onClick={() => {
                              setCancelExchangeTarget(exchange)

                              setCancelExchangeReason(
                                `إلغاء الاستبدال ${exchange.code}`,
                              )

                              setCancelExchangePassword('')
                            }}
                            style={{
                              ...smallButtonStyle,

                              borderColor: '#ef4444',

                              color: '#fca5a5',

                              background: 'rgba(239,68,68,0.10)',
                            }}
                          >
                            إلغاء
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}

              {!exchangesLoading && exchangeRows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      ...tdStyle,

                      textAlign: 'center',

                      color: '#94a3b8',

                      padding: '28px',
                    }}
                  >
                    لا توجد عمليات استبدال
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedExchange && (
        <div
          className="theme-modal-overlay"
          style={{
            position: 'fixed',

            inset: 0,

            background: 'rgba(0,0,0,0.60)',

            zIndex: 99999,

            display: 'flex',

            alignItems: 'center',

            justifyContent: 'center',

            padding: '20px',
          }}
        >
          <div
            className="theme-modal-card"
            style={{
              width: 'min(900px, calc(100vw - 48px))',

              maxHeight: '92vh',

              overflowY: 'auto',

              borderRadius: '18px',

              background: '#111827',

              border: '1px solid rgba(255,255,255,0.10)',

              padding: '22px',

              direction: 'rtl',
            }}
          >
            <div
              style={{
                display: 'flex',

                justifyContent: 'space-between',

                gap: '12px',

                marginBottom: '18px',
              }}
            >
              <div>
                <h3
                  style={{
                    margin: '0 0 5px',
                  }}
                >
                  {selectedExchange.code}
                </h3>

                <div
                  style={{
                    color: '#94a3b8',
                  }}
                >
                  فاتورة #{selectedExchange.original_sale_id}
                  {' — '}
                  {formatDate(selectedExchange.created_at)}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedExchange(null)}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: 'grid',

                gridTemplateColumns: 'repeat(3, 1fr)',

                gap: '10px',

                marginBottom: '16px',
              }}
            >
              <div style={statCardStyle}>
                العميل
                <strong>{selectedExchange.customer_name || 'عميل نقدي'}</strong>
              </div>

              <div style={statCardStyle}>
                الكاشير
                <strong>{selectedExchange.cashier_name || '—'}</strong>
              </div>

              <div style={statCardStyle}>
                فرق الاستبدال
                <strong>{money(selectedExchange.difference_amount)}</strong>
              </div>
            </div>

            <div
              style={{
                display: 'grid',

                gap: '8px',
              }}
            >
              {selectedExchange.items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'grid',

                    gridTemplateColumns: '1fr auto 1fr',

                    gap: '12px',

                    padding: '12px',

                    borderRadius: '10px',

                    background: 'rgba(255,255,255,0.04)',
                  }}
                >
                  <div>
                    <strong>{item.old_product_name}</strong>

                    <div
                      style={{
                        color: '#94a3b8',

                        fontSize: '12px',
                      }}
                    >
                      {item.old_size || '—'}
                      {' / '}
                      {item.old_color || '—'}
                      {' — '}
                      {money(item.old_unit_price)}
                    </div>
                  </div>

                  <strong>←</strong>

                  <div>
                    <strong>{item.new_product_name}</strong>

                    <div
                      style={{
                        color: '#94a3b8',

                        fontSize: '12px',
                      }}
                    >
                      {item.new_size || '—'}
                      {' / '}
                      {item.new_color || '—'}
                      {' — '}
                      {money(item.new_unit_price)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: '16px',

                padding: '14px',

                borderRadius: '12px',

                background: 'rgba(255,255,255,0.04)',

                display: 'grid',

                gap: '7px',
              }}
            >
              <SummaryLine
                label="قيمة العرض قبل"
                value={money(selectedExchange.old_group_total)}
              />

              <SummaryLine
                label="قيمة العرض بعد"
                value={money(selectedExchange.new_group_total)}
              />

              <SummaryLine
                label="فرق الاستبدال"
                value={money(selectedExchange.difference_amount)}
                strong
              />

              <SummaryLine
                label="تحصيل كاش"
                value={money(selectedExchange.cash_collection_amount)}
              />

              <SummaryLine
                label="رد كاش"
                value={money(selectedExchange.cash_refund_amount)}
              />

              <SummaryLine
                label="خفض مديونية"
                value={money(selectedExchange.debt_reduction_amount)}
              />
            </div>

            {selectedExchange.cancelled_at && (
              <div
                style={{
                  marginTop: '14px',

                  padding: '12px',

                  borderRadius: '10px',

                  border: '1px solid rgba(239,68,68,0.30)',

                  background: 'rgba(239,68,68,0.10)',

                  color: '#fca5a5',
                }}
              >
                <strong>العملية ملغاة</strong>

                <div>{selectedExchange.cancel_reason || '—'}</div>

                {selectedExchange.cancelled_by_name && (
                  <div>ألغيت بواسطة: {selectedExchange.cancelled_by_name}</div>
                )}
              </div>
            )}

            <div
              style={{
                display: 'flex',

                justifyContent: 'flex-end',

                gap: '10px',

                marginTop: '18px',
              }}
            >
              <button
                type="button"
                onClick={() =>
                  void printSaleExchangeReceiptHtml({
                    exchange: selectedExchange,

                    onBlocked: () => setMessage('لم يتم فتح نافذة الطباعة'),

                    onError: (msg) => setMessage(msg),
                  })
                }
                style={primaryButtonStyle}
              >
                طباعة إيصال الاستبدال
              </button>

              <button
                type="button"
                onClick={() => setSelectedExchange(null)}
                style={secondaryButtonStyle}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedReceipt && (
        <div
          className="theme-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.60)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            className="theme-modal-card"
            style={{
              width: 'min(1120px, calc(100vw - 48px))',
              maxWidth: 'calc(100vw - 48px)',
              maxHeight: '92vh',
              overflowY: 'auto',
              overflowX: 'hidden',
              boxSizing: 'border-box',
              borderRadius: '18px',
              border: '1px solid rgba(255,255,255,0.10)',
              background: '#111827',
              padding: '22px',
              direction: 'rtl',
              boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '14px',
                alignItems: 'center',
                marginBottom: '18px',
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 6px' }}>
                  فاتورة #{selectedReceipt.sale.id}
                </h3>
                <div style={{ color: '#94a3b8', fontWeight: 700 }}>
                  {formatDate(selectedReceipt.sale.created_at)}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px',
                marginBottom: '18px',
              }}
            >
              <div style={statCardStyle}>
                العميل
                <strong>
                  {selectedReceipt.sale.customer_name || 'عميل نقدي'}
                </strong>
              </div>
              <div style={statCardStyle}>
                الكاشير
                <strong>{selectedReceipt.sale.cashier_name || '—'}</strong>
              </div>
              <div style={statCardStyle}>
                الصافي الحالي
                <strong>
                  {money(
                    selectedReceipt.financials?.net_grand_total ??
                      selectedReceipt.sale.grand_total,
                  )}
                </strong>
              </div>
            </div>

            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                tableLayout: 'fixed',
              }}
            >
              <thead>
                <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                  <th style={invoiceModalThStyle}>الصنف</th>
                  <th style={invoiceModalThStyle}>المقاس</th>
                  <th style={invoiceModalThStyle}>اللون</th>
                  <th style={invoiceModalThStyle}>الكمية</th>
                  <th style={invoiceModalThStyle}>المرتجع</th>
                  <th style={invoiceModalThStyle}>السعر</th>
                  <th style={invoiceModalThStyle}>الإجمالي</th>
                </tr>
              </thead>

              <tbody>
                {(selectedReceipt.items ?? []).map((item) => (
                  <tr
                    key={item.id}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <td style={invoiceModalTdStyle}>{item.product_name}</td>
                    <td style={invoiceModalTdStyle}>{item.size || '—'}</td>
                    <td style={invoiceModalTdStyle}>{item.color || '—'}</td>
                    <td style={invoiceModalTdStyle}>{item.quantity}</td>
                    <td style={invoiceModalTdStyle}>
                      {Number(item.returned_quantity || 0) > 0 ? (
                        <span style={{ color: '#fdba74', fontWeight: 900 }}>
                          {Number(item.returned_quantity || 0)} من أصل{' '}
                          {Number(item.quantity || 0)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={invoiceModalTdStyle}>
                      {money(item.unit_price)}
                    </td>
                    <td style={invoiceModalTdStyle}>
                      {money(item.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {(selectedReceipt.exchanges || []).length > 0 && (
              <div
                style={{
                  marginTop: '18px',
                  padding: '14px',
                  borderRadius: '14px',
                  background: 'rgba(34,197,94,0.08)',
                  border: '1px solid rgba(34,197,94,0.25)',
                  display: 'grid',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    color: '#86efac',
                    fontWeight: 900,
                  }}
                >
                  سجل الاستبدالات
                </div>

                {(selectedReceipt.exchanges || []).map((exchange: any) => (
                  <div
                    key={exchange.id}
                    style={{
                      padding: '12px',
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      display: 'grid',
                      gap: '8px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '10px',
                        flexWrap: 'wrap',
                        fontWeight: 800,
                      }}
                    >
                      <span>
                        {exchange.code}

                        {' — '}

                        <strong
                          style={{
                            color: exchange.cancelled_at
                              ? '#f87171'
                              : '#34d399',
                          }}
                        >
                          {exchange.cancelled_at ? 'ملغي' : 'فعال'}
                        </strong>
                      </span>

                      <span>{formatDate(exchange.created_at)}</span>

                      <span
                        style={{
                          color:
                            Number(exchange.difference_amount || 0) > 0
                              ? '#fbbf24'
                              : Number(exchange.difference_amount || 0) < 0
                                ? '#6ee7b7'
                                : '#cbd5e1',
                        }}
                      >
                        الفرق: {money(exchange.difference_amount || 0)}
                      </span>
                    </div>

                    <div
                      style={{
                        color: '#94a3b8',
                        fontSize: '12px',
                      }}
                    >
                      المستخدم: {exchange.cashier_name || '—'}
                      {' | '}
                      السبب: {exchange.reason || '—'}
                      {exchange.cancelled_at && (
                        <>
                          {' | '}
                          إلغاء: {exchange.cancel_reason || '—'}
                          {exchange.cancelled_by_name
                            ? ` — بواسطة ${exchange.cancelled_by_name}`
                            : ''}
                        </>
                      )}
                    </div>

                    {(exchange.items || []).map((item: any) => (
                      <div
                        key={item.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr auto 1fr',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '8px',
                          borderRadius: '8px',
                          background: 'rgba(255,255,255,0.03)',
                        }}
                      >
                        <span>
                          {item.old_product_name} {item.old_size || ''}
                          {' — '}
                          {money(item.old_unit_price)}
                        </span>

                        <strong>←</strong>

                        <span>
                          {item.new_product_name} {item.new_size || ''}
                          {' — '}
                          {money(item.new_unit_price)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {(selectedReceipt.exchanges || []).length > 0 &&
              selectedReceipt.original_receipt && (
                <details
                  style={{
                    marginTop: '18px',
                    padding: '14px',
                    borderRadius: '14px',
                    border: '1px solid rgba(148,163,184,0.20)',
                    background: 'rgba(148,163,184,0.05)',
                  }}
                >
                  <summary
                    style={{
                      cursor: 'pointer',
                      fontWeight: 900,
                      color: '#cbd5e1',
                    }}
                  >
                    الفاتورة الأصلية قبل الاستبدال
                  </summary>

                  <div
                    style={{
                      marginTop: '14px',
                      display: 'grid',
                      gap: '12px',
                    }}
                  >
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                      }}
                    >
                      <thead>
                        <tr>
                          <th style={invoiceModalThStyle}>الصنف</th>

                          <th style={invoiceModalThStyle}>المقاس</th>

                          <th style={invoiceModalThStyle}>اللون</th>

                          <th style={invoiceModalThStyle}>الكمية</th>

                          <th style={invoiceModalThStyle}>السعر</th>

                          <th style={invoiceModalThStyle}>الإجمالي</th>
                        </tr>
                      </thead>

                      <tbody>
                        {(selectedReceipt.original_receipt.items || []).map(
                          (item: any) => (
                            <tr
                              key={item.id}
                              style={{
                                borderTop: '1px solid rgba(255,255,255,0.06)',
                              }}
                            >
                              <td style={invoiceModalTdStyle}>
                                {item.product_name}

                                {Number(item.is_gift || 0) === 1
                                  ? ' — هدية'
                                  : ''}
                              </td>

                              <td style={invoiceModalTdStyle}>
                                {item.size || '—'}
                              </td>

                              <td style={invoiceModalTdStyle}>
                                {item.color || '—'}
                              </td>

                              <td style={invoiceModalTdStyle}>
                                {item.quantity}
                              </td>

                              <td style={invoiceModalTdStyle}>
                                {money(item.unit_price)}
                              </td>

                              <td style={invoiceModalTdStyle}>
                                {money(item.line_total)}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>

                    <div
                      style={{
                        display: 'grid',
                        gap: '6px',
                        maxWidth: '360px',
                        marginRight: 'auto',
                      }}
                    >
                      <SummaryLine
                        label="الإجمالي قبل الخصم"
                        value={money(
                          selectedReceipt.original_receipt.sale.sub_total,
                        )}
                      />

                      <SummaryLine
                        label="خصم عادي"
                        value={money(
                          selectedReceipt.original_receipt.sale
                            .discount_value || 0,
                        )}
                      />

                      <SummaryLine
                        label="خصم العرض"
                        value={money(
                          selectedReceipt.original_receipt.sale
                            .promotion_discount_value || 0,
                        )}
                      />

                      <SummaryLine
                        label="خصم النقاط"
                        value={money(
                          selectedReceipt.original_receipt.sale
                            .loyalty_discount_value || 0,
                        )}
                      />

                      <SummaryLine
                        label="الإجمالي الأصلي"
                        value={money(
                          selectedReceipt.original_receipt.sale.grand_total,
                        )}
                        strong
                      />
                    </div>
                  </div>
                </details>
              )}

            {selectedReturnHistory.length > 0 && (
              <div
                style={{
                  marginTop: '18px',
                  padding: '14px',
                  borderRadius: '14px',
                  background: 'rgba(249,115,22,0.10)',
                  border: '1px solid rgba(249,115,22,0.25)',
                  display: 'grid',
                  gap: '12px',
                }}
              >
                <div
                  className="theme-warning-panel"
                  style={{ color: '#fed7aa', fontWeight: 900 }}
                >
                  سجل المرتجعات على هذه الفاتورة
                </div>

                {selectedReturnHistory.map((ret) => (
                  <div
                    key={ret.id}
                    style={{
                      padding: '12px',
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      display: 'grid',
                      gap: '8px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '12px',
                        flexWrap: 'wrap',
                        color: '#fff',
                        fontWeight: 800,
                      }}
                    >
                      <span>مرتجع #{ret.id}</span>
                      <span>{formatDate(ret.created_at)}</span>
                      <span>{money(ret.grand_total)}</span>
                    </div>

                    <div style={{ color: '#94a3b8', fontWeight: 700 }}>
                      السبب: {ret.return_reason || '—'} | المستخدم:{' '}
                      {ret.cashier_name || '—'}
                    </div>

                    <div style={{ display: 'grid', gap: '6px' }}>
                      {(ret.items || []).map((item: any) => (
                        <div
                          key={item.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '10px',
                            color: '#e5e7eb',
                            fontSize: '13px',
                          }}
                        >
                          <span>
                            {item.product_name} {item.size || ''}{' '}
                            {item.color || ''}
                          </span>
                          <strong>
                            كمية: {Number(item.quantity || 0)} |{' '}
                            {money(item.line_total)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gap: '8px',
                marginTop: '18px',
                maxWidth: '360px',
                marginRight: 'auto',
              }}
            >
              <SummaryLine
                label="الإجمالي قبل الخصم الحالي"
                value={money(
                  selectedReceipt.financials?.current_sub_total ??
                    selectedReceipt.sale.sub_total,
                )}
              />

              <SummaryLine
                label="خصم عادي مطبق"
                value={money(
                  selectedReceipt.financials?.current_normal_discount_value ??
                    selectedReceipt.sale.discount_value ??
                    0,
                )}
              />

              <SummaryLine
                label="خصم العرض الحالي"
                value={money(
                  selectedReceipt.financials
                    ?.current_promotion_discount_value ??
                    selectedReceipt.sale.promotion_discount_value ??
                    0,
                )}
              />

              <SummaryLine
                label="خصم النقاط المطبق"
                value={money(
                  selectedReceipt.financials?.current_loyalty_discount_value ??
                    selectedReceipt.sale.loyalty_discount_value ??
                    0,
                )}
              />

              <SummaryLine
                label="الإجمالي الحالي قبل المرتجعات"
                value={money(
                  selectedReceipt.financials?.current_grand_total ??
                    selectedReceipt.sale.grand_total,
                )}
                strong
              />

              {Number(selectedReceipt.financials?.total_return_value || 0) >
                0 && (
                <SummaryLine
                  label="إجمالي المرتجعات"
                  value={money(
                    selectedReceipt.financials?.total_return_value || 0,
                  )}
                />
              )}

              <SummaryLine
                label="الصافي الحالي"
                value={money(
                  selectedReceipt.financials?.net_grand_total ??
                    selectedReceipt.sale.grand_total,
                )}
                strong
              />
              <SummaryLine
                label="النقاط المكتسبة"
                value={`${selectedReceipt.sale.loyalty_points_earned || 0}`}
              />
              <SummaryLine
                label="النقاط المستخدمة"
                value={`${selectedReceipt.sale.loyalty_points_redeemed || 0}`}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-start',
                gap: '10px',
                marginTop: '22px',
              }}
            >
              <button
                type="button"
                onClick={() =>
                  void printReceipt(selectedReceipt, selectedReturnHistory)
                }
                style={primaryButtonStyle}
              >
                طباعة الفاتورة
              </button>

              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                style={secondaryButtonStyle}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {returnReceipt && (
        <div
          className="theme-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.60)',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            className="theme-modal-card"
            style={{
              width: 'min(1120px, calc(100vw - 48px))',
              maxWidth: 'calc(100vw - 48px)',
              maxHeight: '92vh',
              overflowY: 'auto',
              overflowX: 'hidden',
              boxSizing: 'border-box',
              borderRadius: '18px',
              border: '1px solid rgba(255,255,255,0.10)',
              background: '#111827',
              padding: '22px',
              direction: 'rtl',
              boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '14px',
                alignItems: 'center',
                marginBottom: '18px',
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 6px' }}>
                  مرتجع فاتورة #{returnReceipt.sale.id}
                </h3>
                <div style={{ color: '#94a3b8', fontWeight: 700 }}>
                  العميل: {returnReceipt.sale.customer_name || 'عميل نقدي'}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setReturnReceipt(null)
                  setReturnItems([])
                  setReturnReason('')
                  setSelectedReceipt(null)
                  setSelectedReturnHistory([])
                }}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <div
              className="theme-warning-panel"
              style={{
                padding: '14px',
                borderRadius: '14px',
                background: 'rgba(249,115,22,0.10)',
                border: '1px solid rgba(249,115,22,0.25)',
                color: '#fed7aa',
                fontWeight: 700,
                marginBottom: '16px',
              }}
            >
              الأصناف العادية يمكن تحديد كمية المرتجع منها. أما عرض اشتري وخد
              فيظهر كحزمة واحدة ويجب إرجاع العرض كاملًا. بعد أي استبدال تظهر هنا
              الأصناف والأسعار الحالية للعرض وليست الأصناف القديمة.
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                  <th style={thStyle}>الصنف</th>
                  <th style={thStyle}>المقاس</th>
                  <th style={thStyle}>اللون</th>
                  <th style={thStyle}>المباع</th>
                  <th style={thStyle}>اترجع</th>
                  <th style={thStyle}>المتاح</th>
                  <th style={thStyle}>كمية المرتجع</th>
                  <th style={thStyle}>قيمة المرتجع</th>
                </tr>
              </thead>

              <tbody>
                {returnItems.map((item) => (
                  <tr
                    key={item.sale_item_id}
                    style={{
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <td style={tdStyle}>
                      {item.is_promotion_bundle ? (
                        <div
                          style={{
                            display: 'grid',
                            gap: '8px',
                            minWidth: '260px',
                          }}
                        >
                          <strong
                            style={{
                              color: '#93c5fd',
                            }}
                          >
                            {item.product_name} —{' '}
                            {item.bundle_units?.length || 0} قطع
                          </strong>

                          {(item.bundle_units || []).map((unit) => (
                            <div
                              key={unit.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '10px',
                                padding: '6px 8px',
                                borderRadius: '8px',
                                background: 'rgba(255,255,255,0.04)',
                                fontSize: '12px',
                              }}
                            >
                              <span>
                                {unit.current_product_name}

                                {' — '}

                                {unit.current_size || '—'}

                                {' / '}

                                {unit.current_color || '—'}
                              </span>

                              <strong
                                style={{
                                  color:
                                    Number(unit.current_is_gift) === 1
                                      ? '#6ee7b7'
                                      : '#fff',
                                }}
                              >
                                {money(unit.current_unit_price)}

                                {Number(unit.current_is_gift) === 1
                                  ? ' — هدية'
                                  : ''}
                              </strong>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <>
                          {item.product_name}

                          {item.promotion_discount_value >=
                          roundMoney(item.unit_price * item.sold_quantity) -
                            0.01
                            ? ' — مجاني بالعرض'
                            : ''}
                        </>
                      )}
                    </td>

                    <td style={tdStyle}>
                      {item.is_promotion_bundle ? '—' : item.size || '—'}
                    </td>

                    <td style={tdStyle}>
                      {item.is_promotion_bundle ? '—' : item.color || '—'}
                    </td>

                    <td style={tdStyle}>
                      {item.is_promotion_bundle
                        ? `${item.bundle_units?.length || 0} قطعة`
                        : item.sold_quantity}
                    </td>

                    <td style={tdStyle}>
                      {item.is_promotion_bundle
                        ? item.returned_quantity > 0
                          ? 'تم إرجاع العرض'
                          : '—'
                        : item.returned_quantity}
                    </td>

                    <td style={tdStyle}>
                      {item.is_promotion_bundle
                        ? item.returnable_quantity > 0
                          ? 'العرض كامل'
                          : '0'
                        : item.returnable_quantity}
                    </td>

                    <td style={tdStyle}>
                      {item.is_promotion_bundle ? (
                        <button
                          type="button"
                          disabled={item.returnable_quantity <= 0}
                          onClick={() =>
                            updateReturnQty(
                              item.sale_item_id,
                              item.return_quantity > 0 ? 0 : 1,
                            )
                          }
                          style={{
                            ...smallButtonStyle,

                            borderColor:
                              item.return_quantity > 0 ? '#ef4444' : '#f97316',

                            color:
                              item.return_quantity > 0 ? '#fca5a5' : '#fdba74',

                            background:
                              item.return_quantity > 0
                                ? 'rgba(239,68,68,0.10)'
                                : 'rgba(249,115,22,0.10)',

                            opacity: item.returnable_quantity <= 0 ? 0.45 : 1,

                            cursor:
                              item.returnable_quantity <= 0
                                ? 'not-allowed'
                                : 'pointer',
                          }}
                        >
                          {item.return_quantity > 0
                            ? 'إلغاء اختيار العرض'
                            : 'إرجاع العرض كاملًا'}
                        </button>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          max={item.returnable_quantity}
                          disabled={item.returnable_quantity <= 0}
                          value={item.return_quantity}
                          onChange={(e) =>
                            updateReturnQty(
                              item.sale_item_id,
                              Number(e.target.value),
                            )
                          }
                          style={{
                            ...inputStyle,
                            width: '110px',
                            textAlign: 'center',
                            opacity: item.returnable_quantity <= 0 ? 0.5 : 1,
                          }}
                        />
                      )}
                    </td>

                    <td style={tdStyle}>
                      {item.is_promotion_bundle ? (
                        <div
                          style={{
                            display: 'grid',
                            gap: '3px',
                          }}
                        >
                          <strong
                            style={{
                              color: '#6ee7b7',
                            }}
                          >
                            {money(
                              item.return_quantity *
                                Math.max(
                                  0,
                                  item.unit_price -
                                    item.promotion_discount_value,
                                ),
                            )}
                          </strong>

                          {item.return_quantity > 0 &&
                            item.promotion_discount_value > 0 && (
                              <span
                                style={{
                                  color: '#94a3b8',
                                  fontSize: '11px',
                                }}
                              >
                                قبل العرض: {money(item.unit_price)} / هدية:{' '}
                                {money(item.promotion_discount_value)}
                              </span>
                            )}
                        </div>
                      ) : (
                        money(item.return_quantity * item.unit_price)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'grid', gap: '10px', marginTop: '18px' }}>
              <label style={{ color: '#cbd5e1', fontWeight: 800 }}>
                سبب المرتجع
              </label>

              <input
                placeholder="مثال: مقاس غير مناسب / عيب في المنتج"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
              <label style={{ color: '#cbd5e1', fontWeight: 800 }}>
                رد الفلوس من حساب
              </label>
              <select
                value={returnRefundAccount}
                onChange={(e) => setReturnRefundAccount(e.target.value)}
                style={inputStyle}
              >
                {CASH_ACCOUNT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '14px',
                marginTop: '22px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'grid', gap: '6px' }}>
                <div>
                  إجمالي الأصناف قبل الخصومات: {money(returnGrossTotal)}
                </div>

                {(returnPromotionDiscountShare > 0 ||
                  returnDiscountShare > 0 ||
                  returnLoyaltyDiscountShare > 0) && (
                  <div style={{ color: '#fbbf24' }}>
                    {returnPromotionDiscountShare > 0 && (
                      <div>
                        خصم العرض: {money(returnPromotionDiscountShare)}
                      </div>
                    )}

                    {returnDiscountShare > 0 && (
                      <div>الخصم العادي: {money(returnDiscountShare)}</div>
                    )}

                    {returnLoyaltyDiscountShare > 0 && (
                      <div>خصم النقاط: {money(returnLoyaltyDiscountShare)}</div>
                    )}
                  </div>
                )}

                <strong>صافي المرتجع: {money(returnTotal)}</strong>

                {returnDebtReduction > 0 && (
                  <div style={{ color: '#93c5fd' }}>
                    يخصم من مديونية العميل: {money(returnDebtReduction)}
                  </div>
                )}

                {returnCashRefund > 0 && (
                  <div style={{ color: '#fca5a5' }}>
                    سيتم رد فلوس من الحساب المالي: {money(returnCashRefund)}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={submitReturn}
                  disabled={savingReturn || returnTotal <= 0}
                  style={{
                    ...primaryButtonStyle,
                    opacity: savingReturn || returnTotal <= 0 ? 0.6 : 1,
                    cursor:
                      savingReturn || returnTotal <= 0
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  {savingReturn ? 'جاري الحفظ...' : 'حفظ المرتجع'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setReturnReceipt(null)
                    setReturnItems([])
                    setReturnReason('')
                  }}
                  style={secondaryButtonStyle}
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <SaleExchangeModal
        saleId={exchangeSaleId}
        userId={user?.id ?? null}
        onClose={() => setExchangeSaleId(null)}
        onSuccess={(successMessage) => {
          setMessage(successMessage)

          setExchangeSaleId(null)

          setSelectedReceipt(null)
          setSelectedReturnHistory([])

          void Promise.all([
            loadInvoices(salesPage),

            loadExchanges(exchangesPage),
          ])
        }}
      />

      <FinancialCancelModal
        open={Boolean(cancelSaleTarget)}
        title="إلغاء فاتورة بيع"
        description={
          cancelSaleTarget
            ? `فاتورة #${cancelSaleTarget.id} — ${money(cancelSaleTarget.grand_total)}`
            : ''
        }
        requirePassword={Boolean(cancelSaleTarget?.requires_admin_password)}
        reason={cancelSaleReason}
        password={cancelSalePassword}
        loading={cancellingSale}
        onReasonChange={setCancelSaleReason}
        onPasswordChange={setCancelSalePassword}
        onClose={() => {
          if (cancellingSale) return

          setCancelSaleTarget(null)
          setCancelSaleReason('')
          setCancelSalePassword('')
        }}
        onConfirm={() => void confirmCancelSale()}
      />

      <FinancialCancelModal
        open={Boolean(cancelReturnTarget)}
        title="إلغاء مرتجع بيع"
        description={
          cancelReturnTarget
            ? `${cancelReturnTarget.code} — ${money(cancelReturnTarget.refund_amount)}`
            : ''
        }
        requirePassword={Boolean(cancelReturnTarget?.requires_admin_password)}
        reason={cancelReturnReason}
        password={cancelReturnPassword}
        loading={cancellingReturn}
        onReasonChange={setCancelReturnReason}
        onPasswordChange={setCancelReturnPassword}
        onClose={() => {
          if (cancellingReturn) return

          setCancelReturnTarget(null)
          setCancelReturnReason('')
          setCancelReturnPassword('')
        }}
        onConfirm={() => void confirmCancelReturn()}
      />

      <FinancialCancelModal
        open={Boolean(cancelExchangeTarget)}
        title="إلغاء عملية استبدال"
        description={
          cancelExchangeTarget
            ? `${cancelExchangeTarget.code} — فاتورة #${cancelExchangeTarget.original_sale_id} — فرق ${money(cancelExchangeTarget.difference_amount)}`
            : ''
        }
        requirePassword={Boolean(cancelExchangeTarget?.requires_admin_password)}
        reason={cancelExchangeReason}
        password={cancelExchangePassword}
        loading={cancellingExchange}
        onReasonChange={setCancelExchangeReason}
        onPasswordChange={setCancelExchangePassword}
        onClose={() => {
          if (cancellingExchange) {
            return
          }

          setCancelExchangeTarget(null)

          setCancelExchangeReason('')

          setCancelExchangePassword('')
        }}
        onConfirm={() => void confirmCancelExchange()}
      />
    </div>
  )
}

function PaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  loading,
  onPageChange,
}: {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  loading?: boolean
  onPageChange: (page: number) => void
}) {
  if (totalItems <= 0) {
    return null
  }

  const safePage = Math.min(Math.max(page, 1), Math.max(totalPages, 1))

  const startItem = (safePage - 1) * pageSize + 1

  const endItem = Math.min(safePage * pageSize, totalItems)

  const buttonStyle = (disabled: boolean): React.CSSProperties => ({
    ...smallButtonStyle,
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  })

  return (
    <div
      style={{
        display: 'grid',
        justifyItems: 'center',
        gap: '8px',
        direction: 'rtl',

        marginBottom: '12px',
        paddingBottom: '12px',

        borderBottom: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          disabled={loading || safePage <= 1}
          onClick={() => onPageChange(1)}
          style={buttonStyle(Boolean(loading || safePage <= 1))}
        >
          الأولى
        </button>

        <button
          type="button"
          disabled={loading || safePage <= 1}
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          style={buttonStyle(Boolean(loading || safePage <= 1))}
        >
          السابق
        </button>

        <strong
          style={{
            color: '#fff',
            minWidth: '110px',
            textAlign: 'center',
            fontSize: '14px',
          }}
        >
          صفحة {safePage} من {totalPages}
        </strong>

        <button
          type="button"
          disabled={loading || safePage >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
          style={buttonStyle(Boolean(loading || safePage >= totalPages))}
        >
          التالي
        </button>

        <button
          type="button"
          disabled={loading || safePage >= totalPages}
          onClick={() => onPageChange(totalPages)}
          style={buttonStyle(Boolean(loading || safePage >= totalPages))}
        >
          الأخيرة
        </button>
      </div>

      <div
        style={{
          color: '#94a3b8',
          fontWeight: 800,
          fontSize: '12px',
          textAlign: 'center',
        }}
      >
        عرض {startItem} - {endItem} من {totalItems}
      </div>
    </div>
  )
}

function SummaryLine({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        color: strong ? '#fff' : '#cbd5e1',
        fontWeight: strong ? 900 : 700,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        paddingTop: '8px',
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function money(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`
}

function formatDate(value?: string) {
  if (!value) return '—'

  try {
    const raw = String(value)

    // SQLite CURRENT_TIMESTAMP بيرجع UTC بالشكل ده:
    // 2026-04-27 10:30:00
    // فلازم نعلّمه إنه UTC بإضافة Z
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z'

    return new Date(normalized).toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}

function formatReceiptDate(value?: string) {
  if (!value) return '—'

  try {
    const raw = String(value)

    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z'

    const date = new Date(normalized)

    const datePart = date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })

    const timePart = date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    return `${datePart}  ${timePart}`
  } catch {
    return value
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const ENGINEER_FOOTER =
  'برمجة وتصميم: بشمهندس عبدالرحمن حازم - 01155559287/01068377869'

function getPaymentStatusLabel(status?: string | null) {
  if (status === 'paid') return 'مدفوعة'
  if (status === 'partial') return 'مدفوعة جزئيًا'
  if (status === 'unpaid') return 'غير مدفوعة'
  return status || '—'
}

function getReturnAmount(item: any) {
  return Number(item?.refund_amount ?? item?.grand_total ?? 0)
}

function getReceiptFinance(receipt: ReceiptData, returnHistory: any[] = []) {
  const sale = receipt.sale

  const originalTotal = Number(sale.grand_total || 0)
  const totalReturns = returnHistory.reduce(
    (sum, item) => sum + getReturnAmount(item),
    0,
  )

  const netTotal = Math.max(0, originalTotal - totalReturns)
  const remainingAmount = Math.max(0, Number(sale.remaining_amount || 0))
  const netPaidAmount = Math.max(0, netTotal - remainingAmount)

  const totalReturnedQuantity = (receipt.items ?? []).reduce(
    (sum, item) => sum + Number(item.returned_quantity || 0),
    0,
  )

  return {
    originalTotal,
    totalReturns,
    netTotal,
    remainingAmount,
    netPaidAmount,
    totalReturnedQuantity,
    paymentStatus: getPaymentStatusLabel(sale.payment_status),
  }
}

const inputStyle: React.CSSProperties = {
  height: '44px',
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  outline: 'none',
  padding: '0 12px',
  textAlign: 'right',
  direction: 'rtl',
  boxSizing: 'border-box',
}

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  height: '44px',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, #6d5dfc, #7c3aed)',
  color: '#fff',
  fontWeight: 800,
  padding: '0 18px',
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid #7c3aed',
  height: '44px',
  borderRadius: '10px',
  background: 'transparent',
  color: '#c4b5fd',
  fontWeight: 800,
  padding: '0 18px',
  cursor: 'pointer',
}

const smallButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(124,58,237,0.55)',
  borderRadius: '8px',
  background: 'rgba(124,58,237,0.10)',
  color: '#c4b5fd',
  padding: '8px 10px',
  cursor: 'pointer',
  fontWeight: 700,
}

const closeButtonStyle: React.CSSProperties = {
  width: '34px',
  height: '34px',
  borderRadius: '50%',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '20px',
}

const thStyle: React.CSSProperties = {
  padding: '12px',
  fontWeight: 800,
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '12px',
  color: '#e5e7eb',
  whiteSpace: 'nowrap',
}

const invoiceModalThStyle: React.CSSProperties = {
  ...thStyle,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
}

const invoiceModalTdStyle: React.CSSProperties = {
  ...tdStyle,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  verticalAlign: 'top',
  lineHeight: 1.6,
}

const statCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: '8px',
  padding: '14px',
  borderRadius: '14px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#94a3b8',
}

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: active
      ? '1px solid rgba(96,165,250,0.55)'
      : '1px solid rgba(255,255,255,0.10)',
    minHeight: '44px',
    borderRadius: '14px',
    background: active
      ? 'linear-gradient(135deg, rgba(37,99,235,0.95), rgba(124,58,237,0.95))'
      : 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontWeight: 900,
    padding: '0 18px',
    cursor: 'pointer',
    boxShadow: active ? '0 12px 26px rgba(37,99,235,0.22)' : 'none',
  }
}
