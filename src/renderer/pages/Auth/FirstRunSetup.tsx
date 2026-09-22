import { useState } from 'react'

import { useNavigate } from 'react-router-dom'

import { useAuthStore } from '../../store/auth.store'

import { getPasswordPolicyError } from '../../../shared/password-policy'

type Props = {
  appName: string
  appLogoUrl: string
  appTheme: 'dark' | 'light'
}

export default function FirstRunSetup({
  appName,
  appLogoUrl,
  appTheme,
}: Props) {
  const navigate = useNavigate()

  const login = useAuthStore((state) => state.login)

  const [name, setName] = useState('')

  const [username, setUsername] = useState('admin')

  const [password, setPassword] = useState('')

  const [confirmPassword, setConfirmPassword] = useState('')

  const [error, setError] = useState('')

  const [loading, setLoading] = useState(false)

  const isLight = appTheme === 'light'

  async function submit() {
    if (loading) {
      return
    }

    setError('')

    if (!name.trim()) {
      setError('اكتب اسم مدير النظام')
      return
    }

    if (!username.trim()) {
      setError('اكتب اسم الدخول')
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

    setLoading(true)

    try {
      const result = await window.api.bootstrapInitialAdmin({
        name: name.trim(),

        username: username.trim(),

        password,
      })

      if (!result.success || !result.user) {
        setError(result.message || 'تعذر إنشاء حساب المدير')
        return
      }

      login(result.user)

      navigate('/dashboard', {
        replace: true,
      })
    } catch (error) {
      console.error('Bootstrap admin failed:', error)

      setError('تعذر إنشاء حساب المدير')
    } finally {
      setLoading(false)
    }
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

          maxWidth: '560px',

          padding: '34px',

          borderRadius: '28px',

          background: isLight ? '#fff' : '#111827',

          border: isLight
            ? '1px solid rgba(15,23,42,0.10)'
            : '1px solid rgba(255,255,255,0.08)',

          boxShadow: '0 24px 70px rgba(0,0,0,0.25)',
        }}
      >
        <div
          style={{
            display: 'flex',

            alignItems: 'center',

            gap: '16px',

            marginBottom: '24px',
          }}
        >
          <div
            style={{
              width: '72px',
              height: '72px',

              borderRadius: '18px',

              overflow: 'hidden',

              display: 'grid',

              placeItems: 'center',

              background: 'linear-gradient(135deg,#2563eb,#8b5cf6)',

              fontSize: '28px',
            }}
          >
            {appLogoUrl ? (
              <img
                src={appLogoUrl}
                alt=""
                style={{
                  width: '100%',

                  height: '100%',

                  objectFit: 'cover',
                }}
              />
            ) : (
              '👕'
            )}
          </div>

          <div>
            <div
              style={{
                fontWeight: 900,

                fontSize: '13px',

                color: '#60a5fa',
              }}
            >
              الإعداد الأول
            </div>

            <h1
              style={{
                margin: '5px 0 0',

                fontSize: '25px',
              }}
            >
              {appName}
            </h1>
          </div>
        </div>

        <h2>إنشاء مدير النظام</h2>

        <p
          style={{
            opacity: 0.72,

            lineHeight: 1.8,
          }}
        >
          لا يوجد حساب افتراضي. أنشئ حساب المدير الرئيسي الذي سيملك صلاحيات
          إدارة النظام.
        </p>

        <div
          style={{
            display: 'grid',

            gap: '14px',

            marginTop: '24px',
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="اسم المدير"
            style={inputStyle}
          />

          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="اسم الدخول"
            style={inputStyle}
          />

          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="كلمة المرور"
            style={inputStyle}
          />

          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="تأكيد كلمة المرور"
            style={inputStyle}
          />

          <div
            style={{
              fontSize: '13px',

              opacity: 0.72,

              lineHeight: 1.7,
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
            disabled={loading}
            onClick={() => void submit()}
            style={{
              height: '52px',

              border: 'none',

              borderRadius: '14px',

              background: 'linear-gradient(135deg,#2563eb,#7c3aed)',

              color: '#fff',

              fontWeight: 900,

              cursor: loading ? 'not-allowed' : 'pointer',

              opacity: loading ? 0.65 : 1,
            }}
          >
            {loading ? 'جاري الإنشاء...' : 'إنشاء حساب المدير'}
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

  boxSizing: 'border-box',

  outline: 'none',
}
