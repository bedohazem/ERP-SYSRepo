import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { useEffect, useRef,useState } from 'react';



export default function LoginPage() {; 
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const loginStore = useAuthStore((s) => s.login);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [appLogoUrl, setAppLogoUrl] = useState('');
  const [appName, setAppName] = useState('ERP Store');
    const [appTheme, setAppTheme] = useState<'dark' | 'light'>(() =>
      document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
    );

    const isLight = appTheme === 'light';

  const usernameRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    usernameRef.current?.focus();

    void window.api.getLicenseStatus()
      .then((status) => {
        setAppLogoUrl(status.app_logo_url || '');
        setAppName(status.app_name || 'ERP Store');
        const nextTheme = status.app_theme === 'light' ? 'light' : 'dark';
        setAppTheme(nextTheme);
        document.documentElement.setAttribute('data-theme', nextTheme);
      })
      .catch(() => {
        setAppLogoUrl('');
        setAppName('ERP Store');
      });
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


    const pageBg = isLight
    ? 'radial-gradient(circle at top right, rgba(37,99,235,0.10), transparent 28%), radial-gradient(circle at bottom left, rgba(139,92,246,0.10), transparent 26%), linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)'
    : 'radial-gradient(circle at top right, rgba(37,99,235,0.18), transparent 28%), radial-gradient(circle at bottom left, rgba(139,92,246,0.18), transparent 26%)';

  const shellBg = isLight ? 'rgba(255,255,255,0.96)' : 'rgba(17,24,39,0.85)';
  const shellBorder = isLight
    ? '1px solid rgba(15,23,42,0.10)'
    : '1px solid rgba(255,255,255,0.08)';
  const shellShadow = isLight
    ? '0 24px 70px rgba(15,23,42,0.14)'
    : '0 20px 60px rgba(0,0,0,0.35)';

  const infoPanelBg = isLight
    ? 'radial-gradient(circle at top right, rgba(37,99,235,0.12), transparent 30%), radial-gradient(circle at bottom left, rgba(139,92,246,0.10), transparent 28%), linear-gradient(180deg, rgba(239,246,255,0.98), rgba(255,255,255,0.98))'
    : 'radial-gradient(circle at top right, rgba(37,99,235,0.30), transparent 30%), radial-gradient(circle at bottom left, rgba(139,92,246,0.24), transparent 28%), linear-gradient(180deg, rgba(15,23,42,0.96), rgba(17,24,39,0.96))';

  const formPanelBg = isLight
    ? 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98))'
    : 'rgba(17,24,39,0.55)';

  const titleColor = isLight ? '#0f172a' : '#f8fafc';
  const textColor = isLight ? '#334155' : '#cbd5e1';
  const mutedColor = isLight ? '#64748b' : '#94a3b8';

  const loginInputStyle: React.CSSProperties = {
    width: '100%',
    height: '54px',
    borderRadius: '16px',
    border: isLight ? '1px solid rgba(15,23,42,0.14)' : '1px solid rgba(255,255,255,0.08)',
    background: isLight ? '#ffffff' : 'rgba(255,255,255,0.04)',
    color: isLight ? '#111827' : '#ffffff',
    padding: '0 16px',
    outline: 'none',
    fontSize: '15px',
    boxShadow: isLight ? '0 8px 20px rgba(15,23,42,0.06)' : 'none'
  };


  return (
    <div
      className="login-page"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '32px',
        background: pageBg
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '1180px',
          minHeight: '680px',
          display: 'grid',
          gridTemplateColumns: '1fr 0.9fr',
          background: shellBg,
          border: shellBorder,
          borderRadius: '34px',
          overflow: 'hidden',
          boxShadow: shellShadow
        }}
      >
        <div
          style={{
            padding: '42px',
            background: infoPanelBg
          }}
        >
          <div
            style={{
              width: '180px',
              height: '180px',
              borderRadius: '26px',
              display: 'grid',
              placeItems: 'center',
              fontSize: '38px',
              background: 'linear-gradient(135deg, #2563eb, #8b5cf6)',
              boxShadow: '0 18px 45px rgba(37,99,235,0.38)',
              overflow: 'hidden',
              marginRight: 'auto',
              marginLeft: '180px'
            }}
          >
            {appLogoUrl ? (
              <img
                key={appLogoUrl}
                src={appLogoUrl}
                alt="App Logo"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              '👕'
            )}
          </div>

          <h1
            style={{
              margin: '26px 0 12px',
              fontSize: '42px',
              lineHeight: 1.15,
              color: titleColor
            }}
          >
            {appName}
          </h1>

          <p
            style={{
              margin: 0,
              color: textColor,
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
                  background: isLight ? 'rgba(37,99,235,0.06)' : 'rgba(255,255,255,0.04)',
                  border: isLight
                    ? '1px solid rgba(37,99,235,0.14)'
                    : '1px solid rgba(255,255,255,0.08)',
                  color: isLight ? '#1e293b' : '#e2e8f0',
                  fontWeight: 700
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
            alignItems: 'center',
            background: formPanelBg
          }}
        >
          <div style={{ width: '100%' }}>
            <div style={{ marginBottom: '24px' }}>
              <div
                style={{
                  color: isLight ? '#2563eb' : '#94a3b8',
                  fontSize: '14px',
                  marginBottom: '8px',
                  fontWeight: 800
                }}
              >
                تسجيل الدخول
              </div>

              <h2
                style={{
                  margin: 0,
                  fontSize: '32px',
                  color: titleColor
                }}
              >
                أهلاً بعودتك
              </h2>

              <p
                style={{
                  margin: '10px 0 0',
                  color: mutedColor,
                  lineHeight: 1.8
                }}
              >
                أدخل بياناتك للوصول إلى النظام.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleLogin();
              }}
            >
              <div style={{ display: 'grid', gap: '16px' }}>
                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: isLight ? '#334155' : '#cbd5e1',
                      fontSize: '14px',
                      fontWeight: 700
                    }}
                  >
                    اسم المستخدم
                  </label>

                  <input
                    ref={usernameRef}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="أدخل اسم المستخدم"
                    style={loginInputStyle}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: isLight ? '#334155' : '#cbd5e1',
                      fontSize: '14px',
                      fontWeight: 700
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
                      style={{ ...loginInputStyle, paddingLeft: '90px' }}
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
                        border: isLight
                          ? '1px solid rgba(15,23,42,0.12)'
                          : '1px solid rgba(255,255,255,0.08)',
                        background: isLight
                          ? 'rgba(15,23,42,0.04)'
                          : 'rgba(255,255,255,0.05)',
                        color: isLight ? '#111827' : '#fff',
                        fontWeight: 700
                      }}
                    >
                      {showPassword ? 'إخفاء' : 'إظهار'}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    border: 'none',
                    height: '54px',
                    borderRadius: '16px',
                    background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '16px',
                    boxShadow: '0 14px 30px rgba(37,99,235,0.28)',
                    opacity: loading ? 0.65 : 1,
                    cursor: loading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {loading ? 'جاري الدخول...' : 'دخول'}
                </button>
              </div>
            </form>

            {error && (
              <div
                style={{
                  marginTop: '16px',
                  background: 'rgba(239,68,68,0.12)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  color: '#fca5a5',
                  padding: '12px',
                  borderRadius: '12px',
                  fontWeight: 800
                }}
              >
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
