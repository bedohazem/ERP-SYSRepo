import { useEffect, useState } from 'react'

import {
  canResolveCashShiftVariance,
  getCashShiftVarianceKindLabel,
  getCashShiftVarianceResolutionLabel,
  getCashShiftVarianceStageLabel,
  getCashShiftVarianceStatusLabel,
} from '../../utils/cash-shifts'

type CashShift = {
  id: number

  status: 'open' | 'closed'

  opened_by: number
  opened_by_name?: string | null

  opened_at: string

  opening_counted_amount: number
  opening_difference: number

  expected_closing_amount?: number | null
  closing_counted_amount?: number | null
  closing_difference?: number | null

  left_for_next_shift?: number | null
  safe_transfer_amount?: number | null

  closed_by?: number | null
  closed_by_name?: string | null
  closed_at?: string | null
}

type CashShiftVariance = {
  id: number

  shift_id: number

  stage: 'opening' | 'closing'

  kind: 'shortage' | 'surplus'

  amount: number

  status: 'pending' | 'resolved'

  resolution_type: 'approved' | 'explained' | 'other' | null

  resolution_notes: string | null

  resolved_by: number | null

  resolved_by_name?: string | null

  resolved_at: string | null

  created_at: string

  shift_status: 'open' | 'closed'

  opened_by: number

  opened_by_name?: string | null

  shift_opened_at: string

  shift_closed_at: string | null
}

type VarianceStatusFilter = 'all' | 'pending' | 'resolved'

type ResolutionType = 'approved' | 'explained' | 'other'

export default function ShiftManagementPage() {
  const [openShift, setOpenShift] = useState<CashShift | null>(null)

  const [variances, setVariances] = useState<CashShiftVariance[]>([])

  const [statusFilter, setStatusFilter] =
    useState<VarianceStatusFilter>('pending')

  const [pendingCount, setPendingCount] = useState(0)

  const [total, setTotal] = useState(0)

  const [loading, setLoading] = useState(false)

  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const [resolveTarget, setResolveTarget] = useState<CashShiftVariance | null>(
    null,
  )

  const [resolutionType, setResolutionType] =
    useState<ResolutionType>('explained')

  const [resolutionNotes, setResolutionNotes] = useState('')

  const [adminPassword, setAdminPassword] = useState('')

  const [resolving, setResolving] = useState(false)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({
      type,
      text,
    })

    window.setTimeout(() => {
      setMessage(null)
    }, 2200)
  }

  async function loadData(filter = statusFilter) {
    setLoading(true)

    try {
      const [currentShift, varianceResult] = await Promise.all([
        window.api.getOpenCashShift(),

        window.api.listCashShiftVariances({
          status: filter,
          limit: 200,
          offset: 0,
        }),
      ])

      setOpenShift(currentShift || null)

      setVariances(
        Array.isArray(varianceResult?.rows) ? varianceResult.rows : [],
      )

      setTotal(Number(varianceResult?.total || 0))

      setPendingCount(Number(varianceResult?.pending_count || 0))
    } catch (error) {
      console.error(error)

      showMessage(
        'error',
        error instanceof Error
          ? error.message
          : 'تعذر تحميل بيانات إدارة الشفتات',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData('pending')
  }, [])

  function openVarianceReview(variance: CashShiftVariance) {
    if (!canResolveCashShiftVariance(variance)) {
      return
    }

    setResolveTarget(variance)

    setResolutionType('explained')

    setResolutionNotes('')

    setAdminPassword('')
  }

  function closeVarianceReview() {
    if (resolving) {
      return
    }

    setResolveTarget(null)

    setResolutionType('explained')

    setResolutionNotes('')

    setAdminPassword('')
  }

  async function submitVarianceReview() {
    if (!resolveTarget || resolving) {
      return
    }

    if (!resolutionNotes.trim()) {
      showMessage('error', 'اكتب نتيجة مراجعة فرق الشفت')

      return
    }

    if (!adminPassword.trim()) {
      showMessage('error', 'اكتب كلمة مرور المدير')

      return
    }

    setResolving(true)

    try {
      const result = await window.api.resolveCashShiftVariance({
        variance_id: resolveTarget.id,

        resolution_type: resolutionType,

        resolution_notes: resolutionNotes.trim(),

        admin_password: adminPassword,
      })

      if (!result?.success) {
        showMessage('error', result?.message || 'تعذر مراجعة فرق الشفت')

        return
      }

      closeVarianceReview()

      showMessage('success', 'تم اعتماد مراجعة فرق الشفت')

      await loadData(statusFilter)
    } catch (error) {
      showMessage(
        'error',
        error instanceof Error ? error.message : 'تعذر مراجعة فرق الشفت',
      )
    } finally {
      setResolving(false)
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: '16px',
        minHeight: 0,
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
              message.type === 'error'
                ? 'rgba(239,68,68,0.95)'
                : 'rgba(16,185,129,0.95)',

            color: '#fff',

            fontWeight: 900,

            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
          }}
        >
          {message.text}
        </div>
      )}

      <section
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '20px',

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
              margin: '0 0 7px',
            }}
          >
            إدارة الشفتات
          </h2>

          <p
            style={{
              margin: 0,

              color: '#94a3b8',

              fontWeight: 700,
            }}
          >
            متابعة الشفت الحالي ومراجعة فروق الجرد
          </p>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void loadData(statusFilter)}
          style={{
            ...primaryButtonStyle,

            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'جاري التحديث...' : 'تحديث البيانات'}
        </button>
      </section>

      <section
        style={{
          display: 'grid',

          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',

          gap: '12px',
        }}
      >
        <SummaryCard
          title="الشفت الحالي"
          value={openShift ? `#${openShift.id}` : 'لا يوجد'}
          subtitle={
            openShift
              ? openShift.opened_by_name || 'مستخدم غير معروف'
              : 'لا يوجد شفت مفتوح حاليًا'
          }
        />

        <SummaryCard
          title="رصيد افتتاح الشفت"
          value={openShift ? money(openShift.opening_counted_amount) : '—'}
          subtitle={openShift ? `فتح: ${formatDate(openShift.opened_at)}` : '—'}
        />

        <SummaryCard
          title="فروق تحتاج مراجعة"
          value={String(pendingCount)}
          subtitle="عجز أو زيادة لم يتم اعتماد مراجعتها"
          warning={pendingCount > 0}
        />

        <SummaryCard
          title="نتائج الفلتر"
          value={String(total)}
          subtitle={getFilterLabel(statusFilter)}
        />
      </section>

      {openShift && (
        <section
          className="glass-card"
          style={{
            padding: '16px',

            borderRadius: '18px',

            direction: 'rtl',
          }}
        >
          <div
            style={{
              display: 'grid',

              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',

              gap: '12px',
            }}
          >
            <InfoItem label="رقم الشفت" value={`#${openShift.id}`} />

            <InfoItem
              label="صاحب الشفت"
              value={openShift.opened_by_name || '—'}
            />

            <InfoItem
              label="وقت الفتح"
              value={formatDate(openShift.opened_at)}
            />

            <InfoItem
              label="رصيد الافتتاح"
              value={money(openShift.opening_counted_amount)}
            />

            <InfoItem
              label="فرق الافتتاح"
              value={money(openShift.opening_difference)}
            />

            <InfoItem label="الحالة" value="مفتوح" />
          </div>
        </section>
      )}

      <section
        className="glass-card"
        style={{
          padding: '16px',

          borderRadius: '20px',

          minHeight: 0,

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
              فروق الشفتات
            </h3>

            <div
              style={{
                color: '#94a3b8',

                fontSize: '13px',

                fontWeight: 700,
              }}
            >
              مراجعة فروق الافتتاح والإغلاق بدون إنشاء حركة مالية جديدة
            </div>
          </div>

          <label
            style={{
              display: 'grid',

              gap: '5px',

              minWidth: '190px',

              color: '#94a3b8',

              fontWeight: 800,

              fontSize: '12px',
            }}
          >
            الحالة
            <select
              value={statusFilter}
              onChange={(e) => {
                const next = e.target.value as VarianceStatusFilter

                setStatusFilter(next)

                void loadData(next)
              }}
              style={inputStyle}
            >
              <option value="pending">قيد المراجعة</option>

              <option value="resolved">تمت المراجعة</option>

              <option value="all">الكل</option>
            </select>
          </label>
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

              minWidth: '950px',

              borderCollapse: 'collapse',

              direction: 'rtl',
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>الشفت</th>

                <th style={thStyle}>الكاشير</th>

                <th style={thStyle}>المرحلة</th>

                <th style={thStyle}>الفرق</th>

                <th style={thStyle}>المبلغ</th>

                <th style={thStyle}>التاريخ</th>

                <th style={thStyle}>الحالة</th>

                <th style={thStyle}>نتيجة المراجعة</th>

                <th style={thStyle}>إجراء</th>
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      ...tdStyle,

                      textAlign: 'center',

                      padding: '28px',
                    }}
                  >
                    جاري التحميل...
                  </td>
                </tr>
              )}

              {!loading &&
                variances.map((variance) => (
                  <tr
                    key={variance.id}
                    style={{
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <td style={tdStyle}>#{variance.shift_id}</td>

                    <td style={tdStyle}>{variance.opened_by_name || '—'}</td>

                    <td style={tdStyle}>
                      {getCashShiftVarianceStageLabel(variance.stage)}
                    </td>

                    <td style={tdStyle}>
                      <strong
                        style={{
                          color:
                            variance.kind === 'shortage'
                              ? '#f87171'
                              : '#34d399',
                        }}
                      >
                        {getCashShiftVarianceKindLabel(variance.kind)}
                      </strong>
                    </td>

                    <td
                      style={{
                        ...tdStyle,

                        fontWeight: 900,
                      }}
                    >
                      {money(variance.amount)}
                    </td>

                    <td style={tdStyle}>{formatDate(variance.created_at)}</td>

                    <td style={tdStyle}>
                      <span
                        style={{
                          color:
                            variance.status === 'pending'
                              ? '#fbbf24'
                              : '#34d399',

                          fontWeight: 900,
                        }}
                      >
                        {getCashShiftVarianceStatusLabel(variance.status)}
                      </span>
                    </td>

                    <td style={tdStyle}>
                      {variance.status === 'resolved' ? (
                        <div
                          style={{
                            display: 'grid',

                            gap: '4px',
                          }}
                        >
                          <strong>
                            {getCashShiftVarianceResolutionLabel(
                              variance.resolution_type,
                            )}
                          </strong>

                          <span
                            style={{
                              color: '#94a3b8',

                              fontSize: '11px',

                              whiteSpace: 'normal',
                            }}
                          >
                            {variance.resolution_notes || '—'}
                          </span>

                          <span
                            style={{
                              color: '#64748b',

                              fontSize: '10px',
                            }}
                          >
                            {variance.resolved_by_name || '—'}

                            {' • '}

                            {formatDate(variance.resolved_at)}
                          </span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>

                    <td style={tdStyle}>
                      {canResolveCashShiftVariance(variance) ? (
                        <button
                          type="button"
                          onClick={() => openVarianceReview(variance)}
                          style={{
                            ...primaryButtonStyle,

                            height: '32px',

                            padding: '0 12px',

                            fontSize: '11px',
                          }}
                        >
                          مراجعة
                        </button>
                      ) : (
                        <span
                          style={{
                            color: '#64748b',

                            fontSize: '11px',
                          }}
                        >
                          مكتملة
                        </span>
                      )}
                    </td>
                  </tr>
                ))}

              {!loading && variances.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      ...tdStyle,

                      textAlign: 'center',

                      padding: '34px',

                      color: '#94a3b8',
                    }}
                  >
                    لا توجد فروق شفتات بهذه الحالة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {resolveTarget && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div className="theme-modal-card" style={modalCardStyle}>
            <div
              style={{
                display: 'flex',

                justifyContent: 'space-between',

                gap: '12px',

                alignItems: 'center',

                marginBottom: '16px',
              }}
            >
              <div>
                <h3
                  style={{
                    margin: '0 0 5px',
                  }}
                >
                  مراجعة فرق الشفت #{resolveTarget.shift_id}
                </h3>

                <div
                  style={{
                    color: '#94a3b8',

                    fontSize: '12px',
                  }}
                >
                  {getCashShiftVarianceKindLabel(resolveTarget.kind)}

                  {' — '}

                  {money(resolveTarget.amount)}
                </div>
              </div>

              <button
                type="button"
                onClick={closeVarianceReview}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: 'grid',

                gap: '12px',
              }}
            >
              <Field label="نتيجة المراجعة">
                <select
                  value={resolutionType}
                  onChange={(e) =>
                    setResolutionType(e.target.value as ResolutionType)
                  }
                  style={inputStyle}
                >
                  <option value="explained">تم تفسير سبب الفرق</option>

                  <option value="approved">تم التحقق واعتماد الفرق</option>

                  <option value="other">أخرى</option>
                </select>
              </Field>

              <Field label="ملاحظات المراجعة">
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="اكتب سبب الفرق ونتيجة المراجعة"
                  style={{
                    ...inputStyle,

                    height: '100px',

                    padding: '10px 12px',

                    resize: 'vertical',
                  }}
                />
              </Field>

              <Field label="كلمة مرور المدير">
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="كلمة مرور المدير"
                  style={inputStyle}
                />
              </Field>

              <div
                style={{
                  display: 'flex',

                  gap: '10px',
                }}
              >
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => void submitVarianceReview()}
                  style={{
                    ...primaryButtonStyle,

                    flex: 1,

                    opacity: resolving ? 0.6 : 1,
                  }}
                >
                  {resolving ? 'جاري الحفظ...' : 'اعتماد المراجعة'}
                </button>

                <button
                  type="button"
                  disabled={resolving}
                  onClick={closeVarianceReview}
                  style={{
                    ...secondaryButtonStyle,

                    flex: 1,
                  }}
                >
                  رجوع
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function getFilterLabel(filter: VarianceStatusFilter) {
  switch (filter) {
    case 'pending':
      return 'الفروق قيد المراجعة'

    case 'resolved':
      return 'الفروق التي تمت مراجعتها'

    default:
      return 'كل فروق الشفتات'
  }
}

function money(value?: number | null) {
  return `${Number(value || 0).toFixed(2)} ج.م`
}

function formatDate(value?: string | null) {
  if (!value) {
    return '—'
  }

  try {
    const raw = String(value)

    const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`

    return new Date(normalized).toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(value)
  }
}

function SummaryCard({
  title,
  value,
  subtitle,
  warning = false,
}: {
  title: string
  value: string
  subtitle: string
  warning?: boolean
}) {
  return (
    <div
      className="glass-card"
      style={{
        padding: '16px',

        borderRadius: '18px',

        display: 'grid',

        gap: '7px',

        direction: 'rtl',

        border: warning
          ? '1px solid rgba(245,158,11,0.35)'
          : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div
        style={{
          color: '#94a3b8',

          fontWeight: 800,

          fontSize: '13px',
        }}
      >
        {title}
      </div>

      <strong
        style={{
          fontSize: '24px',

          color: warning ? '#fbbf24' : '#f8fafc',
        }}
      >
        {value}
      </strong>

      <div
        style={{
          color: '#64748b',

          fontWeight: 700,

          fontSize: '12px',
        }}
      >
        {subtitle}
      </div>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'grid',

        gap: '5px',

        padding: '12px',

        borderRadius: '12px',

        background: 'rgba(255,255,255,0.04)',
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

      <strong>{value}</strong>
    </div>
  )
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

        gap: '5px',
      }}
    >
      <span
        style={{
          color: '#94a3b8',

          fontWeight: 800,

          fontSize: '12px',
        }}
      >
        {label}
      </span>

      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',

  minHeight: '42px',

  borderRadius: '11px',

  border: '1px solid rgba(255,255,255,0.10)',

  background: 'rgba(255,255,255,0.05)',

  color: '#fff',

  outline: 'none',

  padding: '0 12px',

  direction: 'rtl',

  boxSizing: 'border-box',
}

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',

  minHeight: '42px',

  borderRadius: '11px',

  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',

  color: '#fff',

  fontWeight: 900,

  padding: '0 16px',

  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: '42px',

  borderRadius: '11px',

  border: '1px solid rgba(255,255,255,0.12)',

  background: 'rgba(255,255,255,0.06)',

  color: '#fff',

  fontWeight: 900,

  padding: '0 16px',

  cursor: 'pointer',
}

const thStyle: React.CSSProperties = {
  padding: '12px',

  color: '#cbd5e1',

  fontWeight: 900,

  textAlign: 'right',

  whiteSpace: 'nowrap',

  background: 'rgba(255,255,255,0.03)',
}

const tdStyle: React.CSSProperties = {
  padding: '12px',

  color: '#e5e7eb',

  textAlign: 'right',

  whiteSpace: 'nowrap',
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',

  inset: 0,

  zIndex: 1000000,

  display: 'flex',

  alignItems: 'center',

  justifyContent: 'center',

  padding: '20px',

  background: 'rgba(2,6,23,0.82)',

  backdropFilter: 'blur(7px)',
}

const modalCardStyle: React.CSSProperties = {
  width: '520px',

  maxWidth: '100%',

  padding: '18px',

  borderRadius: '20px',

  background: 'var(--bg-soft)',

  border: '1px solid var(--border)',

  color: 'var(--text)',

  direction: 'rtl',

  boxShadow: '0 30px 100px rgba(0,0,0,0.75)',
}

const closeButtonStyle: React.CSSProperties = {
  width: '34px',

  height: '34px',

  borderRadius: '10px',

  border: '1px solid rgba(255,255,255,0.12)',

  background: 'rgba(255,255,255,0.05)',

  color: 'var(--text)',

  fontSize: '18px',

  cursor: 'pointer',
}
