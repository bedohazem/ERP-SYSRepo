import { useEffect, useRef, useState, type ReactNode } from 'react';

type LicenseStatus = {
  activated: boolean;
  trial_started_at: string;
  trial_days: number;
  trial_expires_at: string;
  days_left: number;
  expired: boolean;
  blocked?: boolean;
  message?: string;
  device_code?: string;
  app_logo_url: string;
  app_name: string;
  app_theme?: 'dark' | 'light';
};

const SUPPORT_NAME = 'بشمهندس عبدالرحمن';
const SUPPORT_PHONE_DISPLAY = '01155559287';
const SUPPORT_PHONE_DISPLAY2 = '01068377869';
const SUPPORT_WHATSAPP_RAW = '201155559287'; // رقم واتساب بدون +

export default function LicenseGate({ children }: { children: ReactNode }) {
  const isPopupWindow = Boolean(window.opener);

  if (isPopupWindow) {
    return <>{children}</>;
  }
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activationCode, setActivationCode] = useState('');
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState('');

  const licenseTimerRef = useRef<number | null>(null);

  function applyAppTitle(name?: string) {
    document.title = name?.trim() || 'ERP Store';
  }

  function applyAppTheme(theme?: 'dark' | 'light') {
    document.documentElement.setAttribute(
      'data-theme',
      theme === 'light' ? 'light' : 'dark'
    );
  }

  async function waitForApi(maxTries = 20) {
    for (let i = 0; i < maxTries; i += 1) {
      const api = (window as any).api;

      if (api && typeof api.getLicenseStatus === 'function') {
        return api as Window['api'];
      }

      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }

    return null;
  }

  async function loadLicenseStatus() {
    setLoading(true);

    try {
      const api = await waitForApi();

      if (!api) {
        setMessage('تعذر تحميل واجهة البرنامج. أغلق البرنامج وافتحه مرة أخرى.');
        return;
      }

      const data = await api.getLicenseStatus();
      window.__APP_LICENSE_STATUS__ = data;

      setStatus(data);
      applyAppTitle(data.app_name);
      applyAppTheme(data.app_theme);
      scheduleLicenseCheck(data);
    } catch (error) {
      console.error('Failed to load license status:', error);
      setMessage('حدث خطأ أثناء التحقق من حالة التفعيل');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLicenseStatus();

    return () => {
      clearLicenseTimer();
    };
  }, []);

  useEffect(() => {
    function handleLicenseChanged(event: Event) {
      const customEvent = event as CustomEvent<LicenseStatus>;

      if (customEvent.detail) {
        window.__APP_LICENSE_STATUS__ = customEvent.detail;
        setStatus(customEvent.detail);
        applyAppTitle(customEvent.detail.app_name);
        applyAppTheme(customEvent.detail.app_theme);
        scheduleLicenseCheck(customEvent.detail);
        return;
      }

      void loadLicenseStatus();
    }

    window.addEventListener('license-status-changed', handleLicenseChanged);

    return () => {
      window.removeEventListener('license-status-changed', handleLicenseChanged);
    };
  }, []);

  async function handleActivate() {
    if (activating) return;

    if (!activationCode.trim()) {
      setMessage('اكتب كود التفعيل');
      return;
    }

    setActivating(true);
    setMessage('');

    try {
      const api = await waitForApi();

      if (!api) {
        setMessage('تعذر تحميل واجهة البرنامج. أغلق البرنامج وافتحه مرة أخرى.');
        return;
      }

      const result = await api.activateApp(activationCode.trim());

      if (!result.success) {
        setMessage(result.message || 'كود التفعيل غير صحيح');
        return;
      }

      if (result.status) {
        setStatus(result.status);
        applyAppTitle(result.status.app_name);
        applyAppTheme(result.status.app_theme);
      }

      setActivationCode('');
    } catch (error) {
      console.error('Failed to activate app:', error);
      setMessage('حدث خطأ أثناء تفعيل البرنامج');
    } finally {
      setActivating(false);
    }
  }

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>جاري التحقق من حالة التفعيل...</div>
      </div>
    );
  }

  const locked = Boolean(status?.expired) && !Boolean(status?.activated);

  if (!locked) {
    return <>{children}</>;
  }


  function clearLicenseTimer() {
    if (licenseTimerRef.current) {
      window.clearTimeout(licenseTimerRef.current);
      licenseTimerRef.current = null;
    }
  }

  function scheduleLicenseCheck(nextStatus: LicenseStatus) {
    clearLicenseTimer();

    if (nextStatus.activated || nextStatus.expired) {
      return;
    }

    const expiresAt = new Date(nextStatus.trial_expires_at).getTime();
    const delay = expiresAt - Date.now();

    if (delay <= 0) {
      void loadLicenseStatus();
      return;
    }

    licenseTimerRef.current = window.setTimeout(() => {
      void loadLicenseStatus();
    }, Math.min(delay + 1000, 2147483647));
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        {status?.app_logo_url ? (
          <img
            src={status.app_logo_url}
            alt="App Logo"
            style={{
              width: '88px',
              height: '88px',
              borderRadius: '24px',
              objectFit: 'cover',
              margin: '0 auto 8px',
              background: 'rgba(255,255,255,0.08)'
            }}
          />
        ) : (
          <div
            style={{
              width: '88px',
              height: '88px',
              borderRadius: '24px',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 8px',
              fontSize: '38px',
              background: 'linear-gradient(135deg, #2563eb, #7c3aed)'
            }}
          >
            👕
          </div>
        )}

        <h2 style={{ margin: 0, textAlign: 'center' }}>انتهت فترة التجربة</h2>

        <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.8, textAlign: 'center' }}>
          انتهت فترة التجربة المجانية. أدخل كود التفعيل للمتابعة.
        </p>

        {status?.message && (
          <p
            style={{
              margin: 0,
              color: '#fca5a5',
              lineHeight: 1.8,
              textAlign: 'center',
              fontWeight: 800
            }}
          >
            {status.message}
          </p>
        )}

        {status?.device_code && (
          <div
            style={{
              padding: '12px',
              borderRadius: '14px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.10)',
              textAlign: 'center',
              display: 'grid',
              gap: '8px'
            }}
          >
            <div style={{ color: '#94a3b8', fontWeight: 800 }}>
              كود الجهاز
            </div>

            <strong
              dir="ltr"
              style={{
                color: '#fff',
                fontSize: '20px',
                letterSpacing: '1px',
                direction: 'ltr',
                unicodeBidi: 'bidi-override'
              }}
            >
              {status.device_code}
            </strong>

            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(status.device_code || '')}
              style={contactButtonStyle}
            >
              نسخ كود الجهاز
            </button>
          </div>
        )}
        
        <div
          style={{
            padding: '14px',
            borderRadius: '16px',
            background: 'rgba(37,99,235,0.10)',
            border: '1px solid rgba(37,99,235,0.25)',
            display: 'grid',
            gap: '10px',
            textAlign: 'center'
          }}
        >
          <div style={{ color: '#bfdbfe', fontWeight: 900 }}>
            للتفعيل تواصل مع {SUPPORT_NAME}
          </div>

          <div style={{ color: '#e5e7eb', fontWeight: 800 }}>
            Phone Number / WhatsApp: {SUPPORT_PHONE_DISPLAY}
          </div>
          <div style={{ color: '#e5e7eb', fontWeight: 800 }}>
            Phone Number 2: {SUPPORT_PHONE_DISPLAY2}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px'
            }}
          >
            <button
              type="button"
              onClick={() => {
                window.open(`tel:${SUPPORT_PHONE_DISPLAY}`, '_blank');
              }}
              style={contactButtonStyle}
            >
              اتصال
            </button>

            <button
              type="button"
              onClick={() => {
                window.open(`https://wa.me/${SUPPORT_WHATSAPP_RAW}`, '_blank');
              }}
              style={{
                ...contactButtonStyle,
                background: 'rgba(16,185,129,0.16)',
                border: '1px solid rgba(16,185,129,0.35)',
                color: '#6ee7b7'
              }}
            >
              واتساب
            </button>
          </div>
        </div>

        <input
          value={activationCode}
          onChange={(e) => setActivationCode(e.target.value)}
          placeholder="كود التفعيل"
          style={inputStyle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void handleActivate();
            }
          }}
        />

        {message && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '12px',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.25)',
              color: '#fca5a5',
              fontWeight: 800,
              textAlign: 'center'
            }}
          >
            {message}
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleActivate()}
          disabled={activating}
          style={{
            height: '48px',
            borderRadius: '14px',
            border: 'none',
            background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
            color: '#fff',
            fontWeight: 900,
            cursor: activating ? 'not-allowed' : 'pointer',
            opacity: activating ? 0.6 : 1
          }}
        >
          {activating ? 'جاري التفعيل...' : 'تفعيل البرنامج'}
        </button>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: '24px',
  background:
    'radial-gradient(circle at top right, rgba(37,99,235,0.20), transparent 28%), radial-gradient(circle at bottom left, rgba(139,92,246,0.18), transparent 26%), #08152f',
  color: '#fff',
  direction: 'rtl'
};

const cardStyle: React.CSSProperties = {
  width: 'min(460px, 100%)',
  borderRadius: '26px',
  padding: '28px',
  display: 'grid',
  gap: '16px',
  background: 'rgba(15,23,42,0.96)',
  border: '1px solid rgba(255,255,255,0.10)',
  boxShadow: '0 24px 70px rgba(0,0,0,0.40)'
};

const inputStyle: React.CSSProperties = {
  height: '48px',
  borderRadius: '14px',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  outline: 'none',
  padding: '0 14px',
  textAlign: 'right',
  fontWeight: 800
};

const contactButtonStyle: React.CSSProperties = {
  height: '42px',
  borderRadius: '12px',
  border: '1px solid rgba(96,165,250,0.35)',
  background: 'rgba(37,99,235,0.16)',
  color: '#bfdbfe',
  fontWeight: 900,
  cursor: 'pointer'
};