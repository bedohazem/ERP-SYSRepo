import { useEffect, useRef, useState, type ReactNode } from 'react';

type LicenseStatus = {
  activated: boolean;
  trial_started_at: string;
  trial_days: number;
  trial_expires_at: string;
  days_left: number;
  expired: boolean;
  app_logo_url: string;
  app_name: string;
};

export default function LicenseGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activationCode, setActivationCode] = useState('');
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState('');

  const licenseTimerRef = useRef<number | null>(null);

  function applyAppTitle(name?: string) {
    document.title = name?.trim() || 'ERP Store';
  }

  async function loadLicenseStatus() {
    setLoading(true);

    try {
      const data = await window.api.getLicenseStatus();
      setStatus(data);
      applyAppTitle(data.app_name);
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
        setStatus(customEvent.detail);
        applyAppTitle(customEvent.detail.app_name);
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
      const result = await window.api.activateApp(activationCode.trim());

      if (!result.success) {
        setMessage(result.message || 'كود التفعيل غير صحيح');
        return;
      }

      if (result.status) {
        setStatus(result.status);
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