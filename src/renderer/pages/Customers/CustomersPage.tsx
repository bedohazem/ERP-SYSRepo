import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../../store/auth.store'
import {
  CUSTOMER_PAYMENT_METHOD_OPTIONS,
  getPaymentMethodLabel,
} from '../../utils/payment-method'

import PaginationBar, { SYSTEM_PAGE_SIZE } from '../../components/PaginationBar'

type CustomerRow = {
  id: number
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
  points_balance: number
  total_spent: number
  balance: number
  sales_count?: number
  last_sale_at?: string | null
}

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
}

const CUSTOMER_HISTORY_PAGE_SIZE = 10
const CUSTOMER_STATEMENT_PAGE_SIZE = 20

export default function CustomersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const isAdmin = currentUser?.role === 'admin'
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [customersTotal, setCustomersTotal] = useState(0)

  const [customerPage, setCustomerPage] = useState(1)

  const [debtSummary, setDebtSummary] = useState<{
    totalDebt: number
    debtorsCount: number
    topDebtor: {
      id: number
      name: string
      balance: number
    } | null
  }>({
    totalDebt: 0,
    debtorsCount: 0,
    topDebtor: null,
  })
  const [query, setQuery] = useState('')
  const [showDebtorsOnly, setShowDebtorsOnly] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [pointsAdjust, setPointsAdjust] = useState('')
  const [pointsNotes, setPointsNotes] = useState('')
  const [message, setMessage] = useState('')

  const [loadingCustomers, setLoadingCustomers] = useState(false)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)

  const [historySalesPage, setHistorySalesPage] = useState(1)

  const [historyLoyaltyPage, setHistoryLoyaltyPage] = useState(1)

  const [statementPage, setStatementPage] = useState(1)

  const [statementData, setStatementData] = useState<any | null>(null)
  const [statementLoading, setStatementLoading] = useState(false)

  const [paymentCustomer, setPaymentCustomer] = useState<CustomerRow | null>(
    null,
  )
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)

  const [paymentAction, setPaymentAction] = useState<{
    mode: 'edit' | 'cancel'
    entry: any
  } | null>(null)

  const [paymentActionAmount, setPaymentActionAmount] = useState('')
  const [paymentActionMethod, setPaymentActionMethod] = useState('cash')
  const [paymentActionNotes, setPaymentActionNotes] = useState('')
  const [paymentActionReason, setPaymentActionReason] = useState('')
  const [paymentActionPassword, setPaymentActionPassword] = useState('')
  const [paymentActionRequirePassword, setPaymentActionRequirePassword] =
    useState(false)
  const [savingPaymentAction, setSavingPaymentAction] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<CustomerRow | null>(null)
  const [deletingCustomer, setDeletingCustomer] = useState(false)

  const editingCustomer = useMemo(
    () => customers.find((c) => c.id === editingId),
    [customers, editingId],
  )

  async function loadCustomers(
    page = customerPage,
    searchValue = query,
    debtorsOnly = showDebtorsOnly,
  ) {
    setLoadingCustomers(true)

    try {
      const safePage = Math.max(1, Number(page || 1))

      const result = await window.api.listCustomers({
        search: searchValue.trim() || undefined,

        debtors_only: debtorsOnly,

        limit: SYSTEM_PAGE_SIZE,

        offset: (safePage - 1) * SYSTEM_PAGE_SIZE,
      })

      const total = Number(result.total || 0)

      const totalPages = Math.max(1, Math.ceil(total / SYSTEM_PAGE_SIZE))

      if (safePage > totalPages) {
        setCustomerPage(totalPages)

        await loadCustomers(totalPages, searchValue, debtorsOnly)

        return
      }

      const normalizedRows = Array.isArray(result.rows)
        ? result.rows.map((customer: any) => ({
            id: Number(customer.id),
            name: customer.name || '',
            phone: customer.phone || null,
            email: customer.email || null,
            address: customer.address || null,
            notes: customer.notes || null,

            points_balance: Number(customer.points_balance || 0),

            total_spent: Number(customer.total_spent || 0),

            balance: Number(customer.balance || 0),

            sales_count: Number(customer.sales_count || 0),

            last_sale_at: customer.last_sale_at || null,
          }))
        : []

      setCustomers(normalizedRows)
      setCustomersTotal(total)
      setCustomerPage(safePage)

      setDebtSummary({
        totalDebt: Number(result.summary?.total_debt || 0),

        debtorsCount: Number(result.summary?.debtors_count || 0),

        topDebtor: result.summary?.top_debtor || null,
      })
    } catch (error) {
      console.error('Failed to load customers:', error)

      setMessage('حدث خطأ أثناء تحميل العملاء')

      setCustomers([])
      setCustomersTotal(0)

      setDebtSummary({
        totalDebt: 0,
        debtorsCount: 0,
        topDebtor: null,
      })
    } finally {
      setLoadingCustomers(false)
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      setCustomerPage(1)

      void loadCustomers(1, query, showDebtorsOnly)
    }, 250)

    return () => clearTimeout(handle)
  }, [query, showDebtorsOnly])

  useEffect(() => {
    if (!message) return

    const timer = window.setTimeout(() => {
      setMessage('')
    }, 1800)

    return () => window.clearTimeout(timer)
  }, [message])

  function startCreate() {
    setEditingId(null)
    setForm(emptyForm)
  }

  function startEdit(customer: CustomerRow) {
    setEditingId(customer.id)
    setForm({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      notes: customer.notes || '',
    })
  }

  async function saveCustomer() {
    if (savingCustomer) return

    if (!form.name.trim()) {
      setMessage('اسم العميل مطلوب')
      return
    }

    setSavingCustomer(true)

    try {
      if (editingId) {
        await window.api.updateCustomer({
          id: editingId,
          ...form,
        })
        setMessage('تم تعديل العميل')
      } else {
        await window.api.createCustomer(form)
        setMessage('تم إضافة العميل')
      }

      setForm(emptyForm)
      setEditingId(null)
      await loadCustomers(customerPage)
    } catch (error) {
      console.error('Failed to save customer:', error)
      setMessage('حدث خطأ أثناء حفظ العميل، تأكد أن رقم الهاتف غير مكرر')
    } finally {
      setSavingCustomer(false)
    }
  }

  function requestDeleteCustomer(customer: CustomerRow) {
    setDeleteTarget(customer)
  }

  async function confirmDeleteCustomer() {
    if (!deleteTarget || deletingCustomer) return

    const deletedId = deleteTarget.id

    setDeletingCustomer(true)

    try {
      await window.api.deleteCustomer(deletedId, currentUser?.id)

      if (selectedCustomer?.customer?.id === deletedId) {
        setSelectedCustomer(null)
        setPointsAdjust('')
        setPointsNotes('')
      }

      if (statementData?.customer?.id === deletedId) {
        setStatementData(null)
      }

      if (paymentCustomer?.id === deletedId) {
        setPaymentCustomer(null)
        setPaymentAmount('')
        setPaymentNotes('')
      }

      if (editingId === deletedId) {
        setEditingId(null)
        setForm(emptyForm)
      }

      setDeleteTarget(null)
      setMessage('تم حذف العميل')
      await loadCustomers(customerPage)
    } catch (error) {
      console.error('Failed to delete customer:', error)
      setMessage('حدث خطأ أثناء حذف العميل')
    } finally {
      setDeletingCustomer(false)
    }
  }

  function cancelDeleteCustomer() {
    if (deletingCustomer) return
    setDeleteTarget(null)
  }

  async function openHistory(customerId: number) {
    setHistoryLoading(true)

    try {
      const data = await window.api.getCustomerHistory(customerId)

      setSelectedCustomer({
        customer: data?.customer ?? null,
        sales: Array.isArray(data?.sales) ? data.sales : [],
        loyalty: Array.isArray(data?.loyalty) ? data.loyalty : [],
      })

      setPointsAdjust('')
      setPointsNotes('')
    } catch (error) {
      console.error('Failed to load customer history:', error)
      setMessage('حدث خطأ أثناء تحميل هيستوري العميل')
    } finally {
      setHistoryLoading(false)
      setHistorySalesPage(1)
      setHistoryLoyaltyPage(1)
    }
  }

  async function savePointsAdjust() {
    if (!selectedCustomer?.customer?.id) return

    const points = Number(pointsAdjust)

    if (!Number.isFinite(points) || points === 0) {
      setMessage('اكتب عدد نقاط صحيح، مثال: 10 أو -5')
      return
    }

    try {
      await window.api.adjustCustomerPoints({
        customer_id: selectedCustomer.customer.id,
        points,
        notes: pointsNotes.trim() || null,
        actor_id: currentUser?.id,
      })

      await openHistory(selectedCustomer.customer.id)
      await loadCustomers(customerPage)
      setMessage('تم تعديل النقاط')
    } catch (error) {
      console.error('Failed to adjust points:', error)
      setMessage('حدث خطأ أثناء تعديل النقاط')
    }
  }

  async function openStatement(customer: CustomerRow) {
    setStatementLoading(true)
    setStatementPage(1)

    try {
      const data = await window.api.getCustomerStatement(
        customer.id,
        currentUser?.id,
      )
      setStatementData(data)
    } catch (error) {
      console.error('Failed to load customer statement:', error)
      setMessage('حدث خطأ أثناء تحميل كشف الحساب')
    } finally {
      setStatementLoading(false)
    }
  }

  function openCustomerPayment(customer: CustomerRow) {
    setPaymentCustomer(customer)
    setPaymentAmount(String(Number(customer.balance || 0)))
    setPaymentMethod('cash')
    setPaymentNotes('')
  }

  async function saveCustomerPayment() {
    if (!paymentCustomer || savingPayment) return

    const amount = Number(paymentAmount || 0)

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('اكتب مبلغ صحيح')
      return
    }

    setSavingPayment(true)

    try {
      const result = await window.api.recordCustomerPayment({
        customer_id: paymentCustomer.id,
        amount,
        payment_method: paymentMethod,
        notes: paymentNotes.trim() || null,
        actor_id: currentUser?.id,
      })

      setMessage(`تم تسجيل دفعة ${money(result.paid_amount)}`)

      setPaymentCustomer(null)
      setPaymentAmount('')
      setPaymentNotes('')

      await loadCustomers(customerPage)

      if (statementData?.customer?.id === paymentCustomer.id) {
        const data = await window.api.getCustomerStatement(
          paymentCustomer.id,
          currentUser?.id,
        )
        setStatementData(data)
      }
    } catch (error) {
      console.error('Failed to save customer payment:', error)
      setMessage('حدث خطأ أثناء تسجيل الدفعة')
    } finally {
      setSavingPayment(false)
    }
  }

  function canManageStatementPayment(entry: any) {
    if (!entry?.batch_id) {
      return false
    }

    if (entry.cancelled_at || entry.replacement_batch_id) {
      return false
    }

    return (
      isAdmin ||
      Number(entry.batch_created_by || 0) === Number(currentUser?.id || 0)
    )
  }

  function openPaymentEdit(entry: any) {
    if (!canManageStatementPayment(entry)) {
      return
    }

    setPaymentAction({
      mode: 'edit',
      entry,
    })

    setPaymentActionAmount(String(Number(entry.credit || 0)))

    setPaymentActionMethod(String(entry.payment_method || 'cash'))

    setPaymentActionNotes(String(entry.notes || ''))

    setPaymentActionReason('')
    setPaymentActionPassword('')

    setPaymentActionRequirePassword(Boolean(entry.requires_admin_password))
  }

  function openPaymentCancel(entry: any) {
    if (!canManageStatementPayment(entry)) {
      return
    }

    setPaymentAction({
      mode: 'cancel',
      entry,
    })

    setPaymentActionAmount('')
    setPaymentActionMethod('cash')
    setPaymentActionNotes('')
    setPaymentActionReason('')
    setPaymentActionPassword('')

    setPaymentActionRequirePassword(Boolean(entry.requires_admin_password))
  }

  function closePaymentAction() {
    if (savingPaymentAction) {
      return
    }

    setPaymentAction(null)
    setPaymentActionAmount('')
    setPaymentActionMethod('cash')
    setPaymentActionNotes('')
    setPaymentActionReason('')
    setPaymentActionPassword('')
    setPaymentActionRequirePassword(false)
  }

  async function savePaymentAction() {
    if (!paymentAction || savingPaymentAction) {
      return
    }

    const batchId = Number(paymentAction.entry?.batch_id || 0)

    if (!batchId) {
      setMessage('رقم دفعة العميل غير صحيح')
      return
    }

    if (paymentAction.mode === 'edit') {
      const amount = Number(paymentActionAmount || 0)

      if (!Number.isFinite(amount) || amount <= 0) {
        setMessage('اكتب مبلغ دفعة صحيح')
        return
      }
    } else if (!paymentActionReason.trim()) {
      setMessage('سبب الإلغاء مطلوب')
      return
    }

    if (paymentActionRequirePassword && !paymentActionPassword.trim()) {
      setMessage('كلمة مرور المدير مطلوبة')
      return
    }

    setSavingPaymentAction(true)

    try {
      const result =
        paymentAction.mode === 'edit'
          ? await window.api.updateCustomerPayment({
              batch_id: batchId,

              amount: Number(paymentActionAmount),

              payment_method: paymentActionMethod,

              notes: paymentActionNotes.trim() || null,

              actor_id: currentUser?.id,

              admin_password: paymentActionRequirePassword
                ? paymentActionPassword
                : undefined,
            })
          : await window.api.cancelCustomerPayment({
              batch_id: batchId,

              reason: paymentActionReason.trim(),

              actor_id: currentUser?.id,

              admin_password: paymentActionRequirePassword
                ? paymentActionPassword
                : undefined,
            })

      if (!result.success) {
        const errorMessage =
          result.message ||
          (paymentAction.mode === 'edit'
            ? 'تعذر تعديل دفعة العميل'
            : 'تعذر إلغاء دفعة العميل')

        if (errorMessage.includes('كلمة مرور المدير')) {
          setPaymentActionRequirePassword(true)
        }

        setMessage(errorMessage)
        return
      }

      const customerId = Number(statementData?.customer?.id || 0)

      setPaymentAction(null)
      setPaymentActionAmount('')
      setPaymentActionNotes('')
      setPaymentActionReason('')
      setPaymentActionPassword('')
      setPaymentActionRequirePassword(false)

      await loadCustomers(customerPage)

      if (customerId) {
        const data = await window.api.getCustomerStatement(
          customerId,
          currentUser?.id,
        )

        setStatementData(data)
      }

      setMessage(
        paymentAction.mode === 'edit'
          ? 'تم تعديل دفعة العميل'
          : 'تم إلغاء دفعة العميل',
      )
    } catch (error) {
      console.error('Failed to process customer payment:', error)

      setMessage(
        paymentAction.mode === 'edit'
          ? 'حدث خطأ أثناء تعديل الدفعة'
          : 'حدث خطأ أثناء إلغاء الدفعة',
      )
    } finally {
      setSavingPaymentAction(false)
    }
  }

  function money(value: unknown) {
    return `${Number(value || 0).toFixed(2)} ج.م`
  }

  function InfoCard({ title, value }: { title: string; value: string }) {
    return (
      <div
        className="customer-info-card"
        style={{
          padding: '14px',
          borderRadius: '14px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          display: 'grid',
          gap: '8px',
        }}
      >
        <span style={{ color: '#94a3b8', fontWeight: 800 }}>{title}</span>
        <strong style={{ color: '#fff', fontSize: '18px' }}>{value}</strong>
      </div>
    )
  }

  function MiniDebtCard({ title, value }: { title: string; value: string }) {
    return (
      <div
        style={{
          padding: '10px 12px',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          display: 'grid',
          gap: '5px',
          minHeight: '54px',
        }}
      >
        <span style={{ color: '#94a3b8', fontWeight: 900, fontSize: '12px' }}>
          {title}
        </span>

        <strong
          style={{
            color: '#fff',
            fontSize: '14px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={value}
        >
          {value}
        </strong>
      </div>
    )
  }

  function formatDate(value?: string) {
    if (!value) return '—'

    try {
      const raw = String(value)
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

  return (
    <div
      style={{
        display: 'grid',
        gap: '18px',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        gridTemplateRows: 'auto auto minmax(0, 1fr)',
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
            background:
              message.includes('خطأ') || message.includes('مطلوب')
                ? 'rgba(239,68,68,0.95)'
                : 'rgba(16,185,129,0.95)',
            color: '#fff',
            fontWeight: 900,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        >
          {message}
        </div>
      )}

      <div
        className="glass-card table-scroll"
        style={{
          padding: '16px',
          borderRadius: '18px',
          overflow: 'visible',
          maxWidth: '100%',
          boxSizing: 'border-box',
          display: 'grid',
          gap: '12px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            direction: 'rtl',
          }}
        >
          <div>
            <h2 style={{ margin: 0, textAlign: 'right' }}>إدارة العملاء</h2>
            <p style={{ margin: '6px 0 0', color: '#94a3b8', fontWeight: 800 }}>
              بحث سريع ومتابعة مديونيات العملاء
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(260px, 1fr) auto minmax(520px, 2fr)',
            gap: '12px',
            alignItems: 'stretch',
            direction: 'rtl',
          }}
        >
          <input
            placeholder="بحث بالاسم / الهاتف / الإيميل"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={inputStyle}
          />

          <button
            type="button"
            onClick={() => setShowDebtorsOnly((value) => !value)}
            style={{
              ...(showDebtorsOnly
                ? primaryButtonStyle
                : secondaryOutlineButtonStyle),
              minWidth: '135px',
            }}
          >
            {showDebtorsOnly ? 'عرض الكل' : 'المديونين فقط'}
          </button>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(150px, 1fr))',
              gap: '8px',
            }}
          >
            <MiniDebtCard
              title="إجمالي المديونية"
              value={money(debtSummary.totalDebt)}
            />

            <MiniDebtCard
              title="عدد المديونين"
              value={String(debtSummary.debtorsCount)}
            />

            <MiniDebtCard
              title="أكبر مديونية"
              value={
                debtSummary.topDebtor
                  ? `${debtSummary.topDebtor.name} - ${money(debtSummary.topDebtor.balance)}`
                  : 'لا يوجد'
              }
            />
          </div>
        </div>
      </div>

      <div
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '18px',
          display: 'grid',
          gap: '12px',
          overflow: 'visible',
        }}
      >
        <h3 style={{ margin: 0, textAlign: 'right' }}>
          {editingId ? `تعديل: ${editingCustomer?.name}` : 'إضافة عميل'}
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px',
          }}
        >
          <input
            placeholder="اسم العميل"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            style={inputStyle}
          />

          <input
            placeholder="رقم الهاتف"
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            style={inputStyle}
          />

          <input
            placeholder="الإيميل"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            style={inputStyle}
          />

          <input
            placeholder="العنوان"
            value={form.address}
            onChange={(e) =>
              setForm((p) => ({ ...p, address: e.target.value }))
            }
            style={inputStyle}
          />

          <input
            placeholder="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            style={{ ...inputStyle, gridColumn: '1 / -1' }}
          />
        </div>

        <div
          style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start' }}
        >
          <button
            type="button"
            onClick={saveCustomer}
            disabled={savingCustomer}
            style={{
              ...primaryButtonStyle,
              opacity: savingCustomer ? 0.6 : 1,
              cursor: savingCustomer ? 'not-allowed' : 'pointer',
            }}
          >
            {savingCustomer
              ? 'جاري الحفظ...'
              : editingId
                ? 'حفظ التعديل'
                : 'حفظ العميل'}
          </button>

          {editingId && (
            <button
              type="button"
              onClick={startCreate}
              style={secondaryOutlineButtonStyle}
            >
              إلغاء التعديل
            </button>
          )}
        </div>
      </div>

      <div
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '18px',
          overflowX: 'auto',
        }}
      >
        <PaginationBar
          page={customerPage}
          totalItems={customersTotal}
          loading={loadingCustomers}
          onPageChange={(page) => {
            void loadCustomers(page)
          }}
        />

        <table
          style={{
            width: '100%',
            minWidth: '980px',
            borderCollapse: 'collapse',
            direction: 'rtl',
          }}
        >
          <thead>
            <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
              <th style={thStyle}>العميل</th>
              <th style={thStyle}>الهاتف</th>
              <th style={thStyle}>النقاط</th>
              <th style={thStyle}>إجمالي المشتريات</th>
              <th style={thStyle}>الرصيد</th>
              <th style={thStyle}>عدد الفواتير</th>
              <th style={thStyle}>آخر شراء</th>
              <th style={thStyle}>إجراءات</th>
            </tr>
          </thead>

          <tbody>
            {customers.map((customer) => (
              <tr
                key={customer.id}
                style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
              >
                <td style={tdStyle}>{customer.name}</td>
                <td style={tdStyle}>{customer.phone || '—'}</td>
                <td style={tdStyle}>{customer.points_balance || 0}</td>
                <td style={tdStyle}>
                  {Number(customer.total_spent || 0).toFixed(2)} ج.م
                </td>
                <td
                  style={{
                    ...tdStyle,
                    color:
                      Number(customer.balance || 0) > 0 ? '#fca5a5' : '#6ee7b7',
                    fontWeight: 900,
                  }}
                >
                  {money(customer.balance || 0)}
                </td>
                <td style={tdStyle}>{customer.sales_count || 0}</td>
                <td style={tdStyle}>{customer.last_sale_at || '—'}</td>
                <td style={tdStyle}>
                  <div
                    style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}
                  >
                    <button
                      onClick={() => startEdit(customer)}
                      style={smallButtonStyle}
                    >
                      تعديل
                    </button>
                    <button
                      onClick={() => openHistory(customer.id)}
                      style={smallButtonStyle}
                    >
                      الهيستوري
                    </button>

                    <button
                      type="button"
                      onClick={() => openStatement(customer)}
                      style={smallButtonStyle}
                    >
                      كشف حساب
                    </button>

                    {Number(customer.balance || 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => openCustomerPayment(customer)}
                        style={{
                          ...smallButtonStyle,
                          borderColor: '#22c55e',
                          color: '#86efac',
                          background: 'rgba(34,197,94,0.10)',
                        }}
                      >
                        تسجيل دفعة
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => requestDeleteCustomer(customer)}
                        style={{
                          ...smallButtonStyle,
                          borderColor: '#ef4444',
                          color: '#fca5a5',
                        }}
                      >
                        حذف
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {customers.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8' }}
                >
                  لا يوجد عملاء
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedCustomer && (
        <div
          className="theme-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            className="theme-modal-card customer-history-modal"
            style={{
              width: '850px',
              maxWidth: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              borderRadius: '18px',
              background: '#111827',
              border: '1px solid rgba(255,255,255,0.10)',
              padding: '22px',
              direction: 'rtl',
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              هيستوري العميل: {selectedCustomer.customer?.name}
            </h3>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px',
                marginBottom: '18px',
              }}
            >
              <div style={statCardStyle}>
                النقاط الحالية
                <strong>
                  {selectedCustomer.customer?.points_balance || 0}
                </strong>
              </div>
              <div style={statCardStyle}>
                إجمالي المشتريات
                <strong>
                  {Number(selectedCustomer.customer?.total_spent || 0).toFixed(
                    2,
                  )}
                </strong>
              </div>
              <div style={statCardStyle}>
                عدد الفواتير
                <strong>{selectedCustomer.sales?.length || 0}</strong>
              </div>
            </div>

            {isAdmin && (
              <>
                <h4>تعديل النقاط يدويًا</h4>
                <div
                  style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}
                >
                  <input
                    placeholder="مثال: 10 أو -5"
                    value={pointsAdjust}
                    onChange={(e) => setPointsAdjust(e.target.value)}
                    style={inputStyle}
                  />
                  <input
                    placeholder="ملاحظة"
                    value={pointsNotes}
                    onChange={(e) => setPointsNotes(e.target.value)}
                    style={inputStyle}
                  />
                  <button onClick={savePointsAdjust} style={primaryButtonStyle}>
                    حفظ
                  </button>
                </div>
              </>
            )}

            <h4>الفواتير</h4>

            <PaginationBar
              page={historySalesPage}
              totalItems={selectedCustomer.sales?.length || 0}
              pageSize={CUSTOMER_HISTORY_PAGE_SIZE}
              loading={historyLoading}
              onPageChange={setHistorySalesPage}
            />

            <div style={{ display: 'grid', gap: '8px' }}>
              {(selectedCustomer.sales ?? [])
                .slice(
                  (historySalesPage - 1) * CUSTOMER_HISTORY_PAGE_SIZE,

                  historySalesPage * CUSTOMER_HISTORY_PAGE_SIZE,
                )
                .map((sale: any) => (
                  <div
                    key={sale.id}
                    className="customer-history-row"
                    style={historyRowStyle}
                  >
                    <strong>فاتورة #{sale.id}</strong>
                    <span>{Number(sale.grand_total || 0).toFixed(2)} ج.م</span>
                    <span>+{sale.loyalty_points_earned || 0} نقطة</span>
                    <span>-{sale.loyalty_points_redeemed || 0} نقطة</span>
                    <span>{sale.created_at}</span>
                  </div>
                ))}
            </div>

            <h4>حركات النقاط</h4>

            <PaginationBar
              page={historyLoyaltyPage}
              totalItems={selectedCustomer.loyalty?.length || 0}
              pageSize={CUSTOMER_HISTORY_PAGE_SIZE}
              loading={historyLoading}
              onPageChange={setHistoryLoyaltyPage}
            />

            <div style={{ display: 'grid', gap: '8px' }}>
              {(selectedCustomer.loyalty ?? [])
                .slice(
                  (historyLoyaltyPage - 1) * CUSTOMER_HISTORY_PAGE_SIZE,

                  historyLoyaltyPage * CUSTOMER_HISTORY_PAGE_SIZE,
                )
                .map((tx: any) => (
                  <div
                    key={tx.id}
                    className="customer-history-row"
                    style={historyRowStyle}
                  >
                    <strong>{tx.type}</strong>
                    <span>{tx.points} نقطة</span>
                    <span>{tx.amount || 0} ج.م</span>
                    <span>{tx.notes || '—'}</span>
                    <span>{tx.created_at}</span>
                  </div>
                ))}
            </div>

            <button
              type="button"
              onClick={() => setSelectedCustomer(null)}
              style={{ ...secondaryOutlineButtonStyle, marginTop: '20px' }}
            >
              إغلاق
            </button>
          </div>
        </div>
      )}

      {statementData && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div
            className="theme-modal-card customer-statement-modal"
            style={{ ...modalStyle, width: '900px' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '18px',
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 6px' }}>
                  كشف حساب: {statementData.customer?.name}
                </h3>
                <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
                  متابعة فواتير العميل والمدفوعات والرصيد الحالي
                </p>
              </div>

              <button
                type="button"
                onClick={() => setStatementData(null)}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
                marginBottom: '18px',
              }}
            >
              <InfoCard
                title="إجمالي المبيعات"
                value={money(statementData.summary.total_sales)}
              />
              <InfoCard
                title="إجمالي المدفوع"
                value={money(statementData.summary.total_paid)}
              />
              <InfoCard
                title="الرصيد الحالي"
                value={money(statementData.summary.balance)}
              />
              <InfoCard
                title="فواتير مفتوحة"
                value={String(statementData.summary.open_sales)}
              />
            </div>

            {Number(statementData.summary.balance || 0) > 0 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  marginBottom: '16px',
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    openCustomerPayment({
                      id: statementData.customer.id,
                      name: statementData.customer.name,
                      phone: statementData.customer.phone,
                      email: statementData.customer.email,
                      address: statementData.customer.address,
                      notes: statementData.customer.notes,
                      points_balance: statementData.customer.points_balance,
                      total_spent: statementData.customer.total_spent,
                      balance: statementData.customer.balance,
                      sales_count: statementData.customer.sales_count,
                      last_sale_at: statementData.customer.last_sale_at,
                    })
                  }
                  style={primaryButtonStyle}
                >
                  تسجيل دفعة
                </button>
              </div>
            )}

            <PaginationBar
              page={statementPage}
              totalItems={statementData.entries?.length || 0}
              pageSize={CUSTOMER_STATEMENT_PAGE_SIZE}
              loading={statementLoading}
              onPageChange={setStatementPage}
            />

            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  direction: 'rtl',
                }}
              >
                <thead>
                  <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                    <th style={thStyle}>التاريخ</th>
                    <th style={thStyle}>البيان</th>
                    <th style={thStyle}>مدين</th>
                    <th style={thStyle}>دائن</th>
                    <th style={thStyle}>طريقة الدفع</th>
                    <th style={thStyle}>ملاحظات</th>
                    <th style={thStyle}>إجراءات</th>
                  </tr>
                </thead>

                <tbody>
                  {statementLoading && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{ ...tdStyle, textAlign: 'center' }}
                      >
                        جاري التحميل...
                      </td>
                    </tr>
                  )}

                  {!statementLoading &&
                    statementData.entries
                      .slice(
                        (statementPage - 1) * CUSTOMER_STATEMENT_PAGE_SIZE,

                        statementPage * CUSTOMER_STATEMENT_PAGE_SIZE,
                      )
                      .map((entry: any) => (
                        <tr
                          key={entry.id}
                          style={{
                            borderTop: '1px solid rgba(255,255,255,0.06)',
                          }}
                        >
                          <td style={tdStyle}>
                            {formatDate(entry.created_at)}
                          </td>
                          <td style={tdStyle}>
                            <strong>{entry.title}</strong>

                            {entry.allocations_text && (
                              <div
                                style={{
                                  marginTop: '5px',
                                  color: '#94a3b8',
                                  fontSize: '11px',
                                  whiteSpace: 'normal',
                                  lineHeight: 1.6,
                                }}
                              >
                                موزعة: {entry.allocations_text}
                              </div>
                            )}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              color: entry.debit > 0 ? '#fca5a5' : '#e5e7eb',
                            }}
                          >
                            {entry.debit > 0 ? money(entry.debit) : '—'}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              color: entry.credit > 0 ? '#6ee7b7' : '#e5e7eb',
                            }}
                          >
                            {entry.credit > 0 ? money(entry.credit) : '—'}
                          </td>
                          <td style={tdStyle}>
                            {entry.payment_method
                              ? getPaymentMethodLabel(entry.payment_method)
                              : '—'}
                          </td>
                          <td style={tdStyle}>{entry.notes || '—'}</td>
                          <td style={tdStyle}>
                            {canManageStatementPayment(entry) ? (
                              <div
                                style={{
                                  display: 'flex',
                                  gap: '6px',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => openPaymentEdit(entry)}
                                  style={{
                                    ...smallButtonStyle,
                                    color: '#fde68a',
                                    borderColor: 'rgba(245,158,11,0.45)',
                                    background: 'rgba(245,158,11,0.10)',
                                  }}
                                >
                                  تعديل
                                </button>

                                <button
                                  type="button"
                                  onClick={() => openPaymentCancel(entry)}
                                  style={{
                                    ...smallButtonStyle,
                                    color: '#fca5a5',
                                    borderColor: 'rgba(239,68,68,0.45)',
                                    background: 'rgba(239,68,68,0.10)',
                                  }}
                                >
                                  إلغاء
                                </button>
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}

                  {!statementLoading && statementData.entries.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{
                          ...tdStyle,
                          textAlign: 'center',
                          color: '#94a3b8',
                          padding: '24px',
                        }}
                      >
                        لا توجد حركات
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {paymentAction && (
        <div
          className="theme-modal-overlay"
          style={{
            ...modalOverlayStyle,
            zIndex: 999999,
            background: 'rgba(2,6,23,0.72)',
          }}
        >
          <div
            className="theme-modal-card"
            style={{
              ...modalStyle,
              width: '500px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '18px',
              }}
            >
              <div>
                <h3
                  style={{
                    margin: '0 0 6px',
                    color:
                      paymentAction.mode === 'cancel' ? '#f87171' : '#f8fafc',
                  }}
                >
                  {paymentAction.mode === 'edit'
                    ? 'تعديل دفعة العميل'
                    : 'إلغاء دفعة العميل'}
                </h3>

                <div
                  style={{
                    color: '#94a3b8',
                    fontSize: '13px',
                    fontWeight: 700,
                  }}
                >
                  قيمة الدفعة الحالية: {money(paymentAction.entry?.credit || 0)}
                </div>
              </div>

              <button
                type="button"
                onClick={closePaymentAction}
                disabled={savingPaymentAction}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            {paymentAction.entry?.allocations_text && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#cbd5e1',
                  marginBottom: '16px',
                  lineHeight: 1.7,
                }}
              >
                موزعة على: {paymentAction.entry.allocations_text}
              </div>
            )}

            {paymentAction.mode === 'edit' ? (
              <div
                style={{
                  display: 'grid',
                  gap: '14px',
                }}
              >
                <div style={fieldStyle}>
                  <label style={labelStyle}>المبلغ الصحيح</label>

                  <input
                    type="number"
                    min={0}
                    value={paymentActionAmount}
                    onChange={(e) => setPaymentActionAmount(e.target.value)}
                    style={inputStyle}
                    autoFocus
                  />
                </div>

                <div style={fieldStyle}>
                  <label style={labelStyle}>طريقة الدفع</label>

                  <select
                    value={paymentActionMethod}
                    onChange={(e) => setPaymentActionMethod(e.target.value)}
                    style={inputStyle}
                  >
                    {CUSTOMER_PAYMENT_METHOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={fieldStyle}>
                  <label style={labelStyle}>ملاحظات</label>

                  <input
                    value={paymentActionNotes}
                    onChange={(e) => setPaymentActionNotes(e.target.value)}
                    placeholder="ملاحظات الدفعة"
                    style={inputStyle}
                  />
                </div>
              </div>
            ) : (
              <div style={fieldStyle}>
                <label style={labelStyle}>سبب الإلغاء</label>

                <textarea
                  value={paymentActionReason}
                  onChange={(e) => setPaymentActionReason(e.target.value)}
                  placeholder="اكتب سبب إلغاء الدفعة"
                  autoFocus
                  style={{
                    minHeight: '90px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.10)',
                    background: 'rgba(255,255,255,0.05)',
                    color: '#fff',
                    padding: '12px',
                    outline: 'none',
                    resize: 'vertical',
                    direction: 'rtl',
                  }}
                />
              </div>
            )}

            {paymentActionRequirePassword && (
              <div
                style={{
                  ...fieldStyle,
                  marginTop: '14px',
                }}
              >
                <label style={labelStyle}>كلمة مرور المدير</label>

                <input
                  type="password"
                  value={paymentActionPassword}
                  onChange={(e) => setPaymentActionPassword(e.target.value)}
                  placeholder="كلمة مرور المدير"
                  style={inputStyle}
                />
              </div>
            )}

            {paymentAction.mode === 'cancel' && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '11px 12px',
                  borderRadius: '10px',
                  background: 'rgba(239,68,68,0.10)',
                  border: '1px solid rgba(239,68,68,0.22)',
                  color: '#fca5a5',
                  fontWeight: 800,
                  fontSize: '12px',
                  lineHeight: 1.7,
                }}
              >
                إلغاء الدفعة سيعيد المديونية على العميل والفواتير، ويلغي أثرها
                من حساب الدفع.
              </div>
            )}

            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-start',
                marginTop: '22px',
              }}
            >
              <button
                type="button"
                onClick={savePaymentAction}
                disabled={savingPaymentAction}
                style={{
                  ...primaryButtonStyle,

                  ...(paymentAction.mode === 'cancel'
                    ? {
                        background: 'rgba(239,68,68,0.18)',
                        border: '1px solid rgba(239,68,68,0.35)',
                        color: '#fca5a5',
                      }
                    : {}),

                  opacity: savingPaymentAction ? 0.6 : 1,
                }}
              >
                {savingPaymentAction
                  ? 'جاري الحفظ...'
                  : paymentAction.mode === 'edit'
                    ? 'حفظ التعديل'
                    : 'تأكيد الإلغاء'}
              </button>

              <button
                type="button"
                onClick={closePaymentAction}
                disabled={savingPaymentAction}
                style={secondaryOutlineButtonStyle}
              >
                رجوع
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentCustomer && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div
            className="theme-modal-card customer-payment-modal"
            style={modalStyle}
          >
            <h3 style={{ margin: '0 0 8px' }}>تسجيل دفعة من العميل</h3>

            <p
              style={{ margin: '0 0 18px', color: '#94a3b8', fontWeight: 700 }}
            >
              {paymentCustomer.name}
            </p>

            <div style={{ display: 'grid', gap: '14px' }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>الرصيد الحالي</label>
                <input
                  value={money(paymentCustomer.balance)}
                  readOnly
                  style={{ ...inputStyle, opacity: 0.7 }}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>مبلغ الدفعة</label>
                <input
                  type="number"
                  min={0}
                  max={paymentCustomer.balance}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>طريقة الدفع</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  style={inputStyle}
                >
                  {CUSTOMER_PAYMENT_METHOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>ملاحظات</label>
                <input
                  placeholder="مثال: دفعة من حساب العميل"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-start',
                marginTop: '22px',
              }}
            >
              <button
                type="button"
                onClick={saveCustomerPayment}
                disabled={savingPayment}
                style={{
                  ...primaryButtonStyle,
                  opacity: savingPayment ? 0.6 : 1,
                  cursor: savingPayment ? 'not-allowed' : 'pointer',
                }}
              >
                {savingPayment ? 'جاري الحفظ...' : 'حفظ الدفعة'}
              </button>

              <button
                type="button"
                onClick={() => setPaymentCustomer(null)}
                style={secondaryOutlineButtonStyle}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div
            className="theme-modal-card customer-delete-modal"
            style={modalStyle}
          >
            <h3 style={{ margin: '0 0 10px' }}>تأكيد حذف العميل</h3>

            <p
              style={{ margin: '0 0 18px', color: '#94a3b8', lineHeight: 1.8 }}
            >
              هل أنت متأكد من حذف العميل{' '}
              <strong style={{ color: '#fff' }}>{deleteTarget.name}</strong>؟
            </p>

            <div
              className="theme-danger-panel"
              style={{
                padding: '12px',
                borderRadius: '12px',
                background: 'rgba(239,68,68,0.10)',
                border: '1px solid rgba(239,68,68,0.25)',
                color: '#fca5a5',
                marginBottom: '18px',
                lineHeight: 1.8,
              }}
            >
              سيتم إخفاء العميل من القائمة، ولن يظهر في البحث العادي.
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-start',
              }}
            >
              <button
                type="button"
                onClick={confirmDeleteCustomer}
                disabled={deletingCustomer}
                style={{
                  ...primaryButtonStyle,
                  background: 'rgba(239,68,68,0.16)',
                  border: '1px solid rgba(239,68,68,0.35)',
                  color: '#fca5a5',
                  opacity: deletingCustomer ? 0.6 : 1,
                  cursor: deletingCustomer ? 'not-allowed' : 'pointer',
                }}
              >
                {deletingCustomer ? 'جاري الحذف...' : 'تأكيد الحذف'}
              </button>

              <button
                type="button"
                onClick={cancelDeleteCustomer}
                disabled={deletingCustomer}
                style={secondaryOutlineButtonStyle}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
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
  minWidth: '220px',
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

const secondaryOutlineButtonStyle: React.CSSProperties = {
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

const statCardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  borderRadius: '12px',
  padding: '14px',
  display: 'grid',
  gap: '8px',
  color: '#cbd5e1',
}

const historyRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: '8px',
  padding: '10px',
  borderRadius: '10px',
  background: 'rgba(255,255,255,0.04)',
  color: '#e5e7eb',
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.60)',
  zIndex: 99999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
}

const modalStyle: React.CSSProperties = {
  width: '480px',
  maxWidth: '100%',
  maxHeight: '88vh',
  overflowY: 'auto',
  borderRadius: '18px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: '#111827',
  padding: '22px',
  direction: 'rtl',
  boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
}

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: '8px',
}

const labelStyle: React.CSSProperties = {
  color: '#cbd5e1',
  fontWeight: 800,
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
