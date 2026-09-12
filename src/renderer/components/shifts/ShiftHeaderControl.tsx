import { useEffect, useMemo, useState } from 'react'

type ShiftUser = {
  id: number
  name: string
  role: string
}

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
}

type ClosingPreview = {
  shift_id: number
  opening_counted_amount: number
  cash_in: number
  cash_out: number
  expected_closing_amount: number

  breakdown: Array<{
    type: string
    direction: 'in' | 'out'
    total: number
  }>
}

type OpeningPreview = {
  can_open: boolean
  open_shift: CashShift | null
  previous_shift_id: number | null
  expected_opening_amount: number | null
  previous_closed_at?: string | null
}

type Props = {
  user: ShiftUser | null
  isLight: boolean
  isMobile: boolean
}

function money(value?: number | null) {
  return `${Number(value || 0).toFixed(2)} ج.م`
}

function formatShiftTime(value?: string | null) {
  if (!value) {
    return ''
  }

  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`

  const date = new Date(normalized)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ShiftHeaderControl({ user, isLight, isMobile }: Props) {
  const [openShift, setOpenShift] = useState<CashShift | null>(null)

  const [modal, setModal] = useState<'open' | 'close' | null>(null)

  const [openingPreview, setOpeningPreview] = useState<OpeningPreview | null>(
    null,
  )

  const [closingPreview, setClosingPreview] = useState<ClosingPreview | null>(
    null,
  )

  const [openingAmount, setOpeningAmount] = useState('')

  const [closingAmount, setClosingAmount] = useState('')

  const [leftForNextShift, setLeftForNextShift] = useState('')

  const [closeReason, setCloseReason] = useState('')

  const [adminPassword, setAdminPassword] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function refreshShift() {
    try {
      const shift = await window.api.getOpenCashShift()

      setOpenShift(shift || null)
    } catch (err) {
      console.error('Failed to load open cash shift:', err)
    }
  }

  useEffect(() => {
    if (!user?.id) {
      setOpenShift(null)
      return
    }

    void refreshShift()
  }, [user?.id])

  const canCloseShift = useMemo(() => {
    if (!openShift || !user) {
      return false
    }

    return (
      user.role === 'admin' || Number(openShift.opened_by) === Number(user.id)
    )
  }, [openShift, user])

  const adminClosingOtherShift = Boolean(
    openShift &&
    user?.role === 'admin' &&
    Number(openShift.opened_by) !== Number(user.id),
  )

  const closingDifference =
    closingPreview &&
    closingAmount.trim() !== '' &&
    Number.isFinite(Number(closingAmount))
      ? Number(closingAmount) - Number(closingPreview.expected_closing_amount)
      : null

  const safeTransferAmount =
    closingAmount.trim() !== '' &&
    leftForNextShift.trim() !== '' &&
    Number.isFinite(Number(closingAmount)) &&
    Number.isFinite(Number(leftForNextShift))
      ? Number(closingAmount) - Number(leftForNextShift)
      : null

  async function openOpeningModal() {
    setBusy(true)
    setError('')

    try {
      const preview = await window.api.getCashShiftOpeningPreview()

      if (!preview.can_open) {
        setOpenShift(preview.open_shift || null)

        return
      }

      setOpeningPreview(preview)
      setOpeningAmount('')
      setModal('open')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'تعذر تحميل بيانات فتح الشفت',
      )
    } finally {
      setBusy(false)
    }
  }

  async function openClosingModal() {
    if (!openShift) {
      return
    }

    setBusy(true)
    setError('')

    try {
      const preview = await window.api.getCashShiftExpectedBalance(openShift.id)

      setClosingPreview(preview)

      setClosingAmount('')
      setLeftForNextShift('')
      setCloseReason('')
      setAdminPassword('')

      setModal('close')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'تعذر تحميل بيانات إغلاق الشفت',
      )
    } finally {
      setBusy(false)
    }
  }

  async function submitOpenShift() {
    const amount = Number(openingAmount)

    if (openingAmount.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      setError('اكتب المبلغ الموجود فعليًا في الدرج')

      return
    }

    setBusy(true)
    setError('')

    try {
      const shift = await window.api.openCashShift({
        opening_counted_amount: amount,
      })

      setOpenShift(shift)
      setModal(null)

      window.dispatchEvent(
        new CustomEvent('cash-shift-changed', {
          detail: shift,
        }),
      )

      if (Math.abs(Number(shift?.opening_difference || 0)) > 0.01) {
        const difference = Number(shift.opening_difference)

        window.alert(
          difference < 0
            ? `تم فتح الشفت ويوجد عجز استلام ${money(Math.abs(difference))}`
            : `تم فتح الشفت ويوجد زيادة استلام ${money(difference)}`,
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر فتح الشفت')
    } finally {
      setBusy(false)
    }
  }

  async function submitCloseShift() {
    if (!openShift || !closingPreview) {
      return
    }

    const counted = Number(closingAmount)

    const leftAmount = Number(leftForNextShift)

    if (
      closingAmount.trim() === '' ||
      !Number.isFinite(counted) ||
      counted < 0
    ) {
      setError('اكتب المبلغ الفعلي بعد عد الدرج')

      return
    }

    if (
      leftForNextShift.trim() === '' ||
      !Number.isFinite(leftAmount) ||
      leftAmount < 0
    ) {
      setError('اكتب المبلغ المتروك للشفت التالي')

      return
    }

    if (leftAmount > counted) {
      setError('المبلغ المتروك أكبر من الموجود في الدرج')

      return
    }

    if (adminClosingOtherShift && !closeReason.trim()) {
      setError('اكتب سبب إغلاق المدير للشفت')

      return
    }

    if (adminClosingOtherShift && !adminPassword.trim()) {
      setError('اكتب كلمة مرور المدير')

      return
    }

    setBusy(true)
    setError('')

    try {
      const closedShift = await window.api.closeCashShift({
        shift_id: openShift.id,

        closing_counted_amount: counted,

        left_for_next_shift: leftAmount,

        close_reason: closeReason.trim() || null,
        admin_password: adminClosingOtherShift ? adminPassword : undefined,
      })

      setOpenShift(null)
      setModal(null)

      window.dispatchEvent(
        new CustomEvent('cash-shift-changed', {
          detail: null,
        }),
      )

      const difference = Number(closedShift?.closing_difference || 0)

      if (Math.abs(difference) <= 0.01) {
        window.alert('تم إغلاق الشفت بنجاح والجرد مطابق')
      } else if (difference < 0) {
        window.alert(
          `تم إغلاق الشفت وتسجيل عجز ${money(
            Math.abs(difference),
          )} قيد المراجعة`,
        )
      } else {
        window.alert(
          `تم إغلاق الشفت وتسجيل زيادة ${money(difference)} قيد المراجعة`,
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إغلاق الشفت')
    } finally {
      setBusy(false)
    }
  }

  const panelBackground = isLight ? '#ffffff' : '#111827'

  const textColor = isLight ? '#0f172a' : '#f8fafc'

  const mutedColor = isLight ? '#64748b' : '#94a3b8'

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: '46px',
    boxSizing: 'border-box',
    borderRadius: '12px',
    border: isLight ? '1px solid #cbd5e1' : '1px solid #334155',
    background: isLight ? '#f8fafc' : '#0f172a',
    color: textColor,
    padding: '0 12px',
    fontSize: '16px',
    outline: 'none',
  }

  const secondaryButtonStyle: React.CSSProperties = {
    minHeight: '42px',
    padding: '0 16px',
    borderRadius: '12px',
    border: isLight ? '1px solid #cbd5e1' : '1px solid #475569',
    background: 'transparent',
    color: textColor,
    fontWeight: 800,
    cursor: 'pointer',
  }

  const primaryButtonStyle: React.CSSProperties = {
    minHeight: '42px',
    padding: '0 18px',
    borderRadius: '12px',
    border: 'none',
    background: '#2563eb',
    color: '#ffffff',
    fontWeight: 900,
    cursor: 'pointer',
  }

  return (
    <>
      <div
        style={{
          minHeight: '42px',
          display: 'flex',
          alignItems: 'center',
          gap: '9px',
          padding: isMobile ? '6px 8px' : '6px 10px',
          borderRadius: '12px',
          background: openShift
            ? 'rgba(34,197,94,0.10)'
            : 'rgba(239,68,68,0.10)',
          border: openShift
            ? '1px solid rgba(34,197,94,0.30)'
            : '1px solid rgba(239,68,68,0.30)',
          whiteSpace: 'nowrap',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 900,
              color: openShift
                ? isLight
                  ? '#15803d'
                  : '#86efac'
                : isLight
                  ? '#b91c1c'
                  : '#fca5a5',
            }}
          >
            {openShift
              ? `🟢 شفت #${openShift.id} مفتوح`
              : '🔴 لا يوجد شفت مفتوح'}
          </div>

          {openShift && !isMobile && (
            <div
              style={{
                marginTop: '2px',
                fontSize: '11px',
                color: mutedColor,
              }}
            >
              {openShift.opened_by_name || 'مستخدم'} •{' '}
              {formatShiftTime(openShift.opened_at)}
            </div>
          )}
        </div>

        {!openShift ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void openOpeningModal()}
            style={{
              ...primaryButtonStyle,
              minHeight: '34px',
              padding: '0 12px',
            }}
          >
            فتح شفت
          </button>
        ) : canCloseShift ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void openClosingModal()}
            style={{
              ...primaryButtonStyle,
              minHeight: '34px',
              padding: '0 12px',
              background: '#dc2626',
            }}
          >
            إغلاق الشفت
          </button>
        ) : (
          <span
            style={{
              fontSize: '11px',
              color: mutedColor,
            }}
          >
            الشفت تابع لـ {openShift.opened_by_name || 'مستخدم آخر'}
          </span>
        )}
      </div>

      {modal === 'open' && (
        <div
          className="theme-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10050,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '18px',
          }}
        >
          <div
            className="theme-modal-card"
            dir="rtl"
            style={{
              width: 'min(520px, 100%)',
              borderRadius: '20px',
              padding: '22px',
              background: panelBackground,
              color: textColor,
              boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '21px',
                  }}
                >
                  فتح شفت جديد
                </h3>

                <div
                  style={{
                    marginTop: '5px',
                    color: mutedColor,
                    fontSize: '13px',
                  }}
                >
                  عد الفلوس الموجودة في الدرج فعليًا
                </div>
              </div>

              <button
                type="button"
                data-escape-close="true"
                onClick={() => {
                  setModal(null)
                  setError('')
                }}
                style={{
                  ...secondaryButtonStyle,
                  minWidth: '42px',
                  padding: 0,
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                marginTop: '22px',
                padding: '14px',
                borderRadius: '14px',
                background: isLight ? '#f8fafc' : '#0f172a',
              }}
            >
              {openingPreview?.expected_opening_amount === null ? (
                <div
                  style={{
                    color: mutedColor,
                  }}
                >
                  أول شفت بالنظام — لا يوجد مبلغ تسليم سابق
                </div>
              ) : (
                <>
                  <div
                    style={{
                      color: mutedColor,
                      fontSize: '13px',
                    }}
                  >
                    المبلغ المسلم من الشفت السابق
                  </div>

                  <strong
                    style={{
                      display: 'block',
                      marginTop: '5px',
                      fontSize: '20px',
                    }}
                  >
                    {money(openingPreview?.expected_opening_amount)}
                  </strong>
                </>
              )}
            </div>

            <label
              style={{
                display: 'block',
                marginTop: '18px',
                fontWeight: 800,
              }}
            >
              المبلغ الموجود فعليًا في الدرج
            </label>

            <input
              autoFocus
              type="number"
              min="0"
              step="0.01"
              value={openingAmount}
              onChange={(event) => setOpeningAmount(event.target.value)}
              style={{
                ...inputStyle,
                marginTop: '8px',
              }}
            />

            {openingPreview?.expected_opening_amount !== null &&
              openingAmount.trim() !== '' &&
              Number.isFinite(Number(openingAmount)) && (
                <div
                  style={{
                    marginTop: '12px',
                    fontWeight: 800,
                  }}
                >
                  فرق الاستلام:{' '}
                  {money(
                    Number(openingAmount) -
                      Number(openingPreview?.expected_opening_amount || 0),
                  )}
                </div>
              )}

            {error && (
              <div
                style={{
                  marginTop: '14px',
                  color: '#ef4444',
                  fontWeight: 800,
                }}
              >
                {error}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                marginTop: '22px',
              }}
            >
              <button
                type="button"
                onClick={() => setModal(null)}
                style={secondaryButtonStyle}
              >
                إلغاء
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void submitOpenShift()}
                style={primaryButtonStyle}
              >
                {busy ? 'جاري الفتح...' : 'فتح الشفت'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'close' && openShift && closingPreview && (
        <div
          className="theme-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10050,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '18px',
          }}
        >
          <div
            className="theme-modal-card"
            dir="rtl"
            style={{
              width: 'min(580px, 100%)',
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: '20px',
              padding: '22px',
              background: panelBackground,
              color: textColor,
              boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '21px',
                  }}
                >
                  إغلاق الشفت #{openShift.id}
                </h3>

                <div
                  style={{
                    marginTop: '5px',
                    color: mutedColor,
                    fontSize: '13px',
                  }}
                >
                  {openShift.opened_by_name}
                </div>
              </div>

              <button
                type="button"
                data-escape-close="true"
                onClick={() => {
                  setModal(null)
                  setError('')
                }}
                style={{
                  ...secondaryButtonStyle,
                  minWidth: '42px',
                  padding: 0,
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                marginTop: '20px',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '10px',
              }}
            >
              <SummaryBox
                label="افتتاح الشفت"
                value={money(closingPreview.opening_counted_amount)}
                isLight={isLight}
              />

              <SummaryBox
                label="دخول كاش"
                value={money(closingPreview.cash_in)}
                isLight={isLight}
              />

              <SummaryBox
                label="خروج كاش"
                value={money(closingPreview.cash_out)}
                isLight={isLight}
              />
            </div>

            <div
              style={{
                marginTop: '12px',
                padding: '15px',
                borderRadius: '14px',
                background: isLight ? '#eff6ff' : '#172554',
              }}
            >
              <div
                style={{
                  fontSize: '13px',
                  color: mutedColor,
                }}
              >
                المفروض في الدرج
              </div>

              <strong
                style={{
                  display: 'block',
                  marginTop: '4px',
                  fontSize: '24px',
                }}
              >
                {money(closingPreview.expected_closing_amount)}
              </strong>
            </div>

            <label
              style={{
                display: 'block',
                marginTop: '18px',
                fontWeight: 800,
              }}
            >
              المبلغ الفعلي بعد العد
            </label>

            <input
              autoFocus
              type="number"
              min="0"
              step="0.01"
              value={closingAmount}
              onChange={(event) => setClosingAmount(event.target.value)}
              style={{
                ...inputStyle,
                marginTop: '8px',
              }}
            />

            {closingDifference !== null && (
              <div
                style={{
                  marginTop: '10px',
                  fontWeight: 900,
                  color:
                    Math.abs(closingDifference) <= 0.01
                      ? '#22c55e'
                      : closingDifference < 0
                        ? '#ef4444'
                        : '#f59e0b',
                }}
              >
                {Math.abs(closingDifference) <= 0.01
                  ? 'الجرد مطابق'
                  : closingDifference < 0
                    ? `عجز ${money(Math.abs(closingDifference))}`
                    : `زيادة ${money(closingDifference)}`}
              </div>
            )}

            <label
              style={{
                display: 'block',
                marginTop: '18px',
                fontWeight: 800,
              }}
            >
              المبلغ المتروك للشفت التالي
            </label>

            <input
              type="number"
              min="0"
              step="0.01"
              value={leftForNextShift}
              onChange={(event) => setLeftForNextShift(event.target.value)}
              style={{
                ...inputStyle,
                marginTop: '8px',
              }}
            />

            {safeTransferAmount !== null && safeTransferAmount >= 0 && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '14px',
                  borderRadius: '14px',
                  background: isLight ? '#f0fdf4' : '#052e16',
                }}
              >
                سيتم توريد <strong>{money(safeTransferAmount)}</strong> إلى
                الخزنة الآمنة
              </div>
            )}

            {adminClosingOtherShift && (
              <>
                <label
                  style={{
                    display: 'block',
                    marginTop: '18px',
                    fontWeight: 800,
                  }}
                >
                  سبب إغلاق المدير للشفت
                </label>

                <textarea
                  value={closeReason}
                  onChange={(event) => setCloseReason(event.target.value)}
                  rows={3}
                  style={{
                    ...inputStyle,
                    height: 'auto',
                    resize: 'vertical',
                    paddingTop: '10px',
                    marginTop: '8px',
                  }}
                />
                <label
                  style={{
                    display: 'block',
                    marginTop: '18px',
                    fontWeight: 800,
                  }}
                >
                  كلمة مرور المدير
                </label>

                <input
                  type="password"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  autoComplete="current-password"
                  style={{
                    ...inputStyle,
                    marginTop: '8px',
                  }}
                />
              </>
            )}

            {error && (
              <div
                style={{
                  marginTop: '14px',
                  color: '#ef4444',
                  fontWeight: 800,
                }}
              >
                {error}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                marginTop: '22px',
              }}
            >
              <button
                type="button"
                onClick={() => setModal(null)}
                style={secondaryButtonStyle}
              >
                إلغاء
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void submitCloseShift()}
                style={{
                  ...primaryButtonStyle,
                  background: '#dc2626',
                }}
              >
                {busy ? 'جاري الإغلاق...' : 'تأكيد إغلاق الشفت'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function SummaryBox({
  label,
  value,
  isLight,
}: {
  label: string
  value: string
  isLight: boolean
}) {
  return (
    <div
      style={{
        padding: '12px',
        borderRadius: '13px',
        background: isLight ? '#f8fafc' : '#0f172a',
      }}
    >
      <div
        style={{
          fontSize: '12px',
          color: '#94a3b8',
        }}
      >
        {label}
      </div>

      <strong
        style={{
          display: 'block',
          marginTop: '5px',
        }}
      >
        {value}
      </strong>
    </div>
  )
}
