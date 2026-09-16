import { useEffect, useState } from 'react'

import {
  formatCashShiftDuration,
  getCashShiftStatusLabel,
  getCashShiftVarianceKindLabel,
  getCashShiftVarianceStageLabel,
  getCashShiftVarianceStatusLabel,
} from '../../utils/cash-shifts'

import { getPaymentMethodLabel } from '../../utils/payment-method'

type ShiftRow = {
  id: number

  status: 'open' | 'closed'

  opened_by_name?: string | null
  opened_at: string

  opening_counted_amount: number

  opening_difference: number

  expected_closing_amount?: number | null

  closing_counted_amount?: number | null

  closing_difference?: number | null

  left_for_next_shift?: number | null

  safe_transfer_amount?: number | null

  closed_by_name?: string | null

  closed_at?: string | null

  duration_minutes: number

  cash_in: number
  cash_out: number

  variance_count: number

  pending_variance_count: number
}

type ShiftDetails = {
  shift: ShiftRow & {
    close_reason?: string | null
  }

  preview: {
    cash_in: number
    cash_out: number

    expected_closing_amount: number

    breakdown: Array<{
      type: string
      direction: 'in' | 'out'
      total: number
    }>
  }

  movements: Array<{
    id: number

    type: string

    amount: number

    direction: 'in' | 'out'

    payment_method: string

    notes?: string | null

    created_by_name?: string | null

    created_at: string

    reference_type?: string | null
  }>

  variances: Array<{
    id: number

    stage: 'opening' | 'closing'

    kind: 'shortage' | 'surplus'

    amount: number

    status: 'pending' | 'resolved'

    resolution_notes?: string | null
  }>
}

export default function ShiftHistorySection() {
  const [rows, setRows] = useState<ShiftRow[]>([])

  const [total, setTotal] = useState(0)

  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all')

  const [dateFrom, setDateFrom] = useState('')

  const [dateTo, setDateTo] = useState('')

  const [loading, setLoading] = useState(false)

  const [details, setDetails] = useState<ShiftDetails | null>(null)

  const [detailsLoading, setDetailsLoading] = useState(false)

  const [error, setError] = useState('')

  async function loadHistory() {
    setLoading(true)
    setError('')

    try {
      const result = await window.api.getCashShifts({
        status,

        date_from: dateFrom || undefined,

        date_to: dateTo || undefined,

        limit: 200,
        offset: 0,
      })

      setRows(Array.isArray(result.rows) ? result.rows : [])

      setTotal(Number(result.total || 0))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل سجل الشفتات')
    } finally {
      setLoading(false)
    }
  }

  async function openDetails(shiftId: number) {
    setDetailsLoading(true)
    setError('')

    try {
      const result = await window.api.getCashShiftDetails(shiftId)

      setDetails(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل الشفت')
    } finally {
      setDetailsLoading(false)
    }
  }

  useEffect(() => {
    void loadHistory()
  }, [])

  return (
    <>
      <section
        className="glass-card"
        style={{
          padding: '16px',
          borderRadius: '20px',
          display: 'grid',
          gap: '14px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'end',
            gap: '12px',
            flexWrap: 'wrap',
            direction: 'rtl',
          }}
        >
          <div>
            <h3
              style={{
                margin: '0 0 6px',
              }}
            >
              سجل الشفتات
            </h3>

            <div
              style={{
                color: '#94a3b8',
                fontSize: '13px',
                fontWeight: 700,
              }}
            >
              كل الشفتات السابقة والحالية وتفاصيل التسليم والجرد
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              alignItems: 'end',
            }}
          >
            <Field label="الحالة">
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as 'all' | 'open' | 'closed')
                }
                style={inputStyle}
              >
                <option value="all">الكل</option>

                <option value="open">مفتوح</option>

                <option value="closed">مغلق</option>
              </select>
            </Field>

            <Field label="من">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={inputStyle}
              />
            </Field>

            <Field label="إلى">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={inputStyle}
              />
            </Field>

            <button
              type="button"
              onClick={() => void loadHistory()}
              disabled={loading}
              style={primaryButtonStyle}
            >
              {loading ? 'جاري التحميل...' : 'تطبيق'}
            </button>
          </div>
        </div>

        {error ? (
          <div
            style={{
              color: '#fca5a5',
              fontWeight: 800,
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            color: '#64748b',
            fontWeight: 700,
            fontSize: '12px',
          }}
        >
          عدد النتائج: {total}
        </div>

        <div
          style={{
            overflow: 'auto',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '14px',
          }}
        >
          <table
            style={{
              width: '100%',
              minWidth: '1250px',
              borderCollapse: 'collapse',
              direction: 'rtl',
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>الشفت</th>

                <th style={thStyle}>الكاشير</th>

                <th style={thStyle}>الحالة</th>

                <th style={thStyle}>الفتح</th>

                <th style={thStyle}>المدة</th>

                <th style={thStyle}>افتتاح</th>

                <th style={thStyle}>داخل</th>

                <th style={thStyle}>خارج</th>

                <th style={thStyle}>المتوقع</th>

                <th style={thStyle}>الفعلي</th>

                <th style={thStyle}>الفرق</th>

                <th style={thStyle}>للشفت التالي</th>

                <th style={thStyle}>توريد الآمنة</th>

                <th style={thStyle}>الفروق</th>

                <th style={thStyle}>إجراء</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={15}
                    style={{
                      ...tdStyle,
                      textAlign: 'center',
                      padding: '28px',
                    }}
                  >
                    جاري التحميل...
                  </td>
                </tr>
              ) : null}

              {!loading &&
                rows.map((row) => (
                  <tr
                    key={row.id}
                    style={{
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <td style={tdStyle}>#{row.id}</td>

                    <td style={tdStyle}>{row.opened_by_name || '—'}</td>

                    <td style={tdStyle}>
                      <strong
                        style={{
                          color: row.status === 'open' ? '#34d399' : '#94a3b8',
                        }}
                      >
                        {getCashShiftStatusLabel(row.status)}
                      </strong>
                    </td>

                    <td style={tdStyle}>{formatDate(row.opened_at)}</td>

                    <td style={tdStyle}>
                      {formatCashShiftDuration(row.duration_minutes)}
                    </td>

                    <td style={tdStyle}>{money(row.opening_counted_amount)}</td>

                    <td style={tdStyle}>{money(row.cash_in)}</td>

                    <td style={tdStyle}>{money(row.cash_out)}</td>

                    <td style={tdStyle}>
                      {row.expected_closing_amount == null
                        ? '—'
                        : money(row.expected_closing_amount)}
                    </td>

                    <td style={tdStyle}>
                      {row.closing_counted_amount == null
                        ? '—'
                        : money(row.closing_counted_amount)}
                    </td>

                    <td style={tdStyle}>
                      {row.closing_difference == null
                        ? '—'
                        : money(row.closing_difference)}
                    </td>

                    <td style={tdStyle}>
                      {row.left_for_next_shift == null
                        ? '—'
                        : money(row.left_for_next_shift)}
                    </td>

                    <td style={tdStyle}>
                      {row.safe_transfer_amount == null
                        ? '—'
                        : money(row.safe_transfer_amount)}
                    </td>

                    <td style={tdStyle}>
                      <span
                        style={{
                          color:
                            row.pending_variance_count > 0
                              ? '#fbbf24'
                              : '#94a3b8',
                          fontWeight: 900,
                        }}
                      >
                        {row.variance_count}

                        {row.pending_variance_count > 0
                          ? ` (${row.pending_variance_count} معلقة)`
                          : ''}
                      </span>
                    </td>

                    <td style={tdStyle}>
                      <button
                        type="button"
                        disabled={detailsLoading}
                        onClick={() => void openDetails(row.id)}
                        style={smallButtonStyle}
                      >
                        تفاصيل
                      </button>
                    </td>
                  </tr>
                ))}

              {!loading && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={15}
                    style={{
                      ...tdStyle,
                      textAlign: 'center',
                      padding: '30px',
                      color: '#94a3b8',
                    }}
                  >
                    لا توجد شفتات مطابقة للفلتر
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {details && (
        <ShiftDetailsModal details={details} onClose={() => setDetails(null)} />
      )}
    </>
  )
}

function ShiftDetailsModal({
  details,
  onClose,
}: {
  details: ShiftDetails
  onClose: () => void
}) {
  const shift = details.shift

  function printReport() {
    const printWindow = window.open('', '_blank', 'width=1000,height=800')

    if (!printWindow) {
      return
    }

    const movementsHtml = details.movements
      .map(
        (movement) => `
            <tr>
              <td>${escapeHtml(getMovementTypeLabel(movement.type))}</td>

              <td>${movement.direction === 'in' ? 'داخل' : 'خارج'}</td>

              <td>${money(movement.amount)}</td>

              <td>${escapeHtml(
                getPaymentMethodLabel(movement.payment_method),
              )}</td>

              <td>${escapeHtml(movement.notes || '—')}</td>

              <td>${escapeHtml(movement.created_by_name || '—')}</td>
            </tr>
          `,
      )
      .join('')

    printWindow.document.open()

    printWindow.document.write(`
      <!doctype html>

      <html lang="ar" dir="rtl">

      <head>
        <meta charset="UTF-8" />

        <title>
          تقرير الشفت #${shift.id}
        </title>

        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 24px;
            color: #111827;
          }

          h1 {
            margin-bottom: 20px;
          }

          .summary {
            display: grid;
            grid-template-columns:
              repeat(3, 1fr);
            gap: 10px;
            margin-bottom: 24px;
          }

          .card {
            border: 1px solid #d1d5db;
            padding: 10px;
            border-radius: 8px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
          }

          th, td {
            border: 1px solid #d1d5db;
            padding: 8px;
            text-align: right;
          }

          th {
            background: #f3f4f6;
          }
        </style>
      </head>

      <body>
        <h1>
          تقرير الشفت #${shift.id}
        </h1>

        <div class="summary">
          <div class="card">
            الكاشير:
            ${escapeHtml(shift.opened_by_name || '—')}
          </div>

          <div class="card">
            الافتتاح:
            ${money(shift.opening_counted_amount)}
          </div>

          <div class="card">
            المتوقع:
            ${money(details.preview.expected_closing_amount)}
          </div>

          <div class="card">
            الجرد الفعلي:
            ${
              shift.closing_counted_amount == null
                ? '—'
                : money(shift.closing_counted_amount)
            }
          </div>

          <div class="card">
            المتروك:
            ${
              shift.left_for_next_shift == null
                ? '—'
                : money(shift.left_for_next_shift)
            }
          </div>

          <div class="card">
            توريد الخزنة الآمنة:
            ${
              shift.safe_transfer_amount == null
                ? '—'
                : money(shift.safe_transfer_amount)
            }
          </div>
        </div>

        <h2>
          حركات الشفت
        </h2>

        <table>
          <thead>
            <tr>
              <th>النوع</th>
              <th>الاتجاه</th>
              <th>المبلغ</th>
              <th>الحساب</th>
              <th>ملاحظات</th>
              <th>المستخدم</th>
            </tr>
          </thead>

          <tbody>
            ${movementsHtml}
          </tbody>
        </table>

        <script>
          window.onload = function () {
            window.focus()
            window.print()
          }
        </script>
      </body>

      </html>
    `)

    printWindow.document.close()
  }

  return (
    <div className="theme-modal-overlay" style={modalOverlayStyle}>
      <div
        className="theme-modal-card"
        style={{
          ...modalCardStyle,
          width: '1050px',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <div>
            <h3
              style={{
                margin: '0 0 5px',
              }}
            >
              تفاصيل الشفت #{shift.id}
            </h3>

            <div
              style={{
                color: '#94a3b8',
              }}
            >
              {shift.opened_by_name || '—'}

              {' • '}

              {formatDate(shift.opened_at)}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '8px',
            }}
          >
            <button
              type="button"
              onClick={printReport}
              style={primaryButtonStyle}
            >
              طباعة التقرير
            </button>

            <button
              type="button"
              onClick={onClose}
              style={secondaryButtonStyle}
            >
              إغلاق
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '10px',
            marginBottom: '18px',
          }}
        >
          <InfoCard
            title="رصيد الافتتاح"
            value={money(shift.opening_counted_amount)}
          />

          <InfoCard title="داخل الدرج" value={money(details.preview.cash_in)} />

          <InfoCard
            title="خارج الدرج"
            value={money(details.preview.cash_out)}
          />

          <InfoCard
            title="الإغلاق المتوقع"
            value={money(details.preview.expected_closing_amount)}
          />

          <InfoCard
            title="الجرد الفعلي"
            value={
              shift.closing_counted_amount == null
                ? '—'
                : money(shift.closing_counted_amount)
            }
          />

          <InfoCard
            title="فرق الإغلاق"
            value={
              shift.closing_difference == null
                ? '—'
                : money(shift.closing_difference)
            }
          />

          <InfoCard
            title="المتبقي للشفت التالي"
            value={
              shift.left_for_next_shift == null
                ? '—'
                : money(shift.left_for_next_shift)
            }
          />

          <InfoCard
            title="توريد الخزنة الآمنة"
            value={
              shift.safe_transfer_amount == null
                ? '—'
                : money(shift.safe_transfer_amount)
            }
          />
        </div>

        <h4>حركات الشفت</h4>

        <div
          style={{
            overflow: 'auto',
          }}
        >
          <table
            style={{
              width: '100%',
              minWidth: '850px',
              borderCollapse: 'collapse',
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>النوع</th>

                <th style={thStyle}>الاتجاه</th>

                <th style={thStyle}>المبلغ</th>

                <th style={thStyle}>الحساب</th>

                <th style={thStyle}>المستخدم</th>

                <th style={thStyle}>التاريخ</th>

                <th style={thStyle}>ملاحظات</th>
              </tr>
            </thead>

            <tbody>
              {details.movements.map((movement) => (
                <tr key={movement.id}>
                  <td style={tdStyle}>{getMovementTypeLabel(movement.type)}</td>

                  <td style={tdStyle}>
                    {movement.direction === 'in' ? 'داخل' : 'خارج'}
                  </td>

                  <td style={tdStyle}>{money(movement.amount)}</td>

                  <td style={tdStyle}>
                    {getPaymentMethodLabel(movement.payment_method)}
                  </td>

                  <td style={tdStyle}>{movement.created_by_name || '—'}</td>

                  <td style={tdStyle}>{formatDate(movement.created_at)}</td>

                  <td style={tdStyle}>{movement.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {details.variances.length > 0 ? (
          <>
            <h4>فروق الشفت</h4>

            <div
              style={{
                display: 'grid',
                gap: '8px',
              }}
            >
              {details.variances.map((variance) => (
                <div
                  key={variance.id}
                  style={{
                    padding: '12px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.04)',
                  }}
                >
                  {getCashShiftVarianceStageLabel(variance.stage)}

                  {' — '}

                  {getCashShiftVarianceKindLabel(variance.kind)}

                  {' — '}

                  {money(variance.amount)}

                  {' — '}

                  {getCashShiftVarianceStatusLabel(variance.status)}

                  {variance.resolution_notes
                    ? ` — ${variance.resolution_notes}`
                    : ''}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function getMovementTypeLabel(type: string) {
  switch (type) {
    case 'sale':
      return 'بيع'

    case 'sale_return':
      return 'مرتجع بيع'

    case 'sale_exchange':
      return 'استبدال بيع'

    case 'customer_payment':
      return 'دفعة عميل'

    case 'supplier_payment':
      return 'دفعة مورد'

    case 'purchase_return':
      return 'مرتجع شراء'

    case 'expense':
      return 'مصروف'

    case 'liability_payment':
      return 'دفعة التزام'

    case 'deposit':
      return 'إيداع'

    case 'withdraw':
      return 'سحب'

    case 'transfer':
      return 'تحويل'

    case 'shift_adjustment':
      return 'تسوية شفت'

    default:
      return type
  }
}

function money(value?: number | null) {
  return `${Number(value || 0).toFixed(2)} ج.م`
}

function formatDate(value?: string | null) {
  if (!value) {
    return '—'
  }

  const raw = String(value)

  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`

  const date = new Date(normalized)

  if (Number.isNaN(date.getTime())) {
    return raw
  }

  return date.toLocaleString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label
      style={{
        display: 'grid',
        gap: '4px',
      }}
    >
      <span
        style={{
          color: '#94a3b8',
          fontSize: '11px',
          fontWeight: 800,
        }}
      >
        {label}
      </span>

      {children}
    </label>
  )
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        padding: '12px',
        borderRadius: '12px',
        background: 'rgba(255,255,255,0.04)',
        display: 'grid',
        gap: '5px',
      }}
    >
      <span
        style={{
          color: '#94a3b8',
          fontSize: '11px',
          fontWeight: 800,
        }}
      >
        {title}
      </span>

      <strong>{value}</strong>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  minWidth: '150px',
  height: '38px',
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  padding: '0 10px',
}

const primaryButtonStyle: React.CSSProperties = {
  minHeight: '38px',
  border: 'none',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 14px',
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: '38px',
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 14px',
  cursor: 'pointer',
}

const smallButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  minHeight: '30px',
  fontSize: '11px',
}

const thStyle: React.CSSProperties = {
  padding: '10px',
  color: '#cbd5e1',
  fontWeight: 900,
  textAlign: 'right',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '10px',
  color: '#e5e7eb',
  textAlign: 'right',
  whiteSpace: 'nowrap',
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000000,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  padding: '20px',
  background: 'rgba(2,6,23,0.84)',
}

const modalCardStyle: React.CSSProperties = {
  maxWidth: '100%',
  padding: '18px',
  borderRadius: '20px',
  background: 'var(--bg-soft)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  direction: 'rtl',
  boxShadow: '0 30px 100px rgba(0,0,0,0.75)',
}
