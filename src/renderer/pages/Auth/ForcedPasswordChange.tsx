import { useState } from 'react'

import { useNavigate } from 'react-router-dom'

import { useAuthStore } from '../../store/auth.store'

import { getPasswordPolicyError } from '../../../shared/password-policy'

type Props = {
  user: {
    id: number
    name: string
    username: string
    role: string
  }

  appTheme: 'dark' | 'light'
}

export default function ForcedPasswordChange({ user, appTheme }: Props) {
  const navigate = useNavigate()

  const login = useAuthStore((state) => state.login)

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

    const policyError = getPasswordPolicyError(password)

    if (policyError) {
      setError(policyError)
      return
    }

    if (password !== confirmPassword) {
      setError('كلمة المرور وتأكيدها غير متطابقين')
      return
    }

    setLoading(true)

    try {
      const result = await window.api.changeOwnPassword({
        password,
      })

      if (!result.success || !result.user) {
        setError(result.message || 'تعذر تغيير كلمة المرور')
        return
      }

      login(result.user)

      navigate('/dashboard', {
        replace: true,
      })
    } catch (error) {
      console.error('Password change failed:', error)

      setError('تعذر تغيير كلمة المرور')
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

          maxWidth: '500px',

          padding: '34px',

          borderRadius: '26px',

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
          🔐
        </div>

        <h2>تغيير كلمة المرور مطلوب</h2>

        <p
          style={{
            opacity: 0.72,

            lineHeight: 1.8,
          }}
        >
          أهلاً {user.name}. كلمة المرور الحالية قديمة أو مؤقتة. أنشئ كلمة مرور
          قوية قبل دخول النظام.
        </p>

        <div
          style={{
            display: 'grid',

            gap: '14px',

            marginTop: '22px',
          }}
        >
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
            placeholder="تأكيد كلمة المرور"
            style={inputStyle}
          />

          <div
            style={{
              fontSize: '13px',

              opacity: 0.72,
            }}
          >
            8 أحرف على الأقل + حرف + رقم
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

              cursor: 'pointer',
            }}
          >
            {loading ? 'جاري الحفظ...' : 'حفظ كلمة المرور والدخول'}
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
