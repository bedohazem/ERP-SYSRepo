type FinancialCancelModalProps = {
  open: boolean
  title: string
  description?: string
  reason: string
  password?: string
  requirePassword?: boolean
  loading?: boolean
  onReasonChange: (value: string) => void
  onPasswordChange?: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}

export default function FinancialCancelModal({
  open,
  title,
  description,
  reason,
  password = '',
  requirePassword = true,
  loading = false,
  onReasonChange,
  onPasswordChange,
  onClose,
  onConfirm,
}: FinancialCancelModalProps) {
  if (!open) return null

  const disabled =
    loading || !reason.trim() || (requirePassword && !password.trim())

  return (
    <div
      className="theme-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999999,
        display: 'grid',
        placeItems: 'center',
        padding: '20px',
        background: 'rgba(2,6,23,0.72)',
      }}
    >
      <div
        className="theme-modal-card"
        style={{
          width: 'min(480px, calc(100vw - 40px))',
          maxHeight: 'calc(100vh - 40px)',
          overflowY: 'auto',
          padding: '22px',
          borderRadius: '18px',
          display: 'grid',
          gap: '16px',
          direction: 'rtl',
          position: 'relative',
          zIndex: 1,

          background: '#111827',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 28px 80px rgba(0,0,0,0.65)',
          color: '#f8fafc',
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              color: '#f87171',
            }}
          >
            {title}
          </h3>

          {description && (
            <p
              style={{
                margin: '8px 0 0',
                color: '#94a3b8',
                lineHeight: 1.8,
              }}
            >
              {description}
            </p>
          )}
        </div>

        <div>
          <label
            style={{
              display: 'block',
              marginBottom: '7px',
              fontWeight: 800,
            }}
          >
            سبب الإلغاء
          </label>

          <textarea
            autoFocus
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="اكتب سبب الإلغاء"
            style={{
              width: '100%',
              minHeight: '80px',
              resize: 'vertical',
              borderRadius: '10px',
              border: '1px solid rgba(148,163,184,0.25)',
              background: 'rgba(255,255,255,0.05)',
              color: 'inherit',
              padding: '10px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {requirePassword && (
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '7px',
                fontWeight: 800,
              }}
            >
              كلمة مرور المدير
            </label>

            <input
              type="password"
              value={password}
              onChange={(e) => onPasswordChange?.(e.target.value)}
              placeholder="كلمة مرور المدير"
              style={{
                width: '100%',
                height: '44px',
                borderRadius: '10px',
                border: '1px solid rgba(148,163,184,0.25)',
                background: 'rgba(255,255,255,0.05)',
                color: 'inherit',
                padding: '0 12px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        <div
          style={{
            padding: '10px 12px',
            borderRadius: '10px',
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.20)',
            color: '#fca5a5',
            fontSize: '12px',
            fontWeight: 800,
          }}
        >
          العملية لن تُحذف من السجل، ولكن سيتم إلغاؤها محاسبيًا وتسجيل من قام
          بالإلغاء.
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              height: '42px',
              padding: '0 16px',
              borderRadius: '10px',
              border: '1px solid rgba(148,163,184,0.25)',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontWeight: 800,
            }}
          >
            رجوع
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={disabled}
            style={{
              height: '42px',
              padding: '0 18px',
              borderRadius: '10px',
              border: 'none',
              background: '#dc2626',
              color: '#fff',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.55 : 1,
              fontWeight: 900,
            }}
          >
            {loading ? 'جاري الإلغاء...' : 'تأكيد الإلغاء'}
          </button>
        </div>
      </div>
    </div>
  )
}
