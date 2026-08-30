import { useEffect, useState } from 'react'
import PaginationBar, { SYSTEM_PAGE_SIZE } from '../../components/PaginationBar'
import { useAuthStore } from '../../store/auth.store'
import {
  CASH_ACCOUNT_OPTIONS,
  getPaymentMethodLabel,
} from '../../utils/payment-method'
import FinancialCancelModal from '../../components/FinancialCancelModal'

type Expense = {
  id: number
  title: string
  category?: string
  amount: number
  payment_method: string
  notes?: string
  created_by_name?: string
  created_at: string
  cancelled_at?: string | null
  cancelled_by?: number | null
  cancel_reason?: string | null
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [expensesTotal, setExpensesTotal] = useState(0)
  const [expensesPage, setExpensesPage] = useState(1)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  const currentUser = useAuthStore((s) => s.user)
  const isAdmin = currentUser?.role === 'admin'

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('store_cash')
  const [notes, setNotes] = useState('')
  const [cancelExpenseTarget, setCancelExpenseTarget] =
    useState<Expense | null>(null)

  const [cancelExpenseReason, setCancelExpenseReason] = useState('')

  const [cancelExpensePassword, setCancelExpensePassword] = useState('')

  const [cancellingExpense, setCancellingExpense] = useState(false)
  const [editExpenseTarget, setEditExpenseTarget] = useState<Expense | null>(
    null,
  )

  const [editExpenseTitle, setEditExpenseTitle] = useState('')

  const [editExpenseCategory, setEditExpenseCategory] = useState('')

  const [editExpenseAmount, setEditExpenseAmount] = useState('')

  const [editExpensePaymentMethod, setEditExpensePaymentMethod] =
    useState('store_cash')

  const [editExpenseNotes, setEditExpenseNotes] = useState('')

  const [editExpensePassword, setEditExpensePassword] = useState('')

  const [updatingExpense, setUpdatingExpense] = useState(false)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 1800)
  }

  async function loadExpenses(page = expensesPage) {
    setLoading(true)

    try {
      const safePage = Math.max(1, Number(page || 1))

      const result = await window.api.getExpensesPage({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: SYSTEM_PAGE_SIZE,
        offset: (safePage - 1) * SYSTEM_PAGE_SIZE,
      })

      setExpenses(Array.isArray(result.rows) ? result.rows : [])

      setExpensesTotal(Number(result.total || 0))

      setTotalExpenses(Number(result.total_amount || 0))

      setExpensesPage(safePage)
    } catch (error) {
      console.error(error)

      showMessage('error', 'حدث خطأ أثناء تحميل المصروفات')

      setExpenses([])
      setExpensesTotal(0)
      setTotalExpenses(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setExpensesPage(1)
    void loadExpenses(1)
  }, [dateFrom, dateTo])

  async function handleSubmit() {
    if (!title.trim()) {
      showMessage('error', 'اسم المصروف مطلوب')
      return
    }

    const parsedAmount = Number(amount)
    if (!parsedAmount || parsedAmount <= 0) {
      showMessage('error', 'اكتب مبلغ صحيح')
      return
    }

    setSaving(true)
    try {
      await window.api.createExpense({
        title: title.trim(),
        category: category.trim() || null,
        amount: parsedAmount,
        payment_method: paymentMethod,
        notes: notes.trim() || null,
        created_by: currentUser?.id ?? null,
      })

      setTitle('')
      setCategory('')
      setAmount('')
      setPaymentMethod('store_cash')
      setNotes('')

      showMessage('success', 'تم حفظ المصروف')
      await loadExpenses(expensesPage)
    } catch (error: any) {
      showMessage('error', error.message || 'حدث خطأ')
    } finally {
      setSaving(false)
    }
  }

  async function confirmCancelExpense() {
    if (!cancelExpenseTarget || cancellingExpense) return

    setCancellingExpense(true)

    try {
      const result = await window.api.cancelExpense({
        id: cancelExpenseTarget.id,
        reason:
          cancelExpenseReason.trim() ||
          `إلغاء مصروف: ${cancelExpenseTarget.title}`,
        actor_id: currentUser?.id ?? null,
        admin_password: cancelExpensePassword,
      })

      if (!result?.success) {
        showMessage('error', result?.message || 'تعذر إلغاء المصروف')
        return
      }

      setCancelExpenseTarget(null)
      setCancelExpenseReason('')
      setCancelExpensePassword('')

      showMessage('success', 'تم إلغاء المصروف')

      await loadExpenses(expensesPage)
    } catch (error: any) {
      showMessage('error', error?.message || 'حدث خطأ أثناء إلغاء المصروف')
    } finally {
      setCancellingExpense(false)
    }
  }

  function openEditExpense(expense: Expense) {
    setEditExpenseTarget(expense)

    setEditExpenseTitle(expense.title || '')

    setEditExpenseCategory(expense.category || '')

    setEditExpenseAmount(String(Number(expense.amount || 0)))

    setEditExpensePaymentMethod(expense.payment_method || 'store_cash')

    setEditExpenseNotes(expense.notes || '')

    setEditExpensePassword('')
  }

  function closeEditExpense() {
    if (updatingExpense) return

    setEditExpenseTarget(null)
    setEditExpenseTitle('')
    setEditExpenseCategory('')
    setEditExpenseAmount('')
    setEditExpensePaymentMethod('store_cash')
    setEditExpenseNotes('')
    setEditExpensePassword('')
  }

  async function confirmUpdateExpense() {
    if (!editExpenseTarget || updatingExpense) {
      return
    }

    const title = editExpenseTitle.trim()

    if (!title) {
      showMessage('error', 'اسم المصروف مطلوب')
      return
    }

    const amount = Number(editExpenseAmount || 0)

    if (!Number.isFinite(amount) || amount <= 0) {
      showMessage('error', 'اكتب مبلغ صحيح')
      return
    }

    if (!editExpensePassword.trim()) {
      showMessage('error', 'اكتب كلمة مرور المدير')
      return
    }

    setUpdatingExpense(true)

    try {
      const result = await window.api.updateExpense({
        id: editExpenseTarget.id,

        title,

        category: editExpenseCategory.trim() || null,

        amount,

        payment_method: editExpensePaymentMethod,

        notes: editExpenseNotes.trim() || null,

        actor_id: currentUser?.id ?? null,

        admin_password: editExpensePassword,
      })

      if (!result.success) {
        showMessage('error', result.message || 'تعذر تعديل المصروف')

        return
      }

      closeEditExpense()

      showMessage('success', 'تم تعديل المصروف')

      await loadExpenses(expensesPage)
    } catch (error: any) {
      showMessage('error', error?.message || 'حدث خطأ أثناء تعديل المصروف')
    } finally {
      setUpdatingExpense(false)
    }
  }

  const [totalExpenses, setTotalExpenses] = useState(0)

  function money(value: unknown) {
    return `${Number(value || 0).toFixed(2)} ج.م`
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

  async function printExpensesReport() {
    let printExpenses: Expense[] = []

    try {
      const data = await window.api.getExpenses({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })

      printExpenses = Array.isArray(data) ? data : []
    } catch (error) {
      console.error('Failed to load expenses for print:', error)

      showMessage('error', 'تعذر تجهيز المصروفات للطباعة')

      return
    }

    const printTotalExpenses = printExpenses.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    )

    const printWindow = window.open('', '_blank', 'width=1100,height=800')

    if (!printWindow) {
      showMessage('error', 'تعذر فتح نافذة الطباعة')
      return
    }

    const rowsHtml = printExpenses
      .map(
        (expense) => `
          <tr>
            <td>${escapeHtml(expense.title || '—')}</td>
            <td>${escapeHtml(expense.category || '—')}</td>
            <td class="money">${money(expense.amount)}</td>
            <td>${escapeHtml(getPaymentMethodLabel(expense.payment_method))}</td>
            <td>${escapeHtml(expense.notes || '—')}</td>
            <td>${escapeHtml(expense.created_by_name || '—')}</td>
            <td>${escapeHtml(formatDate(expense.created_at))}</td>
          </tr>
        `,
      )
      .join('')

    const html = `
      <!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />
          <title>كشف المصروفات</title>
          <style>
            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              padding: 28px;
              font-family: "Segoe UI", Tahoma, Arial, sans-serif;
              color: #111827;
              background: #ffffff;
              direction: rtl;
            }

            .header {
              display: flex;
              justify-content: space-between;
              gap: 16px;
              align-items: flex-start;
              border-bottom: 2px solid #e5e7eb;
              padding-bottom: 18px;
              margin-bottom: 18px;
            }

            h1 {
              margin: 0 0 8px;
              font-size: 28px;
            }

            .muted {
              color: #6b7280;
              font-size: 13px;
              line-height: 1.8;
            }

            .summary {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12px;
              margin: 18px 0;
            }

            .card {
              border: 1px solid #e5e7eb;
              border-radius: 14px;
              padding: 14px;
              background: #f9fafb;
            }

            .card-title {
              color: #6b7280;
              font-size: 13px;
              margin-bottom: 8px;
              font-weight: 700;
            }

            .card-value {
              font-size: 22px;
              font-weight: 900;
            }

            .money {
              color: #b91c1c;
              font-weight: 900;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 12px;
            }

            th,
            td {
              border: 1px solid #e5e7eb;
              padding: 9px;
              text-align: right;
              font-size: 12px;
              vertical-align: top;
            }

            th {
              background: #f3f4f6;
              font-weight: 900;
            }

            td:nth-child(5) {
              max-width: 360px;
              white-space: normal;
              line-height: 1.6;
            }

            .empty {
              text-align: center;
              color: #6b7280;
              padding: 28px;
              border: 1px solid #e5e7eb;
              border-radius: 12px;
              background: #f9fafb;
            }

            .footer {
              margin-top: 18px;
              padding-top: 12px;
              border-top: 1px solid #e5e7eb;
              color: #6b7280;
              font-size: 12px;
              display: flex;
              justify-content: space-between;
              gap: 12px;
            }

            @media print {
              body {
                padding: 16px;
              }
            }
          </style>
        </head>

        <body>
          <div class="header">
            <div>
              <h1>كشف المصروفات</h1>
              <div class="muted">
                ERP Store<br />
                تاريخ الطباعة: ${escapeHtml(new Date().toLocaleString('ar-EG'))}
              </div>
            </div>

            <div class="muted">
              المستخدم: ${escapeHtml(currentUser?.name || '—')}<br />
              عدد المصروفات: ${printExpenses.length}
            </div>
          </div>

          <div class="summary">
            <div class="card">
              <div class="card-title">إجمالي المصروفات</div>
              <div class="card-value money">${money(printTotalExpenses)}</div>
            </div>

            <div class="card">
              <div class="card-title">عدد العمليات</div>
              <div class="card-value">${printExpenses.length}</div>
            </div>
          </div>

          ${
            printExpenses.length
              ? `
                <table>
                  <thead>
                    <tr>
                      <th>المصروف</th>
                      <th>التصنيف</th>
                      <th>المبلغ</th>
                      <th>الحساب المالي</th>
                      <th>ملاحظات</th>
                      <th>المستخدم</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHtml}
                  </tbody>
                </table>
              `
              : '<div class="empty">لا توجد مصروفات مسجلة</div>'
          }

          <div class="footer">
            <div>تم إنشاء التقرير من نظام ERP Store</div>
            <div>صفحة المصروفات</div>
          </div>

          <script>
            window.onload = function () {
              window.focus();
              window.print();
            };
          </script>
        </body>
      </html>
    `

    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: '12px',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        gridTemplateRows: 'auto auto minmax(0, 1fr)',
      }}
    >
      <style>
        {`
          .expenses-body-scroll {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }

          .expenses-body-scroll::-webkit-scrollbar {
            width: 0;
            height: 0;
            display: none;
          }
        `}
      </style>

      {/* Toast Message */}
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
              message.type === 'error'
                ? 'rgba(239,68,68,0.95)'
                : 'rgba(16,185,129,0.95)',
            color: '#fff',
            fontWeight: 800,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        >
          {message.text}
        </div>
      )}

      {/* Header + Total */}
      <div
        className="glass-card"
        style={{
          padding: '14px',
          borderRadius: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '14px',
          direction: 'rtl',
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 6px' }}>المصروفات</h2>
          <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
            متابعة وإدارة المصروفات اليومية
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          {isAdmin && (
            <button
              type="button"
              onClick={() => void printExpensesReport()}
              style={{
                ...primaryButtonStyle,
                background: 'rgba(16,185,129,0.14)',
                border: '1px solid rgba(16,185,129,0.32)',
                color: '#6ee7b7',
              }}
            >
              طباعة الكشف
            </button>
          )}

          <div style={{ textAlign: 'left' }}>
            <div
              style={{
                color: '#94a3b8',
                fontSize: '13px',
                marginBottom: '4px',
              }}
            >
              {dateFrom || dateTo
                ? 'إجمالي الفترة المحددة'
                : 'إجمالي المصروفات'}
            </div>
            <strong style={{ color: '#f87171', fontSize: '24px' }}>
              {money(totalExpenses)}
            </strong>
          </div>
        </div>
      </div>

      {/* Add Expense Form */}
      <div
        className="glass-card"
        style={{
          padding: '14px',
          borderRadius: '16px',
          display: 'grid',
          gap: '10px',
          minHeight: 0,
        }}
      >
        <div>
          <h3 style={{ margin: '0 0 6px', textAlign: 'right' }}>إضافة مصروف</h3>
          <p
            style={{
              margin: 0,
              color: '#94a3b8',
              fontWeight: 700,
              textAlign: 'right',
            }}
          >
            تسجيل المصروفات وربطها بالخزنة
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px',
          }}
        >
          <div>
            <label style={labelStyle}>اسم المصروف</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: فاتورة كهرباء"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>التصنيف</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="مثال: فواتير / إيجار"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>المبلغ</label>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={inputStyle}
            />
          </div>

          <div>
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
        </div>

        <div>
          <label style={labelStyle}>ملاحظات</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات إضافية..."
            style={{
              ...inputStyle,
              height: '72px',
              paddingTop: '12px',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving}
            style={{
              ...primaryButtonStyle,
              opacity: saving ? 0.6 : 1,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'جاري الحفظ...' : 'حفظ المصروف'}
          </button>
        </div>
      </div>

      {/* Expenses Table */}
      <div
        className="glass-card"
        style={{
          padding: '14px',
          borderRadius: '16px',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          display: 'grid',
          gridTemplateRows: 'auto auto minmax(0, 1fr)',
          gap: '10px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: '12px',
            flexWrap: 'wrap',
            direction: 'rtl',
          }}
        >
          <h3 style={{ margin: 0, textAlign: 'right' }}>سجل المصروفات</h3>

          <div
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <label
              style={{
                display: 'grid',
                gap: '5px',
                color: '#94a3b8',
                fontSize: '12px',
                fontWeight: 800,
              }}
            >
              <span>من تاريخ</span>

              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{
                  ...inputStyle,
                  width: '165px',
                  direction: 'ltr',
                  colorScheme: 'dark',
                }}
              />
            </label>

            <label
              style={{
                display: 'grid',
                gap: '5px',
                color: '#94a3b8',
                fontSize: '12px',
                fontWeight: 800,
              }}
            >
              <span>إلى تاريخ</span>

              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                style={{
                  ...inputStyle,
                  width: '165px',
                  direction: 'ltr',
                  colorScheme: 'dark',
                }}
              />
            </label>

            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => {
                  setDateFrom('')
                  setDateTo('')
                }}
                style={{
                  ...primaryButtonStyle,
                  background: 'rgba(148,163,184,0.12)',
                  border: '1px solid rgba(148,163,184,0.25)',
                  color: '#cbd5e1',
                }}
              >
                مسح الفلتر
              </button>
            )}
          </div>
        </div>

        <PaginationBar
          page={expensesPage}
          totalItems={expensesTotal}
          loading={loading}
          onPageChange={(page) => {
            void loadExpenses(page)
          }}
        />

        <div
          className="expenses-body-scroll"
          style={{
            overflow: 'auto',
            minHeight: 0,
            height: '100%',
            maxWidth: '100%',
          }}
        >
          <table
            style={{
              width: '100%',
              minWidth: '1050px',
              borderCollapse: 'collapse',
              direction: 'rtl',
            }}
          >
            <thead>
              <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                <th style={thStyle}>المصروف</th>
                {/* <th style={thStyle}>التصنيف</th> */}
                <th style={thStyle}>المبلغ</th>
                <th style={thStyle}>الحساب المالي</th>
                <th style={thStyle}>المستخدم</th>
                <th style={thStyle}>التاريخ</th>
                <th style={thStyle}>الحالة</th>
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
                expenses.map((expense) => (
                  <tr
                    key={expense.id}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 700 }}>
                      {expense.title}
                    </td>
                    {/* <td style={tdStyle}>{expense.category || '—'}</td> */}
                    <td
                      style={{ ...tdStyle, color: '#f87171', fontWeight: 900 }}
                    >
                      {money(expense.amount)}
                    </td>
                    <td style={tdStyle}>
                      {getPaymentMethodLabel(expense.payment_method)}
                    </td>
                    <td style={tdStyle}>{expense.created_by_name || '—'}</td>
                    <td style={{ ...tdStyle, color: '#94a3b8' }}>
                      {formatDate(expense.created_at)}
                    </td>
                    <td style={tdStyle}>
                      {expense.cancelled_at ? (
                        <div style={{ display: 'grid', gap: '4px' }}>
                          <strong
                            style={{
                              color: '#f87171',
                              fontSize: '12px',
                            }}
                          >
                            ملغي
                          </strong>

                          {expense.cancel_reason && (
                            <span
                              style={{
                                color: '#94a3b8',
                                fontSize: '11px',
                              }}
                            >
                              {expense.cancel_reason}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span
                          style={{
                            color: '#34d399',
                            fontWeight: 900,
                            fontSize: '12px',
                          }}
                        >
                          فعال
                        </span>
                      )}
                    </td>

                    <td style={tdStyle}>
                      {isAdmin && !expense.cancelled_at ? (
                        <div
                          style={{
                            display: 'flex',
                            gap: '7px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => openEditExpense(expense)}
                            style={{
                              height: '34px',
                              padding: '0 12px',
                              borderRadius: '9px',
                              border: '1px solid rgba(245,158,11,0.35)',
                              background: 'rgba(245,158,11,0.10)',
                              color: '#fbbf24',
                              cursor: 'pointer',
                              fontWeight: 800,
                            }}
                          >
                            تعديل
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setCancelExpenseTarget(expense)

                              setCancelExpenseReason(
                                `إلغاء مصروف: ${expense.title}`,
                              )

                              setCancelExpensePassword('')
                            }}
                            style={{
                              height: '34px',
                              padding: '0 12px',
                              borderRadius: '9px',
                              border: '1px solid rgba(239,68,68,0.35)',
                              background: 'rgba(239,68,68,0.10)',
                              color: '#fca5a5',
                              cursor: 'pointer',
                              fontWeight: 800,
                            }}
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: '#64748b' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}

              {!loading && expenses.length === 0 && (
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
                    لا توجد مصروفات مسجلة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editExpenseTarget && (
        <div
          className="theme-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000000,
            display: 'grid',
            placeItems: 'center',
            padding: '20px',
            background: 'rgba(2,6,23,0.82)',
          }}
        >
          <div
            className="theme-modal-card"
            style={{
              width: '520px',
              maxWidth: '96vw',
              borderRadius: '18px',
              padding: '20px',
              display: 'grid',
              gap: '13px',
              background: 'var(--bg-soft)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              direction: 'rtl',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h3 style={{ margin: 0 }}>تعديل المصروف</h3>

              <button
                type="button"
                onClick={closeEditExpense}
                disabled={updatingExpense}
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.05)',
                  color: 'inherit',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>

            <div>
              <label style={labelStyle}>اسم المصروف</label>

              <input
                value={editExpenseTitle}
                onChange={(e) => setEditExpenseTitle(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>التصنيف</label>

              <input
                value={editExpenseCategory}
                onChange={(e) => setEditExpenseCategory(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>المبلغ</label>

              <input
                type="number"
                min={0}
                value={editExpenseAmount}
                onChange={(e) => setEditExpenseAmount(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>الحساب المالي</label>

              <select
                value={editExpensePaymentMethod}
                onChange={(e) => setEditExpensePaymentMethod(e.target.value)}
                style={inputStyle}
              >
                {CASH_ACCOUNT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>ملاحظات</label>

              <textarea
                value={editExpenseNotes}
                onChange={(e) => setEditExpenseNotes(e.target.value)}
                style={{
                  ...inputStyle,
                  minHeight: '75px',
                  height: '75px',
                  paddingTop: '12px',
                }}
              />
            </div>

            <div>
              <label style={labelStyle}>كلمة مرور المدير</label>

              <input
                type="password"
                value={editExpensePassword}
                onChange={(e) => setEditExpensePassword(e.target.value)}
                placeholder="كلمة مرور المدير"
                style={inputStyle}
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
              }}
            >
              <button
                type="button"
                onClick={() => void confirmUpdateExpense()}
                disabled={updatingExpense}
                style={{
                  ...primaryButtonStyle,
                  flex: 1,
                  opacity: updatingExpense ? 0.6 : 1,
                }}
              >
                {updatingExpense ? 'جاري الحفظ...' : 'حفظ التعديل'}
              </button>

              <button
                type="button"
                onClick={closeEditExpense}
                disabled={updatingExpense}
                style={{
                  height: '44px',
                  padding: '0 18px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.05)',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontWeight: 800,
                }}
              >
                رجوع
              </button>
            </div>
          </div>
        </div>
      )}

      <FinancialCancelModal
        open={Boolean(cancelExpenseTarget)}
        title="إلغاء المصروف"
        description={
          cancelExpenseTarget
            ? `${cancelExpenseTarget.title} — ${money(cancelExpenseTarget.amount)}`
            : ''
        }
        reason={cancelExpenseReason}
        password={cancelExpensePassword}
        loading={cancellingExpense}
        onReasonChange={setCancelExpenseReason}
        onPasswordChange={setCancelExpensePassword}
        onClose={() => {
          if (cancellingExpense) return

          setCancelExpenseTarget(null)
          setCancelExpenseReason('')
          setCancelExpensePassword('')
        }}
        onConfirm={() => void confirmCancelExpense()}
      />
    </div>
  )
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '8px',
  color: '#cbd5e1',
  fontSize: '14px',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
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
  background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
  color: '#fff',
  fontWeight: 800,
  padding: '0 18px',
  cursor: 'pointer',
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
