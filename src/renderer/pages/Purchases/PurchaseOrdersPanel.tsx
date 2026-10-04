import { useEffect, useMemo, useState } from 'react'

import type { CSSProperties } from 'react'

import { CASH_ACCOUNT_OPTIONS } from '../../utils/payment-method'
import { formatMoney } from '../../../shared/money'

type Supplier = {
  id: number
  name: string
  phone?: string | null
  balance?: number
}

type Category = {
  id: number
  name: string
}

type ReorderSuggestion = {
  variant_id: number

  product_id: number

  product_name: string

  category_id: number | null

  barcode?: string | null

  size?: string | null

  color?: string | null

  current_stock: number

  min_stock: number

  sold_units_30d: number

  average_daily_sales: number

  target_days: number

  target_stock: number

  suggested_quantity: number

  coverage_days: number | null

  unit_cost: number

  estimated_cost: number

  reason: 'out' | 'low' | 'demand'
}

type PurchaseOrderRow = {
  id: number

  supplier_id: number

  supplier_name: string

  status: 'draft' | 'ordered' | 'received' | 'cancelled'

  notes?: string | null

  purchase_id?: number | null

  items_count: number

  total_amount: number

  created_at: string

  ordered_at?: string | null

  received_at?: string | null

  cancelled_at?: string | null

  cancel_reason?: string | null
}

type PurchaseOrderItem = {
  id?: number

  variant_id: number

  product_name: string

  barcode?: string | null

  size?: string | null

  color?: string | null

  quantity: number

  unit_cost: number

  line_total: number
}

type PurchaseOrderSnapshot = {
  order: PurchaseOrderRow

  items: PurchaseOrderItem[]
}

type Props = {
  open: boolean

  onClose: () => void

  onPurchaseReceived?: () => void
}

function money(value: unknown) {
  return formatMoney(value)
}

function getErrorMessage(
  error: unknown,

  fallback: string,
) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  const match = raw.match(/Error invoking remote method '[^']+': Error: (.*)$/)

  return match?.[1] || raw || fallback
}

function statusLabel(status: string) {
  switch (status) {
    case 'draft':
      return 'مسودة'

    case 'ordered':
      return 'تم الطلب'

    case 'received':
      return 'تم الاستلام'

    case 'cancelled':
      return 'ملغى'

    default:
      return status
  }
}

function statusColor(status: string) {
  switch (status) {
    case 'draft':
      return '#93c5fd'

    case 'ordered':
      return '#fbbf24'

    case 'received':
      return '#6ee7b7'

    case 'cancelled':
      return '#fca5a5'

    default:
      return '#cbd5e1'
  }
}

function reasonLabel(reason: ReorderSuggestion['reason']) {
  if (reason === 'out') {
    return 'نافد'
  }

  if (reason === 'low') {
    return 'مخزون منخفض'
  }

  return 'طلب متوقع'
}

export default function PurchaseOrdersPanel({
  open,

  onClose,

  onPurchaseReceived,
}: Props) {
  const [tab, setTab] = useState<'reorder' | 'orders'>('reorder')

  const [message, setMessage] = useState('')

  const [loading, setLoading] = useState(false)

  const [actionLoading, setActionLoading] = useState(false)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  const [supplierSearch, setSupplierSearch] = useState('')

  const [supplierId, setSupplierId] = useState<number | ''>('')

  const [categories, setCategories] = useState<Category[]>([])

  const [categoryFilter, setCategoryFilter] = useState('all')

  const [targetDays, setTargetDays] = useState('30')

  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([])

  const [selected, setSelected] = useState<Record<number, boolean>>({})

  const [quantities, setQuantities] = useState<Record<number, string>>({})

  const [costs, setCosts] = useState<Record<number, string>>({})

  const [orderNotes, setOrderNotes] = useState('')

  const [orders, setOrders] = useState<PurchaseOrderRow[]>([])

  const [orderStatus, setOrderStatus] = useState('all')

  const [detail, setDetail] = useState<PurchaseOrderSnapshot | null>(null)

  const [detailItems, setDetailItems] = useState<PurchaseOrderItem[]>([])

  const [detailNotes, setDetailNotes] = useState('')

  const [cancelReason, setCancelReason] = useState('')

  const [receivePaid, setReceivePaid] = useState('0')

  const [receivePaymentMethod, setReceivePaymentMethod] = useState('store_cash')

  const [receiveNotes, setReceiveNotes] = useState('')

  function showMessage(text: string) {
    setMessage(text)

    window.setTimeout(() => {
      setMessage('')
    }, 4000)
  }

  async function loadSuppliers(search = supplierSearch) {
    try {
      const result = await window.api.listSuppliers({
        search: search.trim() || undefined,

        limit: 50,

        offset: 0,
      })

      setSuppliers(Array.isArray(result?.rows) ? result.rows : [])
    } catch (error) {
      console.error(error)

      setSuppliers([])
    }
  }

  async function loadSuggestions() {
    setLoading(true)

    try {
      const result = await window.api.getPurchaseReorderSuggestions({
        categoryId: categoryFilter,

        targetDays: Number(targetDays || 30),
      })

      const rows = Array.isArray(result) ? result : []

      setSuggestions(rows)

      const nextQty: Record<number, string> = {}

      const nextCosts: Record<number, string> = {}

      for (const row of rows) {
        nextQty[row.variant_id] = String(row.suggested_quantity)

        nextCosts[row.variant_id] = String(row.unit_cost || 0)
      }

      setQuantities(nextQty)

      setCosts(nextCosts)

      setSelected({})
    } catch (error) {
      console.error(error)

      showMessage(
        getErrorMessage(
          error,

          'تعذر تحميل اقتراحات إعادة الطلب',
        ),
      )

      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }

  async function loadOrders() {
    setLoading(true)

    try {
      const result = await window.api.listPurchaseOrders({
        status: orderStatus,
      })

      setOrders(Array.isArray(result) ? result : [])
    } catch (error) {
      console.error(error)

      showMessage(
        getErrorMessage(
          error,

          'تعذر تحميل أوامر الشراء',
        ),
      )

      setOrders([])
    } finally {
      setLoading(false)
    }
  }

  async function openOrder(orderId: number) {
    setActionLoading(true)

    try {
      const result = await window.api.getPurchaseOrder(orderId)

      setDetail(result)

      setDetailItems(
        (result.items || []).map((item: any) => ({
          ...item,

          quantity: Number(item.quantity || 0),

          unit_cost: Number(item.unit_cost || 0),

          line_total: Number(item.line_total || 0),
        })),
      )

      setDetailNotes(result.order.notes || '')

      setCancelReason('')

      setReceivePaid('0')

      setReceivePaymentMethod('store_cash')

      setReceiveNotes('')
    } catch (error) {
      console.error(error)

      showMessage(
        getErrorMessage(
          error,

          'تعذر فتح أمر الشراء',
        ),
      )
    } finally {
      setActionLoading(false)
    }
  }

  useEffect(() => {
    if (!open) {
      return
    }

    void loadSuppliers('')

    window.api
      .getCategories()
      .then((result) => {
        setCategories(Array.isArray(result) ? result : [])
      })
      .catch((error) => {
        console.error(error)

        setCategories([])
      })

    if (tab === 'reorder') {
      void loadSuggestions()
    } else {
      void loadOrders()
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    const handle = window.setTimeout(() => {
      void loadSuppliers(supplierSearch)
    }, 250)

    return () => {
      window.clearTimeout(handle)
    }
  }, [open, supplierSearch])

  useEffect(() => {
    if (!open) {
      return
    }

    if (tab === 'orders') {
      void loadOrders()
    }
  }, [open, tab, orderStatus])

  useEffect(() => {
    if (!open) {
      return
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }

      if (detail) {
        setDetail(null)
        return
      }

      onClose()
    }

    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, detail, onClose])

  const selectedSuggestions = useMemo(
    () => suggestions.filter((row) => Boolean(selected[row.variant_id])),
    [suggestions, selected],
  )

  const selectedEstimatedCost = useMemo(
    () =>
      selectedSuggestions.reduce((sum, row) => {
        const quantity = Math.max(0, Number(quantities[row.variant_id] || 0))

        const cost = Math.max(0, Number(costs[row.variant_id] || 0))

        return sum + quantity * cost
      }, 0),
    [selectedSuggestions, quantities, costs],
  )

  function toggleAllSuggestions() {
    const allSelected =
      suggestions.length > 0 &&
      suggestions.every((row) => Boolean(selected[row.variant_id]))

    const next: Record<number, boolean> = {}

    for (const row of suggestions) {
      next[row.variant_id] = !allSelected
    }

    setSelected(next)
  }

  async function createOrderFromSuggestions() {
    if (!supplierId) {
      showMessage('اختار المورد أولًا')

      return
    }

    if (selectedSuggestions.length === 0) {
      showMessage('اختار صنفًا واحدًا على الأقل')

      return
    }

    const items = selectedSuggestions.map((row) => ({
      variant_id: row.variant_id,

      quantity: Number(quantities[row.variant_id] || 0),

      unit_cost: Number(costs[row.variant_id] || 0),
    }))

    if (
      items.some(
        (item) => !Number.isFinite(item.quantity) || item.quantity <= 0,
      )
    ) {
      showMessage('راجع الكميات المختارة')

      return
    }

    if (
      items.some(
        (item) => !Number.isFinite(item.unit_cost) || item.unit_cost < 0,
      )
    ) {
      showMessage('راجع أسعار الشراء')

      return
    }

    setActionLoading(true)

    try {
      const result = await window.api.createPurchaseOrder({
        supplier_id: Number(supplierId),

        notes: orderNotes.trim() || null,

        items,
      })

      showMessage(`تم إنشاء أمر الشراء #${result.purchase_order_id}`)

      setOrderNotes('')

      setSelected({})

      setTab('orders')

      setOrderStatus('all')

      await loadOrders()

      await openOrder(Number(result.purchase_order_id))
    } catch (error) {
      console.error(error)

      showMessage(
        getErrorMessage(
          error,

          'تعذر إنشاء أمر الشراء',
        ),
      )
    } finally {
      setActionLoading(false)
    }
  }

  function updateDetailItem(
    variantId: number,

    patch: Partial<PurchaseOrderItem>,
  ) {
    setDetailItems((prev) =>
      prev.map((item) =>
        item.variant_id === variantId
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    )
  }

  async function saveDraftOrder(): Promise<boolean> {
    if (!detail) {
      return false
    }

    const items = detailItems.map((item) => ({
      variant_id: item.variant_id,

      quantity: Number(item.quantity || 0),

      unit_cost: Number(item.unit_cost || 0),
    }))

    if (
      items.some(
        (item) => !Number.isFinite(item.quantity) || item.quantity <= 0,
      )
    ) {
      showMessage('راجع كميات أمر الشراء')

      return false
    }

    if (
      items.some(
        (item) => !Number.isFinite(item.unit_cost) || item.unit_cost < 0,
      )
    ) {
      showMessage('راجع أسعار الشراء')

      return false
    }

    setActionLoading(true)

    try {
      const result = await window.api.updatePurchaseOrder({
        purchase_order_id: detail.order.id,

        supplier_id: detail.order.supplier_id,

        notes: detailNotes.trim() || null,

        items,
      })

      setDetail(result)

      setDetailItems(result.items || [])

      setDetailNotes(result.order.notes || '')

      showMessage('تم حفظ تعديل أمر الشراء')

      await loadOrders()

      return true
    } catch (error) {
      console.error(error)

      showMessage(
        getErrorMessage(
          error,

          'تعذر تعديل أمر الشراء',
        ),
      )

      return false
    } finally {
      setActionLoading(false)
    }
  }

  async function markOrdered() {
    if (!detail) {
      return
    }

    setActionLoading(true)

    try {
      const result = await window.api.markPurchaseOrderOrdered({
        purchase_order_id: detail.order.id,
      })

      setDetail(result)

      setDetailItems(result.items || [])

      showMessage('تم اعتماد أمر الشراء وإرساله للمورد')

      await loadOrders()
    } catch (error) {
      console.error(error)

      showMessage(
        getErrorMessage(
          error,

          'تعذر اعتماد أمر الشراء',
        ),
      )
    } finally {
      setActionLoading(false)
    }
  }

  async function cancelOrder() {
    if (!detail) {
      return
    }

    setActionLoading(true)

    try {
      await window.api.cancelPurchaseOrder({
        purchase_order_id: detail.order.id,

        reason: cancelReason.trim() || 'إلغاء أمر الشراء',
      })

      showMessage('تم إلغاء أمر الشراء')

      await openOrder(detail.order.id)

      await loadOrders()
    } catch (error) {
      console.error(error)

      showMessage(
        getErrorMessage(
          error,

          'تعذر إلغاء أمر الشراء',
        ),
      )
    } finally {
      setActionLoading(false)
    }
  }

  async function receiveOrder() {
    if (!detail) {
      return
    }

    if (detailItems.some((item) => Number(item.unit_cost || 0) <= 0)) {
      showMessage('حدد سعر شراء صحيح لكل الأصناف قبل الاستلام')

      return
    }

    const paid = Number(receivePaid || 0)

    if (!Number.isFinite(paid) || paid < 0) {
      showMessage('قيمة المدفوع غير صحيحة')

      return
    }

    /*
     * لو ما زلنا في المسودة
     * نحفظ أي تعديل على
     * الكميات والأسعار أولًا.
     */
    if (detail.order.status === 'draft') {
      const saved = await saveDraftOrder()

      if (!saved) {
        return
      }
    }

    setActionLoading(true)

    try {
      const result = await window.api.receivePurchaseOrder({
        purchase_order_id: detail.order.id,

        paid_amount: paid,

        payment_method: receivePaymentMethod,

        notes: receiveNotes.trim() || `استلام أمر شراء #${detail.order.id}`,
      })

      showMessage(
        `تم استلام أمر الشراء وإنشاء فاتورة شراء #${result.purchaseId}`,
      )

      onPurchaseReceived?.()

      await openOrder(detail.order.id)

      await loadOrders()
    } catch (error) {
      console.error(error)

      showMessage(
        getErrorMessage(
          error,

          'تعذر استلام أمر الشراء. لم يتم تطبيق أي تغييرات.',
        ),
      )
    } finally {
      setActionLoading(false)
    }
  }

  if (!open) {
    return null
  }

  return (
    <div style={overlayStyle}>
      {message && <div style={messageStyle}>{message}</div>}

      <div className="glass-card" style={panelStyle}>
        <div
          style={{
            display: 'flex',

            justifyContent: 'space-between',

            alignItems: 'center',

            gap: '12px',

            direction: 'rtl',

            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
              }}
            >
              إعادة الطلب وأوامر الشراء
            </h2>

            <div
              style={{
                color: '#94a3b8',

                fontSize: '12px',

                marginTop: '4px',
              }}
            >
              الأمر لا يغير المخزون إلا عند الاستلام وتحويله إلى فاتورة شراء
            </div>
          </div>

          <button type="button" onClick={onClose} style={closeButtonStyle}>
            ×
          </button>
        </div>

        <div
          style={{
            display: 'flex',

            gap: '8px',

            direction: 'rtl',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setTab('reorder')

              setDetail(null)

              void loadSuggestions()
            }}
            style={tabButtonStyle(tab === 'reorder')}
          >
            إعادة الطلب الذكي
          </button>

          <button
            type="button"
            onClick={() => {
              setTab('orders')

              setDetail(null)
            }}
            style={tabButtonStyle(tab === 'orders')}
          >
            أوامر الشراء
          </button>
        </div>

        {tab === 'reorder' && (
          <>
            <div style={filtersStyle}>
              <div style={fieldStyle}>
                <label style={labelStyle}>التصنيف</label>

                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  style={inputStyle}
                >
                  <option value="all">كل التصنيفات</option>

                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>تغطية الطلب</label>

                <select
                  value={targetDays}
                  onChange={(event) => setTargetDays(event.target.value)}
                  style={inputStyle}
                >
                  <option value="7">7 أيام</option>

                  <option value="14">14 يوم</option>

                  <option value="30">30 يوم</option>

                  <option value="60">60 يوم</option>

                  <option value="90">90 يوم</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => void loadSuggestions()}
                disabled={loading}
                style={primaryButtonStyle}
              >
                تحديث الاقتراحات
              </button>
            </div>

            <div style={filtersStyle}>
              <div style={fieldStyle}>
                <label style={labelStyle}>بحث المورد</label>

                <input
                  value={supplierSearch}
                  onChange={(event) => setSupplierSearch(event.target.value)}
                  placeholder="اسم أو هاتف المورد"
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>المورد</label>

                <select
                  value={supplierId}
                  onChange={(event) =>
                    setSupplierId(
                      event.target.value ? Number(event.target.value) : '',
                    )
                  }
                  style={inputStyle}
                >
                  <option value="">اختار المورد</option>

                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>ملاحظات أمر الشراء</label>

                <input
                  value={orderNotes}
                  onChange={(event) => setOrderNotes(event.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',

                justifyContent: 'space-between',

                gap: '10px',

                flexWrap: 'wrap',

                direction: 'rtl',
              }}
            >
              <button
                type="button"
                onClick={toggleAllSuggestions}
                style={secondaryButtonStyle}
              >
                تحديد / إلغاء الكل
              </button>

              <div
                style={{
                  display: 'flex',

                  gap: '12px',

                  alignItems: 'center',

                  flexWrap: 'wrap',
                }}
              >
                <strong>المختار: {selectedSuggestions.length}</strong>

                <strong
                  style={{
                    color: '#6ee7b7',
                  }}
                >
                  التكلفة التقديرية: {money(selectedEstimatedCost)}
                </strong>

                <button
                  type="button"
                  onClick={() => void createOrderFromSuggestions()}
                  disabled={
                    actionLoading ||
                    !supplierId ||
                    selectedSuggestions.length === 0
                  }
                  style={{
                    ...primaryButtonStyle,

                    opacity:
                      actionLoading ||
                      !supplierId ||
                      selectedSuggestions.length === 0
                        ? 0.55
                        : 1,
                  }}
                >
                  إنشاء أمر شراء
                </button>
              </div>
            </div>

            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>اختيار</th>

                    <th style={thStyle}>الصنف</th>

                    <th style={thStyle}>المخزون</th>

                    <th style={thStyle}>حد أدنى</th>

                    <th style={thStyle}>مباع 30 يوم</th>

                    <th style={thStyle}>التغطية الحالية</th>

                    <th style={thStyle}>السبب</th>

                    <th style={thStyle}>الكمية المقترحة</th>

                    <th style={thStyle}>سعر الشراء</th>

                    <th style={thStyle}>التكلفة</th>
                  </tr>
                </thead>

                <tbody>
                  {suggestions.map((row) => {
                    const quantity = Number(quantities[row.variant_id] || 0)

                    const cost = Number(costs[row.variant_id] || 0)

                    return (
                      <tr key={row.variant_id}>
                        <td style={tdStyle}>
                          <input
                            type="checkbox"
                            checked={Boolean(selected[row.variant_id])}
                            onChange={(event) =>
                              setSelected((prev) => ({
                                ...prev,

                                [row.variant_id]: event.target.checked,
                              }))
                            }
                          />
                        </td>

                        <td style={tdStyle}>
                          <strong>{row.product_name}</strong>

                          <div style={mutedStyle}>
                            {row.barcode || '—'} | {row.size || '—'} /{' '}
                            {row.color || '—'}
                          </div>
                        </td>

                        <td style={tdStyle}>{row.current_stock}</td>

                        <td style={tdStyle}>{row.min_stock}</td>

                        <td style={tdStyle}>{row.sold_units_30d}</td>

                        <td style={tdStyle}>
                          {row.coverage_days === null
                            ? '—'
                            : `${row.coverage_days} يوم`}
                        </td>

                        <td style={tdStyle}>{reasonLabel(row.reason)}</td>

                        <td style={tdStyle}>
                          <input
                            type="number"
                            min={1}
                            value={quantities[row.variant_id] ?? ''}
                            onChange={(event) =>
                              setQuantities((prev) => ({
                                ...prev,

                                [row.variant_id]: event.target.value,
                              }))
                            }
                            style={numberInputStyle}
                          />
                        </td>

                        <td style={tdStyle}>
                          <input
                            type="number"
                            min={0}
                            value={costs[row.variant_id] ?? ''}
                            onChange={(event) =>
                              setCosts((prev) => ({
                                ...prev,

                                [row.variant_id]: event.target.value,
                              }))
                            }
                            style={numberInputStyle}
                          />
                        </td>

                        <td
                          style={{
                            ...tdStyle,

                            color: '#6ee7b7',

                            fontWeight: 900,
                          }}
                        >
                          {money(quantity * cost)}
                        </td>
                      </tr>
                    )
                  })}

                  {!loading && suggestions.length === 0 && (
                    <tr>
                      <td
                        colSpan={10}
                        style={{
                          ...tdStyle,

                          textAlign: 'center',

                          padding: '28px',

                          color: '#94a3b8',
                        }}
                      >
                        لا توجد أصناف تحتاج إعادة طلب حاليًا
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'orders' && !detail && (
          <>
            <div
              style={{
                display: 'flex',

                gap: '10px',

                alignItems: 'end',

                flexWrap: 'wrap',

                direction: 'rtl',
              }}
            >
              <div style={fieldStyle}>
                <label style={labelStyle}>حالة الأمر</label>

                <select
                  value={orderStatus}
                  onChange={(event) => setOrderStatus(event.target.value)}
                  style={inputStyle}
                >
                  <option value="all">الكل</option>

                  <option value="draft">مسودة</option>

                  <option value="ordered">تم الطلب</option>

                  <option value="received">تم الاستلام</option>

                  <option value="cancelled">ملغى</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => void loadOrders()}
                style={secondaryButtonStyle}
              >
                تحديث
              </button>
            </div>

            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>رقم</th>

                    <th style={thStyle}>المورد</th>

                    <th style={thStyle}>الحالة</th>

                    <th style={thStyle}>الأصناف</th>

                    <th style={thStyle}>الإجمالي</th>

                    <th style={thStyle}>فاتورة الشراء</th>

                    <th style={thStyle}>التاريخ</th>

                    <th style={thStyle}>فتح</th>
                  </tr>
                </thead>

                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td style={tdStyle}>#{order.id}</td>

                      <td style={tdStyle}>{order.supplier_name}</td>

                      <td style={tdStyle}>
                        <strong
                          style={{
                            color: statusColor(order.status),
                          }}
                        >
                          {statusLabel(order.status)}
                        </strong>
                      </td>

                      <td style={tdStyle}>{order.items_count}</td>

                      <td style={tdStyle}>{money(order.total_amount)}</td>

                      <td style={tdStyle}>
                        {order.purchase_id ? `#${order.purchase_id}` : '—'}
                      </td>

                      <td style={tdStyle}>{order.created_at}</td>

                      <td style={tdStyle}>
                        <button
                          type="button"
                          onClick={() => void openOrder(order.id)}
                          style={secondaryButtonStyle}
                        >
                          فتح
                        </button>
                      </td>
                    </tr>
                  ))}

                  {!loading && orders.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        style={{
                          ...tdStyle,

                          textAlign: 'center',

                          padding: '28px',

                          color: '#94a3b8',
                        }}
                      >
                        لا توجد أوامر شراء
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'orders' && detail && (
          <div
            style={{
              display: 'grid',

              gap: '14px',
            }}
          >
            <div
              style={{
                display: 'flex',

                justifyContent: 'space-between',

                alignItems: 'center',

                gap: '10px',

                flexWrap: 'wrap',

                direction: 'rtl',
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                  }}
                >
                  أمر شراء #{detail.order.id}
                </h3>

                <div style={mutedStyle}>
                  المورد: {detail.order.supplier_name}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',

                  gap: '8px',

                  alignItems: 'center',
                }}
              >
                <strong
                  style={{
                    color: statusColor(detail.order.status),
                  }}
                >
                  {statusLabel(detail.order.status)}
                </strong>

                <button
                  type="button"
                  onClick={() => setDetail(null)}
                  style={secondaryButtonStyle}
                >
                  رجوع
                </button>
              </div>
            </div>

            {detail.order.status === 'draft' && (
              <div style={fieldStyle}>
                <label style={labelStyle}>ملاحظات الأمر</label>

                <input
                  value={detailNotes}
                  onChange={(event) => setDetailNotes(event.target.value)}
                  style={inputStyle}
                />
              </div>
            )}

            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>الصنف</th>

                    <th style={thStyle}>الكمية</th>

                    <th style={thStyle}>سعر الشراء</th>

                    <th style={thStyle}>الإجمالي</th>
                  </tr>
                </thead>

                <tbody>
                  {detailItems.map((item) => (
                    <tr key={item.variant_id}>
                      <td style={tdStyle}>
                        <strong>{item.product_name}</strong>

                        <div style={mutedStyle}>
                          {item.barcode || '—'} | {item.size || '—'} /{' '}
                          {item.color || '—'}
                        </div>
                      </td>

                      <td style={tdStyle}>
                        {detail.order.status === 'draft' ? (
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(event) =>
                              updateDetailItem(
                                item.variant_id,

                                {
                                  quantity: Math.max(
                                    1,

                                    Number(event.target.value || 1),
                                  ),
                                },
                              )
                            }
                            style={numberInputStyle}
                          />
                        ) : (
                          item.quantity
                        )}
                      </td>

                      <td style={tdStyle}>
                        {detail.order.status === 'draft' ? (
                          <input
                            type="number"
                            min={0}
                            value={item.unit_cost}
                            onChange={(event) =>
                              updateDetailItem(
                                item.variant_id,

                                {
                                  unit_cost: Math.max(
                                    0,

                                    Number(event.target.value || 0),
                                  ),
                                },
                              )
                            }
                            style={numberInputStyle}
                          />
                        ) : (
                          money(item.unit_cost)
                        )}
                      </td>

                      <td
                        style={{
                          ...tdStyle,

                          fontWeight: 900,
                        }}
                      >
                        {money(
                          Number(item.quantity || 0) *
                            Number(item.unit_cost || 0),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {detail.order.status === 'draft' && (
              <div
                style={{
                  display: 'flex',

                  gap: '8px',

                  flexWrap: 'wrap',

                  direction: 'rtl',
                }}
              >
                <button
                  type="button"
                  onClick={() => void saveDraftOrder()}
                  disabled={actionLoading}
                  style={secondaryButtonStyle}
                >
                  حفظ تعديل المسودة
                </button>

                <button
                  type="button"
                  onClick={() => void markOrdered()}
                  disabled={actionLoading}
                  style={primaryButtonStyle}
                >
                  اعتماد وإرسال للمورد
                </button>
              </div>
            )}

            {(detail.order.status === 'draft' ||
              detail.order.status === 'ordered') && (
              <div
                style={{
                  border: '1px solid rgba(16,185,129,0.30)',

                  background: 'rgba(16,185,129,0.07)',

                  borderRadius: '14px',

                  padding: '14px',

                  display: 'grid',

                  gap: '12px',
                }}
              >
                <strong
                  style={{
                    color: '#6ee7b7',
                  }}
                >
                  استلام وتحويل إلى فاتورة شراء
                </strong>

                <div style={filtersStyle}>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>المدفوع الآن</label>

                    <input
                      type="number"
                      min={0}
                      value={receivePaid}
                      onChange={(event) => setReceivePaid(event.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  <div style={fieldStyle}>
                    <label style={labelStyle}>الحساب المالي</label>

                    <select
                      value={receivePaymentMethod}
                      onChange={(event) =>
                        setReceivePaymentMethod(event.target.value)
                      }
                      style={inputStyle}
                    >
                      {CASH_ACCOUNT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={fieldStyle}>
                    <label style={labelStyle}>ملاحظات الاستلام</label>

                    <input
                      value={receiveNotes}
                      onChange={(event) => setReceiveNotes(event.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void receiveOrder()}
                  disabled={actionLoading}
                  style={successButtonStyle}
                >
                  استلام الأمر وإنشاء فاتورة الشراء
                </button>
              </div>
            )}

            {(detail.order.status === 'draft' ||
              detail.order.status === 'ordered') && (
              <div
                style={{
                  display: 'grid',

                  gap: '8px',

                  border: '1px solid rgba(239,68,68,0.25)',

                  borderRadius: '14px',

                  padding: '12px',
                }}
              >
                <label style={labelStyle}>سبب الإلغاء</label>

                <input
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  style={inputStyle}
                />

                <button
                  type="button"
                  onClick={() => void cancelOrder()}
                  disabled={actionLoading}
                  style={dangerButtonStyle}
                >
                  إلغاء أمر الشراء
                </button>
              </div>
            )}

            {detail.order.status === 'received' && (
              <div
                style={{
                  padding: '14px',

                  borderRadius: '14px',

                  color: '#6ee7b7',

                  background: 'rgba(16,185,129,0.08)',

                  border: '1px solid rgba(16,185,129,0.28)',

                  fontWeight: 900,
                }}
              >
                تم استلام أمر الشراء وإنشاء فاتورة شراء
                {detail.order.purchase_id
                  ? ` #${detail.order.purchase_id}`
                  : ''}
              </div>
            )}

            {detail.order.status === 'cancelled' && (
              <div
                style={{
                  padding: '14px',

                  borderRadius: '14px',

                  color: '#fca5a5',

                  background: 'rgba(239,68,68,0.08)',

                  border: '1px solid rgba(239,68,68,0.28)',
                }}
              >
                أمر الشراء ملغى
                {detail.order.cancel_reason
                  ? ` — ${detail.order.cancel_reason}`
                  : ''}
              </div>
            )}
          </div>
        )}

        {loading && (
          <div
            style={{
              color: '#94a3b8',

              textAlign: 'center',

              padding: '10px',
            }}
          >
            جاري التحميل...
          </div>
        )}
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',

  inset: 0,

  zIndex: 100500,

  background: 'rgba(0,0,0,0.72)',

  display: 'grid',

  placeItems: 'center',

  padding: '18px',
}

const panelStyle: CSSProperties = {
  width: 'min(1500px, 98vw)',

  height: 'min(900px, 94vh)',

  overflowY: 'auto',

  padding: '18px',

  borderRadius: '20px',

  display: 'grid',

  alignContent: 'start',

  gap: '14px',

  direction: 'rtl',
}

const messageStyle: CSSProperties = {
  position: 'fixed',

  top: '22px',

  left: '50%',

  transform: 'translateX(-50%)',

  zIndex: 100700,

  padding: '12px 18px',

  borderRadius: '12px',

  background: 'rgba(15,23,42,0.98)',

  color: '#fff',

  fontWeight: 900,

  boxShadow: '0 18px 45px rgba(0,0,0,0.45)',
}

const filtersStyle: CSSProperties = {
  display: 'grid',

  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',

  gap: '10px',

  alignItems: 'end',

  direction: 'rtl',
}

const fieldStyle: CSSProperties = {
  display: 'grid',

  gap: '6px',
}

const labelStyle: CSSProperties = {
  color: '#cbd5e1',

  fontSize: '12px',

  fontWeight: 800,

  textAlign: 'right',
}

const inputStyle: CSSProperties = {
  width: '100%',

  minHeight: '42px',

  borderRadius: '10px',

  border: '1px solid rgba(255,255,255,0.10)',

  background: 'rgba(15,23,42,0.72)',

  color: '#fff',

  padding: '9px 11px',

  outline: 'none',

  boxSizing: 'border-box',
}

const numberInputStyle: CSSProperties = {
  ...inputStyle,

  width: '105px',

  textAlign: 'center',
}

const tableWrapStyle: CSSProperties = {
  overflowX: 'auto',

  border: '1px solid rgba(255,255,255,0.07)',

  borderRadius: '14px',
}

const tableStyle: CSSProperties = {
  width: '100%',

  minWidth: '1050px',

  borderCollapse: 'collapse',

  direction: 'rtl',
}

const thStyle: CSSProperties = {
  padding: '11px',

  textAlign: 'right',

  color: '#cbd5e1',

  borderBottom: '1px solid rgba(255,255,255,0.10)',

  fontSize: '12px',
}

const tdStyle: CSSProperties = {
  padding: '11px',

  borderBottom: '1px solid rgba(255,255,255,0.05)',

  textAlign: 'right',

  color: '#e5e7eb',
}

const mutedStyle: CSSProperties = {
  color: '#94a3b8',

  fontSize: '11px',

  marginTop: '3px',
}

const primaryButtonStyle: CSSProperties = {
  border: 'none',

  borderRadius: '10px',

  padding: '10px 14px',

  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',

  color: '#fff',

  fontWeight: 900,

  cursor: 'pointer',
}

const successButtonStyle: CSSProperties = {
  ...primaryButtonStyle,

  background: 'linear-gradient(135deg, #059669, #16a34a)',
}

const secondaryButtonStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',

  borderRadius: '10px',

  padding: '9px 13px',

  background: 'rgba(255,255,255,0.06)',

  color: '#e5e7eb',

  fontWeight: 800,

  cursor: 'pointer',
}

const dangerButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,

  color: '#fca5a5',

  border: '1px solid rgba(239,68,68,0.35)',

  background: 'rgba(239,68,68,0.08)',
}

const closeButtonStyle: CSSProperties = {
  border: 'none',

  width: '40px',

  height: '40px',

  borderRadius: '10px',

  background: 'rgba(255,255,255,0.07)',

  color: '#fff',

  fontSize: '24px',

  cursor: 'pointer',
}

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    ...secondaryButtonStyle,

    background: active ? 'rgba(37,99,235,0.24)' : 'rgba(255,255,255,0.05)',

    color: active ? '#93c5fd' : '#cbd5e1',

    border: active
      ? '1px solid rgba(59,130,246,0.45)'
      : '1px solid rgba(255,255,255,0.10)',
  }
}
