import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../../store/auth.store'
import { CASH_ACCOUNT_OPTIONS } from '../../utils/payment-method'
import PaginationBar, { SYSTEM_PAGE_SIZE } from '../../components/PaginationBar'

function roundMoney(value: number) {
  const amount = Number(value || 0)

  if (!Number.isFinite(amount)) {
    return 0
  }

  return Math.round((amount + Number.EPSILON) * 100) / 100
}

function hasRemainingAmount(value: number) {
  return roundMoney(value) > 0
}

type Supplier = {
  id: number
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
  total_purchased: number
  balance: number
  created_at: string
}

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
}

const SUPPLIER_STATEMENT_PAGE_SIZE = 20

export default function SuppliersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const isAdmin = currentUser?.role === 'admin'
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [suppliersTotal, setSuppliersTotal] = useState(0)

  const [supplierPage, setSupplierPage] = useState(1)

  const [supplierStatementPage, setSupplierStatementPage] = useState(1)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [statementData, setStatementData] = useState<any | null>(null)
  const [statementLoading, setStatementLoading] = useState(false)

  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('store_cash')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)
  const [paymentAction, setPaymentAction] = useState<{
    mode: 'edit' | 'cancel'
    entry: any
  } | null>(null)

  const [paymentActionAmount, setPaymentActionAmount] = useState('')

  const [paymentActionMethod, setPaymentActionMethod] = useState('store_cash')

  const [paymentActionNotes, setPaymentActionNotes] = useState('')

  const [paymentActionReason, setPaymentActionReason] = useState('')

  const [paymentActionPassword, setPaymentActionPassword] = useState('')

  const [paymentActionRequirePassword, setPaymentActionRequirePassword] =
    useState(false)

  const [savingPaymentAction, setSavingPaymentAction] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null)
  const [deletingSupplier, setDeletingSupplier] = useState(false)

  const editingSupplier = useMemo(
    () => suppliers.find((x) => x.id === editingId),
    [suppliers, editingId],
  )

  function showMessage(text: string) {
    setMessage(text)
    setTimeout(() => setMessage(''), 1800)
  }

  async function loadSuppliers(page = supplierPage, searchValue = search) {
    setLoading(true)

    try {
      const safePage = Math.max(1, Number(page || 1))

      const result = await window.api.listSuppliers({
        search: searchValue.trim() || undefined,

        limit: SYSTEM_PAGE_SIZE,

        offset: (safePage - 1) * SYSTEM_PAGE_SIZE,
      })

      const total = Number(result.total || 0)

      const totalPages = Math.max(1, Math.ceil(total / SYSTEM_PAGE_SIZE))

      if (safePage > totalPages) {
        setSupplierPage(totalPages)

        await loadSuppliers(totalPages, searchValue)

        return
      }

      setSuppliers(Array.isArray(result.rows) ? result.rows : [])

      setSuppliersTotal(total)
      setSupplierPage(safePage)
    } catch (error) {
      console.error('Failed to load suppliers:', error)

      showMessage('حدث خطأ أثناء تحميل الموردين')

      setSuppliers([])
      setSuppliersTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      setSupplierPage(1)

      void loadSuppliers(1, search)
    }, 250)

    return () => clearTimeout(handle)
  }, [search])

  function startCreate() {
    setEditingId(null)
    setForm(emptyForm)
  }

  function startEdit(supplier: Supplier) {
    setEditingId(supplier.id)
    setForm({
      name: supplier.name || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      address: supplier.address || '',
      notes: supplier.notes || '',
    })
  }

  async function saveSupplier() {
    if (saving) return

    if (!form.name.trim()) {
      showMessage('اسم المورد مطلوب')
      return
    }

    setSaving(true)

    try {
      if (editingId) {
        await window.api.updateSupplier({
          id: editingId,
          ...form,
          actor_id: currentUser?.id,
        })

        showMessage('تم تعديل المورد')
      } else {
        await window.api.createSupplier({
          ...form,
          actor_id: currentUser?.id,
        })
        showMessage('تم إضافة المورد')
      }

      setForm(emptyForm)
      setEditingId(null)
      await loadSuppliers(supplierPage)
    } catch (error) {
      console.error('Failed to save supplier:', error)
      showMessage('حدث خطأ أثناء حفظ المورد، تأكد أن رقم الهاتف غير مكرر')
    } finally {
      setSaving(false)
    }
  }

  function requestDeleteSupplier(supplier: Supplier) {
    setDeleteTarget(supplier)
  }

  function cancelDeleteSupplier() {
    if (deletingSupplier) return
    setDeleteTarget(null)
  }

  async function confirmDeleteSupplier() {
    if (!deleteTarget || deletingSupplier) return

    const deletedId = deleteTarget.id

    setDeletingSupplier(true)

    try {
      await window.api.deleteSupplier(deletedId, currentUser?.id)

      if (statementData?.supplier?.id === deletedId) {
        setStatementData(null)
      }

      if (paymentSupplier?.id === deletedId) {
        setPaymentSupplier(null)
        setPaymentAmount('')
        setPaymentNotes('')
      }

      if (editingId === deletedId) {
        setEditingId(null)
        setForm(emptyForm)
      }

      setDeleteTarget(null)
      showMessage('تم حذف المورد')
      await loadSuppliers(supplierPage)
    } catch (error) {
      console.error('Failed to delete supplier:', error)
      showMessage('حدث خطأ أثناء حذف المورد')
    } finally {
      setDeletingSupplier(false)
    }
  }

  async function openStatement(supplier: Supplier) {
    setStatementLoading(true)
    setSupplierStatementPage(1)

    try {
      const data = await window.api.getSupplierStatement(
        supplier.id,
        currentUser?.id,
      )
      setStatementData(data)
    } catch (error) {
      console.error('Failed to load supplier statement:', error)
      showMessage('حدث خطأ أثناء تحميل كشف الحساب')
    } finally {
      setStatementLoading(false)
    }
  }

  async function saveSupplierStatementPdf() {
    if (!statementData) return

    try {
      const supplier = statementData.supplier
      const summary = statementData.summary
      const entries = Array.isArray(statementData.entries)
        ? statementData.entries
        : []

      const safeText = (value: unknown) =>
        String(value ?? '—')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;')

      const rowsHtml = entries.length
        ? entries
            .map(
              (entry: any) => `
              <tr>
                <td>${safeText(formatDate(entry.created_at))}</td>
                <td>${safeText(entry.title)}</td>
                <td>${entry.debit > 0 ? safeText(money(entry.debit)) : '—'}</td>
                <td>${entry.credit > 0 ? safeText(money(entry.credit)) : '—'}</td>
                <td>${safeText(entry.notes || '—')}</td>
              </tr>
            `,
            )
            .join('')
        : `
        <tr>
          <td colspan="5" style="text-align:center;padding:20px;">
            لا توجد حركات
          </td>
        </tr>
      `

      const html = `
      <!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />

          <style>
            * {
              box-sizing: border-box;
            }

            body {
              font-family: Arial, Tahoma, sans-serif;
              direction: rtl;
              margin: 0;
              padding: 28px;
              color: #111827;
              background: #ffffff;
              font-size: 13px;
            }

            .header {
              text-align: center;
              margin-bottom: 24px;
              border-bottom: 2px solid #111827;
              padding-bottom: 14px;
            }

            .header h1 {
              margin: 0 0 8px;
              font-size: 24px;
            }

            .header p {
              margin: 4px 0;
              color: #4b5563;
            }

            .supplier-info {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 8px 20px;
              margin-bottom: 20px;
              padding: 14px;
              border: 1px solid #d1d5db;
              border-radius: 8px;
            }

            .summary {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 10px;
              margin-bottom: 24px;
            }

            .summary-card {
              border: 1px solid #d1d5db;
              border-radius: 8px;
              padding: 12px;
              text-align: center;
            }

            .summary-card span {
              display: block;
              color: #6b7280;
              margin-bottom: 6px;
              font-size: 12px;
            }

            .summary-card strong {
              font-size: 16px;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }

            th,
            td {
              border: 1px solid #d1d5db;
              padding: 9px 7px;
              text-align: right;
              vertical-align: top;
              word-break: break-word;
            }

            th {
              background: #f3f4f6;
              font-weight: bold;
            }

            th:nth-child(1),
            td:nth-child(1) {
              width: 18%;
            }

            th:nth-child(2),
            td:nth-child(2) {
              width: 25%;
            }

            th:nth-child(3),
            td:nth-child(3),
            th:nth-child(4),
            td:nth-child(4) {
              width: 14%;
            }

            th:nth-child(5),
            td:nth-child(5) {
              width: 29%;
            }

            .footer {
              margin-top: 20px;
              padding-top: 10px;
              border-top: 1px solid #d1d5db;
              color: #6b7280;
              font-size: 11px;
              text-align: center;
            }

            @page {
              size: A4 landscape;
              margin: 12mm;
            }
          </style>
        </head>

        <body>
          <div class="header">
            <h1>كشف حساب المورد</h1>
            <p>${safeText(supplier?.name)}</p>
            <p>
              تاريخ استخراج الكشف:
              ${safeText(new Date().toLocaleString('ar-EG'))}
            </p>
          </div>

          <div class="supplier-info">
            <div>
              <strong>اسم المورد:</strong>
              ${safeText(supplier?.name)}
            </div>

            <div>
              <strong>الهاتف:</strong>
              ${safeText(supplier?.phone || '—')}
            </div>

            <div>
              <strong>البريد الإلكتروني:</strong>
              ${safeText(supplier?.email || '—')}
            </div>

            <div>
              <strong>العنوان:</strong>
              ${safeText(supplier?.address || '—')}
            </div>
          </div>

          <div class="summary">
            <div class="summary-card">
              <span>إجمالي المشتريات</span>
              <strong>${safeText(money(summary?.total_purchased || 0))}</strong>
            </div>

            <div class="summary-card">
              <span>إجمالي المدفوع</span>
              <strong>${safeText(money(summary?.total_paid || 0))}</strong>
            </div>

            <div class="summary-card">
              <span>الرصيد الحالي</span>
              <strong>${safeText(money(summary?.balance || 0))}</strong>
            </div>

            <div class="summary-card">
              <span>الفواتير المفتوحة</span>
              <strong>${safeText(summary?.open_purchases || 0)}</strong>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>البيان</th>
                <th>مدين</th>
                <th>دائن</th>
                <th>ملاحظات</th>
              </tr>
            </thead>

            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div class="footer">
            تم إنشاء هذا الكشف من نظام ERP Store
          </div>
        </body>
      </html>
    `

      const supplierName = String(supplier?.name || 'supplier')
        .replace(/[<>:"/\\|?*]+/g, '-')
        .trim()

      const result = await window.api.savePdfFromHtml({
        html,
        defaultFileName: `كشف-حساب-${supplierName}-${new Date()
          .toISOString()
          .slice(0, 10)}.pdf`,
        landscape: true,
      })

      if (result?.canceled) return

      showMessage('تم حفظ كشف حساب المورد PDF بنجاح')
    } catch (error) {
      console.error('Failed to save supplier statement PDF:', error)
      showMessage('حدث خطأ أثناء حفظ كشف حساب المورد PDF')
    }
  }

  function openSupplierPayment(supplier: Supplier) {
    setPaymentSupplier(supplier)
    setPaymentAmount(roundMoney(supplier.balance).toFixed(2))
    setPaymentMethod('store_cash')
    setPaymentNotes('')
  }

  async function saveSupplierPayment() {
    if (!paymentSupplier || savingPayment) return

    const amount = Number(paymentAmount || 0)

    if (!Number.isFinite(amount) || amount <= 0) {
      showMessage('اكتب مبلغ صحيح')
      return
    }

    setSavingPayment(true)

    try {
      const result = await window.api.recordSupplierPayment({
        supplier_id: paymentSupplier.id,
        amount,
        payment_method: paymentMethod,
        notes: paymentNotes.trim() || null,
        actor_id: currentUser?.id,
      })

      showMessage(`تم تسجيل دفعة ${money(result.paid_amount)}`)

      setPaymentSupplier(null)
      setPaymentAmount('')
      setPaymentNotes('')

      await loadSuppliers(supplierPage)

      if (statementData?.supplier?.id === paymentSupplier.id) {
        const data = await window.api.getSupplierStatement(
          paymentSupplier.id,
          currentUser?.id,
        )
        setStatementData(data)
      }
    } catch (error) {
      console.error('Failed to save supplier payment:', error)
      showMessage(getErrorMessage(error, 'حدث خطأ أثناء تسجيل الدفعة'))
    } finally {
      setSavingPayment(false)
    }
  }

  function canManageStatementPayment(entry: any) {
    if (!entry?.batch_id) {
      return false
    }

    if (
      entry.cancelled_at ||
      entry.replacement_batch_id ||
      !entry.is_latest_mutable_batch
    ) {
      return false
    }

    return (
      isAdmin ||
      Number(entry.batch_created_by || 0) === Number(currentUser?.id || 0)
    )
  }

  function paymentMethodLabel(value?: string | null) {
    if (!value) return '—'

    return (
      CASH_ACCOUNT_OPTIONS.find((option) => option.value === value)?.label ||
      value
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

    setPaymentActionMethod(String(entry.payment_method || 'store_cash'))

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
    setPaymentActionMethod('store_cash')
    setPaymentActionNotes('')
    setPaymentActionReason('')
    setPaymentActionPassword('')

    setPaymentActionRequirePassword(Boolean(entry.requires_admin_password))
  }

  function closePaymentAction() {
    if (savingPaymentAction) return

    setPaymentAction(null)
    setPaymentActionAmount('')
    setPaymentActionMethod('store_cash')
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
      showMessage('رقم دفعة المورد غير صحيح')
      return
    }

    if (paymentAction.mode === 'edit') {
      const amount = Number(paymentActionAmount || 0)

      if (!Number.isFinite(amount) || amount <= 0) {
        showMessage('اكتب مبلغ دفعة صحيح')
        return
      }
    } else if (!paymentActionReason.trim()) {
      showMessage('سبب الإلغاء مطلوب')
      return
    }

    if (paymentActionRequirePassword && !paymentActionPassword.trim()) {
      showMessage('كلمة مرور المدير مطلوبة')
      return
    }

    setSavingPaymentAction(true)

    try {
      const result =
        paymentAction.mode === 'edit'
          ? await window.api.updateSupplierPayment({
              batch_id: batchId,

              amount: Number(paymentActionAmount),

              payment_method: paymentActionMethod,

              notes: paymentActionNotes.trim() || null,

              actor_id: currentUser?.id,

              admin_password: paymentActionRequirePassword
                ? paymentActionPassword
                : undefined,
            })
          : await window.api.cancelSupplierPayment({
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
            ? 'تعذر تعديل دفعة المورد'
            : 'تعذر إلغاء دفعة المورد')

        if (errorMessage.includes('كلمة مرور')) {
          setPaymentActionRequirePassword(true)
        }

        showMessage(errorMessage)

        return
      }

      const supplierId = Number(statementData?.supplier?.id || 0)

      setPaymentAction(null)
      setPaymentActionAmount('')
      setPaymentActionNotes('')
      setPaymentActionReason('')
      setPaymentActionPassword('')

      setPaymentActionRequirePassword(false)

      await loadSuppliers(supplierPage)

      if (supplierId) {
        const data = await window.api.getSupplierStatement(
          supplierId,
          currentUser?.id,
        )

        setStatementData(data)
      }

      showMessage(
        paymentAction.mode === 'edit'
          ? 'تم تعديل دفعة المورد'
          : 'تم إلغاء دفعة المورد',
      )
    } catch (error) {
      console.error('Failed to process supplier payment:', error)

      showMessage(
        getErrorMessage(
          error,
          paymentAction.mode === 'edit'
            ? 'حدث خطأ أثناء تعديل الدفعة'
            : 'حدث خطأ أثناء إلغاء الدفعة',
        ),
      )
    } finally {
      setSavingPaymentAction(false)
    }
  }

  function InfoCard({ title, value }: { title: string; value: string }) {
    return (
      <div
        className="supplier-info-card"
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
            background: 'rgba(37,99,235,0.96)',
            color: '#fff',
            fontWeight: 800,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        >
          {message}
        </div>
      )}

      <div className="glass-card" style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '14px',
            alignItems: 'center',
            flexWrap: 'wrap',
            direction: 'rtl',
          }}
        >
          <div>
            <h2 style={{ margin: '0 0 6px' }}>إدارة الموردين</h2>
            <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
              إضافة وتعديل بيانات الموردين وتجهيزهم لفواتير الشراء
            </p>
          </div>
        </div>

        <input
          placeholder="بحث باسم المورد / الهاتف / الإيميل / العنوان"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div className="glass-card" style={cardStyle}>
        <h3 style={{ margin: 0, textAlign: 'right' }}>
          {editingId ? `تعديل: ${editingSupplier?.name || ''}` : 'إضافة مورد'}
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: '12px',
          }}
        >
          <Input
            placeholder="اسم المورد"
            value={form.name}
            onChange={(value) => setForm((p) => ({ ...p, name: value }))}
          />

          <Input
            placeholder="رقم الهاتف"
            value={form.phone}
            onChange={(value) => setForm((p) => ({ ...p, phone: value }))}
          />

          <Input
            placeholder="الإيميل"
            value={form.email}
            onChange={(value) => setForm((p) => ({ ...p, email: value }))}
          />

          <Input
            placeholder="العنوان"
            value={form.address}
            onChange={(value) => setForm((p) => ({ ...p, address: value }))}
          />

          <input
            placeholder="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            style={{
              ...inputStyle,
              gridColumn: '1 / -1',
            }}
          />
        </div>

        <div
          style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start' }}
        >
          <button
            type="button"
            onClick={saveSupplier}
            disabled={saving}
            style={{
              ...primaryButtonStyle,
              opacity: saving ? 0.6 : 1,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving
              ? 'جاري الحفظ...'
              : editingId
                ? 'حفظ التعديل'
                : 'حفظ المورد'}
          </button>

          {editingId && (
            <button
              type="button"
              onClick={startCreate}
              style={secondaryButtonStyle}
            >
              إلغاء التعديل
            </button>
          )}
        </div>
      </div>

      <div
        className="glass-card table-scroll"
        style={{
          padding: '18px',
          borderRadius: '18px',
          overflow: 'auto',
          height: '100%',
          minHeight: 0,
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        <PaginationBar
          page={supplierPage}
          totalItems={suppliersTotal}
          loading={loading}
          onPageChange={(page) => {
            void loadSuppliers(page)
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
              <th style={thStyle}>المورد</th>
              <th style={thStyle}>الهاتف</th>
              <th style={thStyle}>الإيميل</th>
              <th style={thStyle}>العنوان</th>
              <th style={thStyle}>إجمالي المشتريات</th>
              <th style={thStyle}>الرصيد</th>
              <th style={thStyle}>إجراءات</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} style={{ ...tdStyle, textAlign: 'center' }}>
                  جاري التحميل...
                </td>
              </tr>
            )}

            {!loading &&
              suppliers.map((supplier) => (
                <tr
                  key={supplier.id}
                  style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <td style={tdStyle}>
                    <strong>{supplier.name}</strong>
                    {supplier.notes && (
                      <div
                        style={{
                          color: '#94a3b8',
                          fontSize: '12px',
                          marginTop: '4px',
                        }}
                      >
                        {supplier.notes}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>{supplier.phone || '—'}</td>
                  <td style={tdStyle}>{supplier.email || '—'}</td>
                  <td style={tdStyle}>{supplier.address || '—'}</td>
                  <td style={tdStyle}>{money(supplier.total_purchased)}</td>
                  <td
                    style={{
                      ...tdStyle,
                      color:
                        roundMoney(supplier.balance) > 0
                          ? '#fca5a5'
                          : '#6ee7b7',
                      fontWeight: 900,
                    }}
                  >
                    {money(supplier.balance)}
                  </td>
                  <td style={tdStyle}>
                    <div
                      style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}
                    >
                      <button
                        type="button"
                        onClick={() => startEdit(supplier)}
                        style={smallButtonStyle}
                      >
                        تعديل
                      </button>

                      <button
                        type="button"
                        onClick={() => requestDeleteSupplier(supplier)}
                        style={{
                          ...smallButtonStyle,
                          borderColor: '#ef4444',
                          color: '#fca5a5',
                          background: 'rgba(239,68,68,0.10)',
                        }}
                      >
                        حذف
                      </button>

                      <button
                        type="button"
                        onClick={() => openStatement(supplier)}
                        style={smallButtonStyle}
                      >
                        كشف حساب
                      </button>

                      {roundMoney(supplier.balance) > 0 && (
                        <button
                          type="button"
                          onClick={() => openSupplierPayment(supplier)}
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
                    </div>
                  </td>
                </tr>
              ))}

            {!loading && suppliers.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    ...tdStyle,
                    textAlign: 'center',
                    color: '#94a3b8',
                    padding: '28px',
                  }}
                >
                  لا يوجد موردين
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {statementData && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div
            className="theme-modal-card supplier-statement-modal"
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
                  كشف حساب: {statementData.supplier?.name}
                </h3>

                <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
                  متابعة فواتير الشراء والدفعات والرصيد الحالي
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <button
                  type="button"
                  onClick={saveSupplierStatementPdf}
                  disabled={statementLoading}
                  style={{
                    ...secondaryButtonStyle,
                    opacity: statementLoading ? 0.6 : 1,
                    cursor: statementLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  حفظ PDF
                </button>

                <button
                  type="button"
                  onClick={() => setStatementData(null)}
                  style={closeButtonStyle}
                >
                  ×
                </button>
              </div>
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
                title="إجمالي المشتريات"
                value={money(statementData.summary.total_purchased)}
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
                value={String(statementData.summary.open_purchases)}
              />
            </div>

            {roundMoney(statementData.summary.balance) > 0 && (
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
                    openSupplierPayment({
                      id: statementData.supplier.id,
                      name: statementData.supplier.name,
                      phone: statementData.supplier.phone,
                      email: statementData.supplier.email,
                      address: statementData.supplier.address,
                      notes: statementData.supplier.notes,
                      total_purchased: statementData.supplier.total_purchased,
                      balance: statementData.supplier.balance,
                      created_at: statementData.supplier.created_at,
                    })
                  }
                  style={primaryButtonStyle}
                >
                  تسجيل دفعة
                </button>
              </div>
            )}

            <PaginationBar
              page={supplierStatementPage}
              totalItems={statementData.entries?.length || 0}
              pageSize={SUPPLIER_STATEMENT_PAGE_SIZE}
              loading={statementLoading}
              onPageChange={setSupplierStatementPage}
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
                        (supplierStatementPage - 1) *
                          SUPPLIER_STATEMENT_PAGE_SIZE,

                        supplierStatementPage * SUPPLIER_STATEMENT_PAGE_SIZE,
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
                            {paymentMethodLabel(entry.payment_method)}
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
                    ? 'تعديل دفعة المورد'
                    : 'إلغاء دفعة المورد'}
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
                  <label style={labelStyle}>الحساب المالي</label>

                  <select
                    value={paymentActionMethod}
                    onChange={(e) => setPaymentActionMethod(e.target.value)}
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
                إلغاء الدفعة سيعيد المبلغ إلى رصيد المورد ويلغي أثر الدفع من
                الحساب المالي.
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
                style={secondaryButtonStyle}
              >
                رجوع
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentSupplier && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div
            className="theme-modal-card supplier-payment-modal"
            style={modalStyle}
          >
            <h3 style={{ margin: '0 0 8px' }}>تسجيل دفعة للمورد</h3>

            <p
              style={{ margin: '0 0 18px', color: '#94a3b8', fontWeight: 700 }}
            >
              {paymentSupplier.name}
            </p>

            <div style={{ display: 'grid', gap: '14px' }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>الرصيد الحالي</label>
                <input
                  value={money(paymentSupplier.balance)}
                  readOnly
                  style={{ ...inputStyle, opacity: 0.7 }}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>مبلغ الدفعة</label>
                <input
                  type="number"
                  min={0}
                  max={paymentSupplier.balance}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>الحساب المالي</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
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
                <label style={labelStyle}>ملاحظات</label>
                <input
                  placeholder="مثال: دفعة من حساب المورد"
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
                onClick={saveSupplierPayment}
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
                onClick={() => setPaymentSupplier(null)}
                style={secondaryButtonStyle}
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
            className="theme-modal-card supplier-delete-modal"
            style={modalStyle}
          >
            <h3 style={{ margin: '0 0 10px' }}>تأكيد حذف المورد</h3>

            <p
              style={{ margin: '0 0 18px', color: '#94a3b8', lineHeight: 1.8 }}
            >
              هل أنت متأكد من حذف المورد{' '}
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
              سيتم إخفاء المورد من القائمة، ولن يظهر في البحث العادي.
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
                className="supplier-delete-confirm-button"
                onClick={confirmDeleteSupplier}
                disabled={deletingSupplier}
                style={{
                  ...primaryButtonStyle,
                  background: 'rgba(239,68,68,0.16)',
                  border: '1px solid rgba(239,68,68,0.35)',
                  color: '#fca5a5',
                  opacity: deletingSupplier ? 0.6 : 1,
                  cursor: deletingSupplier ? 'not-allowed' : 'pointer',
                }}
              >
                {deletingSupplier ? 'جاري الحذف...' : 'تأكيد الحذف'}
              </button>

              <button
                type="button"
                onClick={cancelDeleteSupplier}
                disabled={deletingSupplier}
                style={secondaryButtonStyle}
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

function Input({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <input
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
    />
  )
}

function money(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`
}

const cardStyle: React.CSSProperties = {
  padding: '18px',
  borderRadius: '18px',
  display: 'grid',
  gap: '14px',
  overflow: 'visible',
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
