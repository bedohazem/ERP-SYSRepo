import { useEffect, useState } from 'react'

import {
  formatCashShiftDuration,
  getCashShiftStatusLabel,
  getCashShiftVarianceKindLabel,
  getCashShiftVarianceStageLabel,
  getCashShiftVarianceStatusLabel,
} from '../../utils/cash-shifts'
import PaginationBar, { SYSTEM_PAGE_SIZE } from '../../components/PaginationBar'
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

    original_signed_amount: number

    correction_effect_amount: number

    remaining_signed_amount: number

    remaining_amount: number

    remaining_kind: 'shortage' | 'surplus' | 'balanced'

    correction_count: number

    status: 'pending' | 'resolved'

    resolution_notes?: string | null
  }>
}

type ShiftUserOption = {
  id: number
  name: string
  role: string
}

type Props = {
  users: ShiftUserOption[]
}

export default function ShiftHistorySection({ users }: Props) {
  const [rows, setRows] = useState<ShiftRow[]>([])

  const [total, setTotal] = useState(0)

  const [page, setPage] = useState(1)

  const [userId, setUserId] = useState('')

  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all')

  const [dateFrom, setDateFrom] = useState('')

  const [dateTo, setDateTo] = useState('')

  const [loading, setLoading] = useState(false)

  const [details, setDetails] = useState<ShiftDetails | null>(null)

  const [detailsLoading, setDetailsLoading] = useState(false)

  const [error, setError] = useState('')

  async function loadHistory(targetPage = page) {
    setLoading(true)
    setError('')

    const safePage = Math.max(1, Number(targetPage || 1))

    try {
      const result = await window.api.getCashShifts({
        status,

        user_id: userId ? Number(userId) : undefined,

        date_from: dateFrom || undefined,

        date_to: dateTo || undefined,

        limit: SYSTEM_PAGE_SIZE,

        offset: (safePage - 1) * SYSTEM_PAGE_SIZE,
      })

      setRows(Array.isArray(result.rows) ? result.rows : [])

      setTotal(Number(result.total || 0))

      setPage(safePage)
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
    void loadHistory(1)
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

            <Field label="المستخدم">
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                style={inputStyle}
              >
                <option value="">كل المستخدمين</option>

                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                    {user.role === 'admin' ? ' — مدير' : ' — كاشير'}
                  </option>
                ))}
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
              onClick={() => {
                setPage(1)
                void loadHistory(1)
              }}
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

        <PaginationBar
          page={page}
          totalItems={total}
          loading={loading}
          onPageChange={(nextPage) => {
            void loadHistory(nextPage)
          }}
        />

        <div
          style={{
            width: '100%',
            maxWidth: '100%',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '14px',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              direction: 'rtl',
              tableLayout: 'fixed',
            }}
          >
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>

            <thead>
              <tr>
                <th style={thStyle}>الشفت</th>
                <th style={thStyle}>الكاشير</th>
                <th style={thStyle}>الحالة</th>
                <th style={thStyle}>وقت الشفت</th>
                <th style={thStyle}>الافتتاح</th>
                <th style={thStyle}>حركة الدرج</th>
                <th style={thStyle}>الجرد</th>
                <th style={thStyle}>التسليم</th>
                <th style={thStyle}>الفروق والمراجعة</th>
                <th style={thStyle}>إجراء</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={10}
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
                    <td style={tdStyle}>
                      <strong>#{row.id}</strong>
                    </td>

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

                    <td style={tdStyle}>
                      <div style={stackStyle}>
                        <span>{formatDate(row.opened_at)}</span>

                        <span style={secondaryTextStyle}>
                          {formatCashShiftDuration(row.duration_minutes)}
                        </span>
                      </div>
                    </td>

                    <td style={tdStyle}>
                      <div style={stackStyle}>
                        <strong>
                          {tableMoney(row.opening_counted_amount)}
                        </strong>

                        {Number(row.opening_difference || 0) !== 0 ? (
                          <span
                            style={{
                              fontSize: '9px',
                              fontWeight: 800,
                              color:
                                Number(row.opening_difference) < 0
                                  ? '#f87171'
                                  : '#fbbf24',
                            }}
                          >
                            {Number(row.opening_difference) < 0
                              ? `عجز ${tableMoney(
                                  Math.abs(Number(row.opening_difference)),
                                )}`
                              : `زيادة ${tableMoney(
                                  Number(row.opening_difference),
                                )}`}
                          </span>
                        ) : (
                          <span style={secondaryTextStyle}>بدون فرق</span>
                        )}
                      </div>
                    </td>

                    <td style={tdStyle}>
                      <div style={stackStyle}>
                        <span>
                          <span style={labelStyle}>داخل:</span>{' '}
                          <strong
                            style={{
                              color: '#34d399',
                            }}
                          >
                            {tableMoney(row.cash_in)}
                          </strong>
                        </span>

                        <span>
                          <span style={labelStyle}>خارج:</span>{' '}
                          <strong
                            style={{
                              color: '#f87171',
                            }}
                          >
                            {tableMoney(row.cash_out)}
                          </strong>
                        </span>
                      </div>
                    </td>

                    <td style={tdStyle}>
                      <div style={stackStyle}>
                        <span>
                          <span style={labelStyle}>المتوقع:</span>{' '}
                          <strong>
                            {row.expected_closing_amount == null
                              ? '—'
                              : tableMoney(row.expected_closing_amount)}
                          </strong>
                        </span>

                        <span>
                          <span style={labelStyle}>الفعلي:</span>{' '}
                          <strong>
                            {row.closing_counted_amount == null
                              ? '—'
                              : tableMoney(row.closing_counted_amount)}
                          </strong>
                        </span>

                        <span>
                          <span style={labelStyle}>الفرق:</span>{' '}
                          <strong
                            style={{
                              color:
                                row.closing_difference == null
                                  ? '#94a3b8'
                                  : Number(row.closing_difference) < 0
                                    ? '#f87171'
                                    : Number(row.closing_difference) > 0
                                      ? '#fbbf24'
                                      : '#34d399',
                            }}
                          >
                            {row.closing_difference == null
                              ? '—'
                              : tableMoney(row.closing_difference)}
                          </strong>
                        </span>
                      </div>
                    </td>

                    <td style={tdStyle}>
                      <div style={stackStyle}>
                        <span>
                          <span style={labelStyle}>التالي:</span>{' '}
                          <strong>
                            {row.left_for_next_shift == null
                              ? '—'
                              : tableMoney(row.left_for_next_shift)}
                          </strong>
                        </span>

                        <span>
                          <span style={labelStyle}>الآمنة:</span>{' '}
                          <strong>
                            {row.safe_transfer_amount == null
                              ? '—'
                              : tableMoney(row.safe_transfer_amount)}
                          </strong>
                        </span>
                      </div>
                    </td>

                    <td style={tdStyle}>
                      <div style={stackStyle}>
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

                        {Number(row.opening_difference || 0) !== 0 ? (
                          <span
                            style={{
                              fontSize: '9px',
                              fontWeight: 800,
                              color:
                                Number(row.opening_difference) < 0
                                  ? '#f87171'
                                  : '#fbbf24',
                            }}
                          >
                            افتتاح:{' '}
                            {Number(row.opening_difference) < 0
                              ? `عجز ${tableMoney(
                                  Math.abs(Number(row.opening_difference)),
                                )}`
                              : `زيادة ${tableMoney(
                                  Number(row.opening_difference),
                                )}`}
                          </span>
                        ) : null}

                        {row.closing_difference != null &&
                        Number(row.closing_difference) !== 0 ? (
                          <span
                            style={{
                              fontSize: '9px',
                              fontWeight: 800,
                              color:
                                Number(row.closing_difference) < 0
                                  ? '#f87171'
                                  : '#fbbf24',
                            }}
                          >
                            إغلاق:{' '}
                            {Number(row.closing_difference) < 0
                              ? `عجز ${tableMoney(
                                  Math.abs(Number(row.closing_difference)),
                                )}`
                              : `زيادة ${tableMoney(
                                  Number(row.closing_difference),
                                )}`}
                          </span>
                        ) : null}

                        {Number(row.opening_difference || 0) === 0 &&
                        (row.closing_difference == null ||
                          Number(row.closing_difference) === 0) ? (
                          <span style={secondaryTextStyle}>
                            لا يوجد فرق مالي
                          </span>
                        ) : null}
                      </div>
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
                    colSpan={10}
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

  const visibleMovements = details.movements.filter((movement) => {
    /*
     * توريد إغلاق الشفت مسجل بطرفين:
     * out من الدرج + in للخزنة الآمنة.
     * نعرض طرف الدرج فقط حتى لا يبدو مكررًا.
     */
    if (
      movement.reference_type === 'cash_shift_safe_transfer' &&
      movement.payment_method === 'store_safe'
    ) {
      return false
    }

    return true
  })

  function printReport() {
    const printWindow = window.open('', '_blank', 'width=1000,height=800')

    if (!printWindow) {
      return
    }

    const movementsHtml = visibleMovements
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
            title="فرق الإغلاق وقت الجرد"
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
              {visibleMovements.map((movement) => (
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

                    border: '1px solid rgba(255,255,255,0.06)',

                    display: 'grid',

                    gap: '7px',
                  }}
                >
                  <div>
                    <strong>
                      {getCashShiftVarianceStageLabel(variance.stage)}
                    </strong>
                    {' — '}
                    الفرق الأصلي:{' '}
                    <strong>
                      {getCashShiftVarianceKindLabel(variance.kind)}{' '}
                      {money(variance.amount)}
                    </strong>
                  </div>

                  {variance.stage === 'closing' && (
                    <>
                      <div>
                        صافي التصحيحات:{' '}
                        <strong>
                          {signedMoney(variance.correction_effect_amount)}
                        </strong>
                      </div>

                      <div>
                        المتبقي:{' '}
                        <strong
                          style={{
                            color:
                              variance.remaining_kind === 'balanced'
                                ? '#34d399'
                                : variance.remaining_kind === 'shortage'
                                  ? '#f87171'
                                  : '#fbbf24',
                          }}
                        >
                          {variance.remaining_kind === 'balanced'
                            ? 'متطابق — 0.00 ج.م'
                            : `${
                                variance.remaining_kind === 'shortage'
                                  ? 'عجز'
                                  : 'زيادة'
                              } ${money(variance.remaining_amount)}`}
                        </strong>
                      </div>

                      <div
                        style={{
                          color: '#94a3b8',

                          fontSize: '11px',
                        }}
                      >
                        عدد التصحيحات: {variance.correction_count}
                      </div>
                    </>
                  )}

                  <div>
                    الحالة:{' '}
                    <strong>
                      {getCashShiftVarianceStatusLabel(variance.status)}
                    </strong>
                  </div>

                  {variance.resolution_notes && (
                    <div
                      style={{
                        color: '#94a3b8',
                        fontSize: '11px',
                      }}
                    >
                      نتيجة المراجعة: {variance.resolution_notes}
                    </div>
                  )}
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

function signedMoney(value?: number | null) {
  const amount = Number(value || 0)

  if (Math.abs(amount) <= 0.001) {
    return '0.00 ج.م'
  }

  return `${amount > 0 ? '+' : ''}${amount.toFixed(2)} ج.م`
}

function tableMoney(value?: number | null) {
  return Number(value || 0).toFixed(2)
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
  minHeight: '28px',
  padding: '0 7px',
  fontSize: '10px',
}

const thStyle: React.CSSProperties = {
  padding: '9px 5px',
  color: '#cbd5e1',
  fontWeight: 900,
  fontSize: '11px',
  lineHeight: 1.2,
  textAlign: 'center',
  verticalAlign: 'middle',
}

const tdStyle: React.CSSProperties = {
  padding: '9px 5px',
  color: '#e5e7eb',
  fontSize: '11px',
  lineHeight: 1.3,
  textAlign: 'center',
  verticalAlign: 'middle',
  overflow: 'hidden',
}

const stackStyle: React.CSSProperties = {
  display: 'grid',
  gap: '3px',
  alignItems: 'center',
  justifyItems: 'center',
}

const labelStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: '9px',
  fontWeight: 700,
}

const secondaryTextStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: '9px',
  fontWeight: 700,
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
