import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

import {
  getCashShiftVarianceKindLabel,
  getCashShiftVarianceResolutionLabel,
  getCashShiftVarianceStageLabel,
} from '../../utils/cash-shifts'

type Props = {
  varianceId: number
  onClose: () => void
  onChanged: () => void | Promise<void>
}

type ReviewData = {
  variance: {
    id: number

    shift_id: number

    stage: 'opening' | 'closing'

    kind: 'shortage' | 'surplus'

    amount: number

    status: 'pending' | 'resolved'

    resolution_type: 'approved' | 'explained' | 'other' | null

    resolution_notes?: string | null

    resolved_by_name?: string | null

    resolved_at?: string | null

    expected_opening_amount?: number | null

    opening_counted_amount?: number

    opening_difference?: number

    expected_closing_amount?: number | null

    closing_counted_amount?: number | null

    closing_difference?: number | null
  }

  corrections?: any[]
}

function money(value?: number | null) {
  return `${Number(value || 0).toFixed(2)} ج.م`
}

function signedMoney(kind: 'shortage' | 'surplus', amount: number) {
  return `${kind === 'shortage' ? '-' : '+'}${money(amount)}`
}

export default function ShiftVarianceReviewModal({
  varianceId,
  onClose,
  onChanged,
}: Props) {
  const [review, setReview] = useState<ReviewData | null>(null)

  const [loading, setLoading] = useState(true)

  const [saving, setSaving] = useState(false)

  const [notes, setNotes] = useState('')

  const [adminPassword, setAdminPassword] = useState('')

  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  async function loadReview() {
    setLoading(true)

    try {
      const result = await window.api.getCashShiftVarianceReview(varianceId)

      setReview(result as ReviewData)
    } catch (error) {
      setMessage({
        type: 'error',

        text: error instanceof Error ? error.message : 'تعذر تحميل فرق الشفت',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReview()
  }, [varianceId])

  async function resolveVariance(resolutionType: 'approved' | 'explained') {
    if (!review || saving) {
      return
    }

    if (!notes.trim()) {
      setMessage({
        type: 'error',
        text: 'اكتب سبب قرار المدير',
      })

      return
    }

    if (!adminPassword.trim()) {
      setMessage({
        type: 'error',
        text: 'اكتب كلمة مرور المدير',
      })

      return
    }

    setSaving(true)

    try {
      const result = await window.api.resolveCashShiftVariance({
        variance_id: review.variance.id,

        resolution_type: resolutionType,

        resolution_notes: notes.trim(),

        admin_password: adminPassword,
      })

      if (!result.success) {
        setMessage({
          type: 'error',

          text: result.message || 'تعذر اعتماد قرار فرق الشفت',
        })

        return
      }

      await onChanged()

      onClose()
    } catch (error) {
      setMessage({
        type: 'error',

        text:
          error instanceof Error ? error.message : 'تعذر اعتماد قرار فرق الشفت',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="theme-modal-overlay" style={overlayStyle}>
        <div className="theme-modal-card" style={cardStyle}>
          جاري تحميل فرق الشفت...
        </div>
      </div>
    )
  }

  if (!review) {
    return null
  }

  const variance = review.variance

  const isClosing = variance.stage === 'closing'

  const isResolved = variance.status === 'resolved'

  const genuineButtonLabel =
    variance.kind === 'shortage'
      ? 'اعتماد كعجز فعلي — يخصم من رأس المال'
      : 'اعتماد كزيادة فعلية — تضاف إلى رأس المال'

  return (
    <div className="theme-modal-overlay" style={overlayStyle}>
      <div className="theme-modal-card" style={cardStyle}>
        <div style={headerStyle}>
          <div>
            <h3
              style={{
                margin: 0,
              }}
            >
              مراجعة فرق الشفت #{variance.shift_id}
            </h3>

            <div style={subtleStyle}>
              {getCashShiftVarianceStageLabel(variance.stage)}
            </div>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            style={closeButtonStyle}
          >
            ×
          </button>
        </div>

        {message && (
          <div
            style={{
              ...messageStyle,

              borderColor:
                message.type === 'error'
                  ? 'rgba(248,113,113,.35)'
                  : 'rgba(52,211,153,.35)',

              color: message.type === 'error' ? '#fecaca' : '#a7f3d0',
            }}
          >
            {message.text}
          </div>
        )}

        <div style={summaryGridStyle}>
          <InfoCard
            title="نوع الفرق"
            value={getCashShiftVarianceKindLabel(variance.kind)}
            valueColor={variance.kind === 'shortage' ? '#f87171' : '#34d399'}
          />

          <InfoCard
            title="قيمة الفرق"
            value={signedMoney(variance.kind, variance.amount)}
            valueColor={variance.kind === 'shortage' ? '#f87171' : '#34d399'}
          />

          {isClosing ? (
            <>
              <InfoCard
                title="المتوقع عند الإغلاق"
                value={money(variance.expected_closing_amount)}
              />

              <InfoCard
                title="الجرد الفعلي"
                value={money(variance.closing_counted_amount)}
              />
            </>
          ) : (
            <>
              <InfoCard
                title="المتوقع عند الاستلام"
                value={
                  variance.expected_opening_amount == null
                    ? '—'
                    : money(variance.expected_opening_amount)
                }
              />

              <InfoCard
                title="المستلم فعليًا"
                value={money(variance.opening_counted_amount)}
              />
            </>
          )}
        </div>

        {isResolved ? (
          <div style={resolvedBoxStyle}>
            <strong
              style={{
                fontSize: '16px',
              }}
            >
              {getCashShiftVarianceResolutionLabel(variance.resolution_type)}
            </strong>

            <div style={resolvedRowStyle}>
              <span>سبب المدير:</span>

              <strong>{variance.resolution_notes || '—'}</strong>
            </div>

            <div style={resolvedRowStyle}>
              <span>تمت المراجعة بواسطة:</span>

              <strong>{variance.resolved_by_name || '—'}</strong>
            </div>
          </div>
        ) : (
          <>
            <div style={infoBoxStyle}>
              {isClosing ? (
                <>
                  الجرد الفعلي ورصيد الدرج والخزنة لن يتم تغييرهم من هذه الشاشة.
                  قرارك هنا يحدد فقط هل فرق الإغلاق يعتبر خسارة / زيادة حقيقية
                  تؤثر على رأس المال أم سيتم التعامل مع سببه يدويًا بدون تأثير
                  مباشر على رأس المال.
                </>
              ) : (
                <>
                  فرق استلام الشفت يتم تسجيله للمراجعة فقط. اكتب سبب الفرق
                  واعتمد نتيجة الاستلام.
                </>
              )}
            </div>

            <label style={fieldStyle}>
              <span>سبب / ملاحظات المدير</span>

              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={
                  isClosing
                    ? 'مثال: عجز نقدي فعلي، خطأ تسجيل وسيتم التعامل معه يدويًا...'
                    : 'اكتب سبب فرق استلام الشفت'
                }
                rows={4}
                style={textareaStyle}
              />
            </label>

            <label style={fieldStyle}>
              <span>كلمة مرور المدير</span>

              <input
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                style={inputStyle}
                autoComplete="current-password"
              />
            </label>

            {isClosing ? (
              <div style={actionsStyle}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    void resolveVariance('approved')
                  }}
                  style={
                    variance.kind === 'shortage'
                      ? dangerButtonStyle
                      : successButtonStyle
                  }
                >
                  {saving ? 'جاري الحفظ...' : genuineButtonLabel}
                </button>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    void resolveVariance('explained')
                  }}
                  style={manualButtonStyle}
                >
                  لا يؤثر على رأس المال — سأعالج السبب يدويًا
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void resolveVariance('approved')
                }}
                style={successButtonStyle}
              >
                {saving ? 'جاري الحفظ...' : 'اعتماد مراجعة فرق الاستلام'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function InfoCard({
  title,
  value,
  valueColor,
}: {
  title: string
  value: string
  valueColor?: string
}) {
  return (
    <div style={infoCardStyle}>
      <span style={subtleStyle}>{title}</span>

      <strong
        style={{
          fontSize: '18px',

          color: valueColor || '#f8fafc',
        }}
      >
        {value}
      </strong>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',

  inset: 0,

  zIndex: 1000,

  display: 'grid',

  placeItems: 'center',

  padding: '20px',

  background: 'rgba(2, 6, 23, 0.78)',
}

const cardStyle: CSSProperties = {
  width: 'min(720px, 100%)',

  maxHeight: '92vh',

  overflow: 'auto',

  display: 'grid',

  gap: '18px',

  padding: '22px',

  borderRadius: '18px',
}

const headerStyle: CSSProperties = {
  display: 'flex',

  alignItems: 'flex-start',

  justifyContent: 'space-between',

  gap: '16px',
}

const closeButtonStyle: CSSProperties = {
  width: '38px',

  height: '38px',

  border: '1px solid rgba(255,255,255,.12)',

  borderRadius: '10px',

  background: 'rgba(255,255,255,.06)',

  color: '#f8fafc',

  cursor: 'pointer',

  fontSize: '24px',
}

const summaryGridStyle: CSSProperties = {
  display: 'grid',

  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',

  gap: '10px',
}

const infoCardStyle: CSSProperties = {
  display: 'grid',

  gap: '7px',

  padding: '14px',

  border: '1px solid rgba(255,255,255,.08)',

  borderRadius: '12px',

  background: 'rgba(15,23,42,.45)',
}

const subtleStyle: CSSProperties = {
  color: '#94a3b8',

  fontSize: '12px',

  fontWeight: 700,
}

const infoBoxStyle: CSSProperties = {
  padding: '14px',

  border: '1px solid rgba(96,165,250,.25)',

  borderRadius: '12px',

  background: 'rgba(30,64,175,.10)',

  color: '#bfdbfe',

  lineHeight: 1.8,

  fontSize: '13px',
}

const resolvedBoxStyle: CSSProperties = {
  display: 'grid',

  gap: '12px',

  padding: '16px',

  border: '1px solid rgba(52,211,153,.25)',

  borderRadius: '12px',

  background: 'rgba(6,78,59,.12)',

  color: '#d1fae5',
}

const resolvedRowStyle: CSSProperties = {
  display: 'flex',

  justifyContent: 'space-between',

  gap: '16px',

  flexWrap: 'wrap',
}

const fieldStyle: CSSProperties = {
  display: 'grid',

  gap: '7px',

  color: '#e2e8f0',

  fontSize: '13px',

  fontWeight: 800,
}

const inputStyle: CSSProperties = {
  width: '100%',

  boxSizing: 'border-box',

  padding: '11px 12px',

  border: '1px solid rgba(255,255,255,.10)',

  borderRadius: '10px',

  background: 'rgba(15,23,42,.70)',

  color: '#f8fafc',

  outline: 'none',
}

const textareaStyle: CSSProperties = {
  ...inputStyle,

  resize: 'vertical',

  minHeight: '95px',

  fontFamily: 'inherit',
}

const actionsStyle: CSSProperties = {
  display: 'grid',

  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',

  gap: '10px',
}

const baseButtonStyle: CSSProperties = {
  minHeight: '46px',

  border: 0,

  borderRadius: '11px',

  padding: '10px 14px',

  color: '#fff',

  cursor: 'pointer',

  fontWeight: 900,

  fontFamily: 'inherit',
}

const dangerButtonStyle: CSSProperties = {
  ...baseButtonStyle,

  background: '#b91c1c',
}

const successButtonStyle: CSSProperties = {
  ...baseButtonStyle,

  background: '#047857',
}

const manualButtonStyle: CSSProperties = {
  ...baseButtonStyle,

  background: '#334155',
}

const messageStyle: CSSProperties = {
  padding: '11px 13px',

  border: '1px solid',

  borderRadius: '10px',

  background: 'rgba(15,23,42,.55)',

  fontWeight: 800,
}
