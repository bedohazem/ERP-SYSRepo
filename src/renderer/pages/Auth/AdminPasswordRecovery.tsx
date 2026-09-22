import { useEffect, useState } from 'react'

import { getPasswordPolicyError } from '../../../shared/password-policy'

type Props = {
  appTheme: 'dark' | 'light'

  onClose: (recoveredUsername?: string) => void
}

type RecoveryRequest = {
  device_code: string
  request_id: string
  expires_at: string
}

export default function AdminPasswordRecovery({ appTheme, onClose }: Props) {
  const [request, setRequest] = useState<RecoveryRequest | null>(null)

  const [username, setUsername] = useState('')

  const [recoveryCode, setRecoveryCode] = useState('')

  const [password, setPassword] = useState('')

  const [confirmPassword, setConfirmPassword] = useState('')

  const [requestLoading, setRequestLoading] = useState(true)

  const [saving, setSaving] = useState(false)

  const [error, setError] = useState('')

  const [success, setSuccess] = useState(false)

  const isLight = appTheme === 'light'

  async function createRequest() {
    if (requestLoading) {
      return
    }

    setError('')
    setRequestLoading(true)

    try {
      const result = await window.api.requestAdminPasswordRecovery()

      if (
        !result.success ||
        !result.device_code ||
        !result.request_id ||
        !result.expires_at
      ) {
        setError(result.message || 'تعذر إنشاء طلب الاسترجاع')

        return
      }

      setRequest({
        device_code: result.device_code,

        request_id: result.request_id,

        expires_at: result.expires_at,
      })

      setRecoveryCode('')
    } catch (error) {
      console.error('Recovery request failed:', error)

      setError('تعذر إنشاء طلب الاسترجاع')
    } finally {
      setRequestLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    async function load() {
      setRequestLoading(true)

      try {
        const result = await window.api.requestAdminPasswordRecovery()

        if (!active) {
          return
        }

        if (
          !result.success ||
          !result.device_code ||
          !result.request_id ||
          !result.expires_at
        ) {
          setError(result.message || 'تعذر إنشاء طلب الاسترجاع')

          return
        }

        setRequest({
          device_code: result.device_code,

          request_id: result.request_id,

          expires_at: result.expires_at,
        })
      } catch (error) {
        console.error('Recovery request failed:', error)

        if (active) {
          setError('تعذر إنشاء طلب الاسترجاع')
        }
      } finally {
        if (active) {
          setRequestLoading(false)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [])

  async function copySupportData() {
    if (!request) {
      return
    }

    const cleanUsername = username.trim()

    if (!cleanUsername) {
      setError('اكتب اسم دخول المدير أولًا ثم انسخ بيانات الاسترجاع')

      return
    }

    const text = [
      'ERP Admin Password Recovery',
      '',
      `Device Code: ${request.device_code}`,
      `Request ID: ${request.request_id}`,
      `Admin Username: ${cleanUsername}`,
    ].join('\n')

    try {
      await navigator.clipboard.writeText(text)

      setError('')
    } catch {
      setError('تعذر نسخ البيانات. انسخ القيم يدويًا.')
    }
  }

  async function submit() {
    if (saving || !request) {
      return
    }

    setError('')

    const cleanUsername = username.trim()

    if (!cleanUsername) {
      setError('اكتب اسم دخول المدير')

      return
    }

    if (!recoveryCode.trim()) {
      setError('اكتب Recovery Code المرسل من الدعم')

      return
    }

    const passwordError = getPasswordPolicyError(password)

    if (passwordError) {
      setError(passwordError)

      return
    }

    if (password !== confirmPassword) {
      setError('كلمة المرور وتأكيدها غير متطابقين')

      return
    }

    setSaving(true)

    try {
      const result = await window.api.recoverAdminPassword({
        request_id: request.request_id,

        username: cleanUsername,

        recovery_code: recoveryCode.trim(),

        new_password: password,
      })

      if (!result.success) {
        setError(result.message || 'تعذر استرجاع الحساب')

        return
      }

      setSuccess(true)
    } catch (error) {
      console.error('Admin recovery failed:', error)

      setError('تعذر استرجاع الحساب')
    } finally {
      setSaving(false)
    }
  }

  if (success) {
    return (
      <div
        style={{
          minHeight: '100vh',

          display: 'grid',

          placeItems: 'center',

          padding: '28px',

          background: isLight ? '#eef2ff' : '#08152f',

          color: isLight ? '#0f172a' : '#f8fafc',
        }}
      >
        <div
          style={{
            width: '100%',

            maxWidth: '520px',

            padding: '34px',

            borderRadius: '26px',

            background: isLight ? '#fff' : '#111827',

            textAlign: 'center',

            boxShadow: '0 24px 70px rgba(0,0,0,0.25)',
          }}
        >
          <div
            style={{
              fontSize: '54px',
            }}
          >
            ✅
          </div>

          <h2>تم استرجاع الحساب</h2>

          <p
            style={{
              opacity: 0.75,

              lineHeight: 1.8,
            }}
          >
            تم تغيير كلمة مرور المدير بنجاح. استخدم كلمة المرور الجديدة لتسجيل
            الدخول.
          </p>

          <button
            type="button"
            onClick={() => onClose(username.trim())}
            style={primaryButtonStyle}
          >
            العودة لتسجيل الدخول
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',

        display: 'grid',

        placeItems: 'center',

        padding: '28px',

        background: isLight ? '#eef2ff' : '#08152f',

        color: isLight ? '#0f172a' : '#f8fafc',
      }}
    >
      <div
        style={{
          width: '100%',

          maxWidth: '650px',

          padding: '32px',

          borderRadius: '28px',

          background: isLight ? '#fff' : '#111827',

          border: '1px solid rgba(148,163,184,0.18)',

          boxShadow: '0 24px 70px rgba(0,0,0,0.25)',
        }}
      >
        <div
          style={{
            fontSize: '42px',
          }}
        >
          🔑
        </div>

        <h2>استرجاع كلمة مرور المدير</h2>

        <p
          style={{
            opacity: 0.72,

            lineHeight: 1.8,
          }}
        >
          اكتب اسم دخول المدير، ثم أرسل بيانات الجهاز والطلب إلى دعم البرنامج.
          سيصلك Recovery Code صالح لفترة قصيرة ولمرة واحدة فقط.
        </p>

        {requestLoading ? (
          <div>جاري إنشاء طلب الاسترجاع...</div>
        ) : request ? (
          <div
            style={{
              display: 'grid',

              gap: '10px',

              padding: '16px',

              borderRadius: '16px',

              background: 'rgba(37,99,235,0.10)',

              border: '1px solid rgba(37,99,235,0.25)',

              marginBottom: '18px',
            }}
          >
            <div>
              <strong>Device Code</strong>

              <div
                dir="ltr"
                style={{
                  marginTop: '4px',

                  fontFamily: 'monospace',

                  fontSize: '18px',
                }}
              >
                {request.device_code}
              </div>
            </div>

            <div>
              <strong>Request ID</strong>

              <div
                dir="ltr"
                style={{
                  marginTop: '4px',

                  fontFamily: 'monospace',

                  fontSize: '18px',
                }}
              >
                {request.request_id}
              </div>
            </div>

            <div
              style={{
                opacity: 0.72,

                fontSize: '13px',
              }}
            >
              ينتهي الطلب:{' '}
              {new Date(request.expires_at).toLocaleString('ar-EG')}
            </div>
          </div>
        ) : null}

        <div
          style={{
            display: 'grid',

            gap: '13px',
          }}
        >
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="اسم دخول المدير"
            style={inputStyle}
          />

          <button
            type="button"
            disabled={!request || requestLoading}
            onClick={() => void copySupportData()}
            style={secondaryButtonStyle}
          >
            نسخ بيانات الاسترجاع لإرسالها للدعم
          </button>

          <textarea
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
            placeholder="الصق Recovery Code هنا"
            rows={4}
            style={{
              ...inputStyle,

              height: '110px',

              padding: '12px',

              resize: 'vertical',

              fontFamily: 'monospace',

              direction: 'ltr',
            }}
          />

          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="كلمة المرور الجديدة"
            style={inputStyle}
          />

          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="تأكيد كلمة المرور الجديدة"
            style={inputStyle}
          />

          <div
            style={{
              opacity: 0.7,

              fontSize: '13px',
            }}
          >
            8 أحرف على الأقل، وتحتوي على حرف ورقم.
          </div>

          {error && (
            <div
              style={{
                padding: '12px',

                borderRadius: '12px',

                background: 'rgba(239,68,68,0.12)',

                color: '#f87171',

                fontWeight: 800,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={saving || !request}
            onClick={() => void submit()}
            style={primaryButtonStyle}
          >
            {saving ? 'جاري التحقق...' : 'تغيير كلمة المرور'}
          </button>

          <button
            type="button"
            disabled={requestLoading}
            onClick={() => void createRequest()}
            style={secondaryButtonStyle}
          >
            إنشاء Request ID جديد
          </button>

          <button
            type="button"
            onClick={() => onClose()}
            style={{
              ...secondaryButtonStyle,

              color: '#94a3b8',
            }}
          >
            رجوع لتسجيل الدخول
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',

  height: '50px',

  borderRadius: '13px',

  border: '1px solid rgba(148,163,184,0.25)',

  background: 'rgba(148,163,184,0.08)',

  color: 'inherit',

  padding: '0 14px',

  outline: 'none',

  boxSizing: 'border-box',
}

const primaryButtonStyle: React.CSSProperties = {
  height: '50px',

  border: 'none',

  borderRadius: '13px',

  background: 'linear-gradient(135deg,#2563eb,#7c3aed)',

  color: '#fff',

  fontWeight: 900,

  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: '46px',

  borderRadius: '13px',

  border: '1px solid rgba(148,163,184,0.24)',

  background: 'rgba(148,163,184,0.08)',

  color: 'inherit',

  fontWeight: 800,

  cursor: 'pointer',

  padding: '8px 14px',
}
