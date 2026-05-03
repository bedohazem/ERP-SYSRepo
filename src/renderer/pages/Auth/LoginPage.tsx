import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { useEffect, useRef } from 'react';



export default function LoginPage() {; 
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const loginStore = useAuthStore((s) => s.login);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

const usernameRef = useRef<HTMLInputElement>(null);

useEffect(() => {
  usernameRef.current?.focus();
}, []);

async function handleLogin() {
  setError('');
  setLoading(true);

  try {
    
    const res = await window.api.login({
      username,
      password
    });

    if (!res.success) {
      setError(res.message || 'فشل تسجيل الدخول');
      return;
    }

    if (res.user) {
      loginStore(res.user);
      navigate('/dashboard');
    }
  } catch (error) {
  console.error('Login error:', error);
  setError('خطأ في الاتصال بالنظام');
  }finally {
    setLoading(false);
  }
}


  return (
    <div
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '1100px',
          minHeight: '620px',
          display: 'grid',
          gridTemplateColumns: '1.05fr 0.95fr',
          background: 'rgba(17,24,39,0.85)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '32px',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)'
        }}
      >
        <div
          style={{
            padding: '42px',
            background:
              'radial-gradient(circle at top right, rgba(37,99,235,0.30), transparent 30%), radial-gradient(circle at bottom left, rgba(139,92,246,0.24), transparent 28%), linear-gradient(180deg, rgba(15,23,42,0.96), rgba(17,24,39,0.96))'
          }}
        >
          <div
            style={{
              width: '68px',
              height: '68px',
              borderRadius: '22px',
              display: 'grid',
              placeItems: 'center',
              fontSize: '30px',
              background: 'linear-gradient(135deg, #2563eb, #8b5cf6)',
              boxShadow: '0 16px 40px rgba(37,99,235,0.35)'
            }}
          >
            👕
          </div>

          <h1
            style={{
              margin: '26px 0 12px',
              fontSize: '42px',
              lineHeight: 1.15
            }}
          >
            ERP Store
          </h1>

          <p
            style={{
              margin: 0,
              color: '#cbd5e1',
              fontSize: '18px',
              lineHeight: 1.9,
              maxWidth: '500px'
            }}
          >
            نظام حديث لإدارة محل الملابس يشمل المنتجات والمخزون والمبيعات والعملاء
            والموردين والتقارير بشكل سريع وعملي.
          </p>

          <div
            style={{
              marginTop: '34px',
              display: 'grid',
              gap: '14px'
            }}
          >
            {[
              'إدارة المنتجات والمقاسات والألوان',
              'فواتير بيع سريعة وبحث بالباركود',
              'تقارير ومخزون وحركة أصناف بشكل واضح'
            ].map((item) => (
              <div
                key={item}
                style={{
                  padding: '14px 16px',
                  borderRadius: '18px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#e2e8f0'
                }}
              >
                ✨ {item}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            padding: '42px',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <div style={{ width: '100%' }}>
            <div style={{ marginBottom: '24px' }}>
              <div
                style={{
                  color: '#94a3b8',
                  fontSize: '14px',
                  marginBottom: '8px'
                }}
              >
                تسجيل الدخول
              </div>

              <h2
                style={{
                  margin: 0,
                  fontSize: '32px'
                }}
              >
                أهلاً بعودتك
              </h2>

              <p
                style={{
                  margin: '10px 0 0',
                  color: '#94a3b8',
                  lineHeight: 1.8
                }}
              >
                أدخل بياناتك للوصول إلى النظام.
              </p>
            </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
          >
            <div style={{ display: 'grid', gap: '16px' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '8px',
                    color: '#cbd5e1',
                    fontSize: '14px'
                  }}
                >
                  اسم المستخدم
                </label>

                <input
                  ref={usernameRef}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="أدخل اسم المستخدم"
                  style={inputStyle}
                />
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '8px',
                    color: '#cbd5e1',
                    fontSize: '14px'
                  }}
                >
                  كلمة المرور
                </label>

                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="أدخل كلمة المرور"
                    style={{ ...inputStyle, paddingLeft: '90px' }}
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    style={{
                      position: 'absolute',
                      left: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      height: '36px',
                      padding: '0 12px',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: 'rgba(255,255,255,0.05)',
                      color: '#fff'
                    }}
                  >
                    {showPassword ? 'إخفاء' : 'إظهار'}
                  </button>
                </div>
              </div>


              <button
                type="submit"
                onClick={handleLogin}
                disabled={loading}
                style={{
                  border: 'none',
                  height: '54px',
                  borderRadius: '16px',
                  background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '16px',
                  boxShadow: '0 14px 30px rgba(37,99,235,0.28)'
                }}
              >
                {loading ? 'جاري الدخول...' : 'دخول'}
              </button>
            </div>
          
          </form>

              {error && (
                <div
                  style={{
                    background: 'rgba(239,68,68,0.12)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    color: '#fca5a5',
                    padding: '12px',
                    borderRadius: '12px'
                  }}
                >
                  {error}
                </div>
              )}

            <div
              style={{
                marginTop: '18px',
                color: '#94a3b8',
                fontSize: '13px'
              }}
            >
              بيانات تجربة حالية:
              <span style={{ color: '#fff' }}> admin / 1234</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '54px',
  borderRadius: '16px',
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)',
  color: '#fff',
  padding: '0 16px',
  outline: 'none',
  fontSize: '15px'
};