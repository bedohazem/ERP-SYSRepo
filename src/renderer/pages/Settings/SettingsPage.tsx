import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth.store';

type BarcodeItemPosition =
  | 'top'
  | 'top-left'
  | 'top-right'
  | 'above_barcode'
  | 'below_barcode'
  | 'bottom'
  | 'bottom-left'
  | 'bottom-right'
  | 'hidden';

type BarcodeItemAlign = 'left' | 'center' | 'right';

type BarcodePrintSettings = {
  barcode_label_width_mm: number;
  barcode_label_height_mm: number;
  barcode_copies: number;
  barcode_auto_print_after_save: boolean;

  barcode_content_offset_x_mm: number;
  barcode_content_offset_y_mm: number;

  barcode_name_font_size: number;
  barcode_name_position: BarcodeItemPosition;
  barcode_name_align: BarcodeItemAlign;

  barcode_price_font_size: number;
  barcode_price_position: BarcodeItemPosition;
  barcode_price_align: BarcodeItemAlign;

  barcode_size_font_size: number;
  barcode_size_position: BarcodeItemPosition;
  barcode_size_align: BarcodeItemAlign;

  barcode_color_font_size: number;
  barcode_color_position: BarcodeItemPosition;
  barcode_color_align: BarcodeItemAlign;

  barcode_value_font_size: number;
  barcode_value_position: BarcodeItemPosition;
  barcode_value_align: BarcodeItemAlign;

  barcode_svg_height: number;
};

const defaultSettings: BarcodePrintSettings = {
  barcode_label_width_mm: 35,
  barcode_label_height_mm: 25,
  barcode_copies: 1,
  barcode_auto_print_after_save: false,

  barcode_content_offset_x_mm: 0,
  barcode_content_offset_y_mm: 0,

  barcode_name_font_size: 8,
  barcode_name_position: 'top',
  barcode_name_align: 'center',

  barcode_price_font_size: 7,
  barcode_price_position: 'bottom',
  barcode_price_align: 'center',

  barcode_size_font_size: 6,
  barcode_size_position: 'above_barcode',
  barcode_size_align: 'center',

  barcode_color_font_size: 6,
  barcode_color_position: 'above_barcode',
  barcode_color_align: 'center',

  barcode_value_font_size: 7,
  barcode_value_position: 'below_barcode',
  barcode_value_align: 'center',

  barcode_svg_height: 22
};

type AppLicenseStatus = {
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
  app_name?: string;
  app_theme?: 'dark' | 'light';
};

type SettingsTab = 'store' | 'backup' | 'loyalty' | 'barcode';

export default function SettingsPage() {
  const [settings, setSettings] = useState<BarcodePrintSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);

  const [licenseStatus, setLicenseStatus] = useState<AppLicenseStatus | null>(null);
  const [activationCode, setActivationCode] = useState('');
  const [appLogoUrl, setAppLogoUrl] = useState('');
  const [savingActivation, setSavingActivation] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);

  const [deactivatingApp, setDeactivatingApp] = useState(false);
  const [confirmDeactivateApp, setConfirmDeactivateApp] = useState(false);

  const [activeTab, setActiveTab] = useState<SettingsTab>('store');

  const [appName, setAppName] = useState('');
  const [savingAppName, setSavingAppName] = useState(false);
  const [appTheme, setAppTheme] = useState<'dark' | 'light'>('dark');
  const [savingAppTheme, setSavingAppTheme] = useState(false);
  const currentUser = useAuthStore((s) => s.user);

  useEffect(() => {
    void loadSettings();
  }, []);


  function showMessage(type: 'success' | 'error', text: string) {
    setPageMessage({ type, text });

    setTimeout(() => {
      setPageMessage(null);
    }, 1800);
  }

  async function loadSettings() {
    try {
      const [barcodeData, loyaltyData, licenseData] = await Promise.all([
        window.api.getBarcodePrintSettings(),
        window.api.getLoyaltySettings(),
        window.api.getLicenseStatus()
      ]);

      setSettings(barcodeData);
      setLoyaltySettings(loyaltyData);
      setLicenseStatus(licenseData);
      setAppLogoUrl(licenseData.app_logo_url || '');
      setAppName(licenseData.app_name || 'ERP Store');
      const loadedTheme = licenseData.app_theme === 'light' ? 'light' : 'dark';
      setAppTheme(loadedTheme);
      document.documentElement.setAttribute('data-theme', loadedTheme);
    } catch (error) {
      console.error('Failed to load settings:', error);
      showMessage('error', 'حدث خطأ أثناء تحميل الإعدادات');
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);

    try {
      await window.api.saveBarcodePrintSettings(settings);
      showMessage('success', 'تم حفظ إعدادات الطباعة بنجاح');
    } catch (error) {
      console.error('Failed to save barcode print settings:', error);
      showMessage('error', 'حدث خطأ أثناء حفظ إعدادات الطباعة');
    } finally {
      setSaving(false);
    }
  }

  function setField<K extends keyof BarcodePrintSettings>(
    key: K,
    value: BarcodePrintSettings[K]
  ) {
    setSettings((prev) => ({
      ...prev,
      [key]: value
    }));
  }

  const [savingLoyalty, setSavingLoyalty] = useState(false);
  const [pageMessage, setPageMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

    const [loyaltySettings, setLoyaltySettings] = useState({
      loyalty_enabled: true,
      loyalty_earn_amount: 100,
      loyalty_earn_points: 1,
      loyalty_point_value: 1,
      loyalty_min_redeem_points: 1
    });

  async function saveLoyaltySettings() {
    if (savingLoyalty) return;

    setSavingLoyalty(true);

    try {
      const saved = await window.api.saveLoyaltySettings({
        loyalty_enabled: Boolean(loyaltySettings.loyalty_enabled),
        loyalty_earn_amount: Math.max(1, Number(loyaltySettings.loyalty_earn_amount || 1)),
        loyalty_earn_points: Math.max(1, Number(loyaltySettings.loyalty_earn_points || 1)),
        loyalty_point_value: Math.max(0, Number(loyaltySettings.loyalty_point_value || 0)),
        loyalty_min_redeem_points: Math.max(
          1,
          Number(loyaltySettings.loyalty_min_redeem_points || 1)
        )
      });

      setLoyaltySettings(saved);
      showMessage('success', 'تم حفظ إعدادات نقاط الولاء');
    } catch (error) {
      console.error('Failed to save loyalty settings:', error);
      showMessage('error', 'حدث خطأ أثناء حفظ إعدادات النقاط');
    } finally {
      setSavingLoyalty(false);
    }
  }

  async function backupDatabase() {
    if (backupLoading) return;

    setBackupLoading(true);

    try {
      const result = await window.api.backupDatabase({ actor_id: currentUser?.id })


      if (result.canceled) {
        return;
      }

      if (!result.success) {
        showMessage('error', result.message || 'فشل حفظ النسخة الاحتياطية');
        return;
      }

      showMessage('success', 'تم حفظ النسخة الاحتياطية بنجاح');
    } catch (error) {
      console.error('Failed to backup database:', error);
      showMessage('error', 'حدث خطأ أثناء حفظ النسخة الاحتياطية');
    } finally {
      setBackupLoading(false);
    }
  }

  async function restoreDatabase() {
    if (restoreLoading) return;

    const confirmed = confirm(
      'تحذير: استرجاع نسخة احتياطية سيستبدل بيانات البرنامج الحالية. هل أنت متأكد؟'
    );

    if (!confirmed) {
      return;
    }

    setRestoreLoading(true);

    try {
      const result = await window.api.restoreDatabase({ actor_id: currentUser?.id })

      if (result.canceled) {
        return;
      }

      if (!result.success) {
        showMessage('error', result.message || 'فشل استرجاع النسخة الاحتياطية');
        return;
      }

      showMessage('success', 'تم استرجاع النسخة الاحتياطية بنجاح. يفضل إعادة تشغيل البرنامج.');
    } catch (error) {
      console.error('Failed to restore database:', error);
      showMessage('error', 'حدث خطأ أثناء استرجاع النسخة الاحتياطية');
    } finally {
      setRestoreLoading(false);
    }
  }

  async function resetDatabase() {
    if (resetLoading) return;

    setResetLoading(true);

    try {
      const result = await window.api.resetDatabase({ actor_id: currentUser?.id })

      if (result.canceled) {
        return;
      }

      if (!result.success) {
        showMessage('error', result.message || 'فشل تصفير البرنامج');
        return;
      }

      showMessage(
        'success',
        'تم تصفير البرنامج بنجاح. تم إنشاء نسخة أمان قبل المسح. يفضل إعادة تشغيل البرنامج.'
      );
    } catch (error) {
      console.error('Failed to reset database:', error);
      showMessage('error', 'حدث خطأ أثناء تصفير البرنامج');
    } finally {
      setResetLoading(false);
    }
  }
  if (loading) {
    return (
      <div className="glass-card" style={{ borderRadius: '24px', padding: '24px' }}>
        جاري تحميل الإعدادات...
      </div>
    );
  }


  async function handleActivateApp() {
    if (savingActivation) return;

    const code = activationCode.trim();

    if (!code) {
      showMessage('error', 'اكتب كود التفعيل');
      return;
    }

    setSavingActivation(true);

    try {
      const result = await window.api.activateApp(code);

      if (!result.success) {
        showMessage('error', result.message || 'كود التفعيل غير صحيح');
        return;
      }

      if (result.status) {
        setLicenseStatus(result.status);

        window.dispatchEvent(
          new CustomEvent('license-status-changed', {
            detail: result.status
          })
        );
      }

      setActivationCode('');
      showMessage('success', 'تم تفعيل البرنامج بنجاح');
    } catch (error) {
      console.error('Failed to activate app:', error);
      showMessage('error', 'حدث خطأ أثناء تفعيل البرنامج');
    } finally {
      setSavingActivation(false);
    }
  }

  async function handleSaveAppLogoUrl() {
    if (savingLogo) return;

    setSavingLogo(true);

    try {
      const result = await window.api.saveAppLogoUrl(appLogoUrl.trim(), { actor_id: currentUser?.id });
      setLicenseStatus(result.status);
      showMessage('success', 'تم حفظ رابط صورة التطبيق');
    } catch (error) {
      console.error('Failed to save app logo url:', error);
      showMessage('error', 'حدث خطأ أثناء حفظ رابط الصورة');
    } finally {
      setSavingLogo(false);
    }
  }

  async function handleChooseAppLogo() {
    if (savingLogo) return;

    setSavingLogo(true);

    try {
      const result = await window.api.chooseAppLogo({ actor_id: currentUser?.id })

      if (result.canceled) {
        return;
      }

      if (!result.success) {
        showMessage('error', result.message || 'فشل اختيار صورة التطبيق');
        return;
      }

      if (result.logoUrl) {
        setAppLogoUrl(result.logoUrl);
      }

      if (result.status) {
        setLicenseStatus(result.status);
      }

      showMessage('success', 'تم اختيار صورة التطبيق بنجاح');
    } catch (error) {
      console.error('Failed to choose app logo:', error);
      showMessage('error', 'حدث خطأ أثناء اختيار صورة التطبيق');
    } finally {
      setSavingLogo(false);
    }
  }


  async function handleDeactivateApp() {
    if (deactivatingApp) return;

    setDeactivatingApp(true);

    try {
      const result = await window.api.deactivateApp();

      if (!result.success) {
        showMessage('error', result.message || 'فشل إلغاء التفعيل');
        return;
      }

      const freshStatus = await window.api.getLicenseStatus();
      console.log('FRESH STATUS IN RENDERER:', freshStatus);

      setLicenseStatus(freshStatus);

      window.dispatchEvent(
        new CustomEvent('license-status-changed', {
          detail: freshStatus
        })
      );

      setShowDeactivateModal(false);
      setConfirmDeactivateApp(false);
      showMessage('success', 'تم إلغاء تفعيل البرنامج');
    } catch (error) {
      console.error('Failed to deactivate app:', error);
      showMessage('error', 'حدث خطأ أثناء إلغاء التفعيل');
    } finally {
      setDeactivatingApp(false);
    }
  }

  async function copyDeviceCode() {
    const code = licenseStatus?.device_code || '';

    if (!code) {
      showMessage('error', 'كود الجهاز غير متاح');
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      showMessage('success', 'تم نسخ كود الجهاز');
    } catch {
      showMessage('error', 'تعذر نسخ كود الجهاز');
    }
  }

  async function handleSaveAppName() {
    if (savingAppName) return;

    const cleanName = appName.trim();

    if (!cleanName) {
      showMessage('error', 'اكتب اسم المحل');
      return;
    }

    setSavingAppName(true);

    try {
      const result = await window.api.saveAppName(cleanName, { actor_id: currentUser?.id });

      setLicenseStatus(result.status);
      setAppName(result.status.app_name || cleanName);
      document.title = result.status.app_name || 'ERP Store';

      window.dispatchEvent(
        new CustomEvent('license-status-changed', {
          detail: result.status
        })
      );

      showMessage('success', 'تم حفظ اسم المحل');
    } catch (error) {
      console.error('Failed to save app name:', error);
      showMessage('error', 'حدث خطأ أثناء حفظ اسم المحل');
    } finally {
      setSavingAppName(false);
    }
  }
  
  async function handleSaveAppTheme() {
    if (savingAppTheme) return;

    setSavingAppTheme(true);

    try {
      const result = await window.api.saveAppTheme(appTheme, {
        actor_id: currentUser?.id
      });

      if (!result.success) {
        showMessage('error', result.message || 'فشل حفظ وضع الواجهة');
        return;
      }

      setLicenseStatus(result.status);
      document.documentElement.setAttribute('data-theme', result.status.app_theme || 'dark');

      window.dispatchEvent(
        new CustomEvent('license-status-changed', {
          detail: result.status
        })
      );

      showMessage('success', 'تم حفظ وضع الواجهة');
    } catch (error) {
      console.error('Failed to save app theme:', error);
      showMessage('error', 'حدث خطأ أثناء حفظ وضع الواجهة');
    } finally {
      setSavingAppTheme(false);
    }
  }

    return (
      <div style={{ display: 'grid', gap: '16px' }}>
        {pageMessage && (
          <div
            style={{
              position: 'fixed',
              top: '24px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 99999,
              padding: '12px 18px',
              borderRadius: '14px',
              background:
                pageMessage.type === 'error'
                  ? 'rgba(239,68,68,0.95)'
                  : 'rgba(16,185,129,0.95)',
              color: '#fff',
              fontWeight: 800,
              boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
              pointerEvents: 'none'
            }}
          >
            {pageMessage.text}
          </div>
        )}

        <div
          className="glass-card"
          style={{
            borderRadius: '18px',
            padding: '10px',
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            direction: 'rtl'
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('store')}
            style={tabButtonStyle(activeTab === 'store')}
          >
            إعدادات المحل
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('backup')}
            style={tabButtonStyle(activeTab === 'backup')}
          >
            النسخ والبيانات
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('loyalty')}
            style={tabButtonStyle(activeTab === 'loyalty')}
          >
            نقاط الولاء
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('barcode')}
            style={tabButtonStyle(activeTab === 'barcode')}
          >
            طباعة الباركود
          </button>
        </div>
      {activeTab === 'backup' && (    
        <div
          className="glass-card"
          style={{
            borderRadius: '24px',
            padding: '24px',
            display: 'grid',
            gap: '16px',
            direction: 'rtl'
          }}
        >
          <div>
            <h2 style={{ margin: '0 0 8px' }}>النسخ الاحتياطي واسترجاع البيانات</h2>
            <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.8 }}>
              احفظ نسخة من قاعدة البيانات أو استرجع نسخة قديمة عند الحاجة.
            </p>
          </div>

          <div
            style={{
              padding: '14px',
              borderRadius: '14px',
              background: 'rgba(245,158,11,0.10)',
              border: '1px solid rgba(245,158,11,0.25)',
              color: '#fde68a',
              fontWeight: 700,
              lineHeight: 1.8
            }}
          >
            نصيحة: اعمل نسخة احتياطية يوميًا قبل إغلاق المحل، واحتفظ بها على فلاشة أو Google Drive.
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={backupDatabase}
              disabled={backupLoading}
              style={{
                ...primaryButtonStyle,
                opacity: backupLoading ? 0.6 : 1,
                cursor: backupLoading ? 'not-allowed' : 'pointer'
              }}
            >
              {backupLoading ? 'جاري الحفظ...' : 'حفظ نسخة احتياطية'}
            </button>

            <button
              type="button"
              onClick={restoreDatabase}
              disabled={restoreLoading}
              style={{
                ...dangerButtonStyle,
                opacity: restoreLoading ? 0.6 : 1,
                cursor: restoreLoading ? 'not-allowed' : 'pointer'
              }}
            >
              {restoreLoading ? 'جاري الاسترجاع...' : 'استرجاع نسخة احتياطية'}
            </button>

            <button
              type="button"
              onClick={() => void resetDatabase()}
              disabled={resetLoading}
              style={{
                ...dangerButtonStyle,
                opacity: resetLoading ? 0.6 : 1,
                cursor: resetLoading ? 'not-allowed' : 'pointer',
                background: 'rgba(127,29,29,0.35)',
                border: '1px solid rgba(248,113,113,0.45)',
                color: '#fecaca'
              }}
            >
              {resetLoading ? 'جاري التصفير...' : 'تصفير البرنامج ومسح كل البيانات'}
            </button>
          </div>
        </div>
      )}
      {activeTab === 'store' && (
        <div
          className="glass-card"
          style={{
            borderRadius: '24px',
            padding: '24px',
            display: 'grid',
            gap: '16px',
            direction: 'rtl'
          }}
        >
          <div>
            <h2 style={{ margin: '0 0 8px' }}>إعدادات المحل</h2>
            <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.8 }}>
              إدارة تفعيل البرنامج وصورة التطبيق التي تظهر في اللوجن والواجهة.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px'
            }}
          >
            <div style={statCardStyle}>
              الحالة
              <strong style={{ color: licenseStatus?.activated ? '#6ee7b7' : '#fdba74' }}>
                {licenseStatus?.activated ? 'مفعل' : licenseStatus?.expired ? 'انتهت التجربة' : 'تجربة'}
              </strong>
            </div>

            <div style={statCardStyle}>
              الأيام المتبقية
              <strong>{licenseStatus?.activated ? '∞' : licenseStatus?.days_left ?? 0}</strong>
            </div>

            <div style={statCardStyle}>
              مدة التجربة
              <strong>{licenseStatus?.trial_days ?? 7} أيام</strong>
            </div>
          </div>

          <div
            style={{
              padding: '14px',
              borderRadius: '16px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'grid',
              gap: '10px'
            }}
          >
            <div style={{ color: '#94a3b8', fontWeight: 900 }}>
              كود الجهاز
            </div>

            <div
              dir="ltr"
              style={{
                fontSize: '20px',
                fontWeight: 900,
                letterSpacing: '1px',
                color: '#f8fafc',
                background: 'rgba(15,23,42,0.55)',
                border: '1px solid rgba(148,163,184,0.18)',
                borderRadius: '12px',
                padding: '12px',
                textAlign: 'center',
                direction: 'ltr',
                unicodeBidi: 'bidi-override'
              }}
            >
              {licenseStatus?.device_code || '—'}
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void copyDeviceCode()}
                style={primaryButtonStyle}
              >
                نسخ كود الجهاز
              </button>

              <span style={{ color: '#64748b', fontWeight: 700, alignSelf: 'center' }}>
                ابعت الكود ده لصاحب البرنامج للحصول على كود التفعيل.
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1fr) auto auto',
              gap: '12px',
              alignItems: 'end'
            }}
          >
            <div>
              <label style={labelStyle}>كود التفعيل</label>
              <input
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                placeholder="اكتب كود التفعيل"
                style={inputStyle}
              />
            </div>

            <button
              type="button"
              onClick={() => void handleActivateApp()}
              disabled={savingActivation}
              style={{
                ...primaryButtonStyle,
                opacity: savingActivation ? 0.6 : 1,
                cursor: savingActivation ? 'not-allowed' : 'pointer'
              }}
            >
              {savingActivation ? 'جاري التفعيل...' : 'تفعيل'}
            </button>
          {licenseStatus?.activated && (
            <button
              type="button"
              onClick={() => setShowDeactivateModal(true)}
              disabled={deactivatingApp}
              style={{
                ...dangerButtonStyle,
                opacity: deactivatingApp ? 0.6 : 1,
                cursor: deactivatingApp ? 'not-allowed' : 'pointer'
              }}
            >
              {deactivatingApp ? 'جاري إلغاء التفعيل...' : 'إلغاء التفعيل'}
            </button>
          )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1fr) auto',
              gap: '12px',
              alignItems: 'end'
            }}
          >
            <div>
              <label style={labelStyle}>وضع الواجهة</label>
              <select
                value={appTheme}
                onChange={(e) => {
                  const nextTheme = e.target.value === 'light' ? 'light' : 'dark';
                  setAppTheme(nextTheme);
                  document.documentElement.setAttribute('data-theme', nextTheme);
                }}
                style={inputStyle}
              >
                <option value="dark">ليلي</option>
                <option value="light">نهاري</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => void handleSaveAppTheme()}
              disabled={savingAppTheme}
              style={{
                ...primaryButtonStyle,
                opacity: savingAppTheme ? 0.6 : 1,
                cursor: savingAppTheme ? 'not-allowed' : 'pointer'
              }}
            >
              {savingAppTheme ? 'جاري الحفظ...' : 'حفظ الوضع'}
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1fr) auto',
              gap: '12px',
              alignItems: 'end'
            }}
          >
            <div>
              <label style={labelStyle}>اسم المحل</label>
              <input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="مثال: Lamar Store"
                style={inputStyle}
              />
            </div>

            <button
              type="button"
              onClick={() => void handleSaveAppName()}
              disabled={savingAppName}
              style={{
                ...primaryButtonStyle,
                opacity: savingAppName ? 0.6 : 1,
                cursor: savingAppName ? 'not-allowed' : 'pointer'
              }}
            >
              {savingAppName ? 'جاري الحفظ...' : 'حفظ الاسم'}
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1fr) auto auto',
              gap: '12px',
              alignItems: 'end'
            }}
          >
            <div>
              <label style={labelStyle}>رابط / مسار صورة التطبيق</label>
              <input
                value={appLogoUrl}
                onChange={(e) => setAppLogoUrl(e.target.value)}
                placeholder="اختار صورة من الجهاز أو ضع رابط صورة"
                style={inputStyle}
              />
            </div>

            <button
              type="button"
              onClick={() => void handleChooseAppLogo()}
              disabled={savingLogo}
              style={{
                ...primaryButtonStyle,
                opacity: savingLogo ? 0.6 : 1,
                cursor: savingLogo ? 'not-allowed' : 'pointer'
              }}
            >
              اختيار صورة
            </button>

            <button
              type="button"
              onClick={() => void handleSaveAppLogoUrl()}
              disabled={savingLogo}
              style={{
                ...primaryButtonStyle,
                opacity: savingLogo ? 0.6 : 1,
                cursor: savingLogo ? 'not-allowed' : 'pointer'
              }}
            >
              حفظ
            </button>
          </div>

          {appLogoUrl.trim() && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '14px',
                borderRadius: '16px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)'
              }}
            >
              <img
                key={appLogoUrl}
                src={appLogoUrl}
                alt="App Logo"
                style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '18px',
                  objectFit: 'cover',
                  background: 'rgba(255,255,255,0.08)'
                }}
                onLoad={(e) => {
                  e.currentTarget.style.display = 'block';
                }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />

              <div style={{ color: '#94a3b8', fontWeight: 700 }}>
                معاينة الصورة الخارجية
              </div>
            </div>
          )}
        </div>
      )}
      {activeTab === 'barcode' && (
        <div className="glass-card" style={{ borderRadius: '24px', padding: '24px' }}>
          <h2 style={{ marginTop: 0 }}>إعدادات طباعة الباركود</h2>
          <p style={{ color: '#94a3b8' }}>
            اضبط هنا مقاس الليبل ومكان كل عنصر داخله.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
              marginTop: '20px'
            }}
          >
            <div>
              <label style={labelStyle}>عرض الليبل (مم)</label>
              <input
                type="number"
                value={settings.barcode_label_width_mm}
                onChange={(e) =>
                  setField('barcode_label_width_mm', Number(e.target.value))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>ارتفاع الليبل (مم)</label>
              <input
                type="number"
                value={settings.barcode_label_height_mm}
                onChange={(e) =>
                  setField('barcode_label_height_mm', Number(e.target.value))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>عدد النسخ</label>
              <input
                type="number"
                min={1}
                value={settings.barcode_copies}
                onChange={(e) => setField('barcode_copies', Number(e.target.value))}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>ارتفاع صورة الباركود</label>
              <input
                type="number"
                min={10}
                value={settings.barcode_svg_height}
                onChange={(e) => setField('barcode_svg_height', Number(e.target.value))}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>تحريك المحتوى يمين / شمال (مم)</label>
              <input
                type="number"
                step="0.1"
                value={settings.barcode_content_offset_x_mm}
                onChange={(e) =>
                  setField('barcode_content_offset_x_mm', Number(e.target.value))
                }
                style={inputStyle}
              />
              <small style={hintStyle}>
                موجب = يمين، سالب = شمال
              </small>
            </div>

            <div>
              <label style={labelStyle}>تحريك المحتوى فوق / تحت (مم)</label>
              <input
                type="number"
                step="0.1"
                value={settings.barcode_content_offset_y_mm}
                onChange={(e) =>
                  setField('barcode_content_offset_y_mm', Number(e.target.value))
                }
                style={inputStyle}
              />
              <small style={hintStyle}>
                موجب = تحت، سالب = فوق
              </small>
            </div>
            
          </div>

          <div style={{ marginTop: '16px' }}>
            <label style={checkboxRowStyle}>
              <input
                type="checkbox"
                checked={settings.barcode_auto_print_after_save}
                onChange={(e) =>
                  setField('barcode_auto_print_after_save', e.target.checked)
                }
              />
              <span>طباعة تلقائية بعد حفظ المنتج</span>
            </label>
          </div>

          <div style={{ marginTop: '24px', display: 'grid', gap: '16px' }}>
            <BarcodeItemEditor
              title="اسم المنتج"
              fontSize={settings.barcode_name_font_size}
              position={settings.barcode_name_position}
              align={settings.barcode_name_align}
              onFontSizeChange={(value) => setField('barcode_name_font_size', value)}
              onPositionChange={(value) => setField('barcode_name_position', value)}
              onAlignChange={(value) => setField('barcode_name_align', value)}
            />

            <BarcodeItemEditor
              title="السعر"
              fontSize={settings.barcode_price_font_size}
              position={settings.barcode_price_position}
              align={settings.barcode_price_align}
              onFontSizeChange={(value) => setField('barcode_price_font_size', value)}
              onPositionChange={(value) => setField('barcode_price_position', value)}
              onAlignChange={(value) => setField('barcode_price_align', value)}
            />

            <BarcodeItemEditor
              title="المقاس"
              fontSize={settings.barcode_size_font_size}
              position={settings.barcode_size_position}
              align={settings.barcode_size_align}
              onFontSizeChange={(value) => setField('barcode_size_font_size', value)}
              onPositionChange={(value) => setField('barcode_size_position', value)}
              onAlignChange={(value) => setField('barcode_size_align', value)}
            />

            <BarcodeItemEditor
              title="اللون"
              fontSize={settings.barcode_color_font_size}
              position={settings.barcode_color_position}
              align={settings.barcode_color_align}
              onFontSizeChange={(value) => setField('barcode_color_font_size', value)}
              onPositionChange={(value) => setField('barcode_color_position', value)}
              onAlignChange={(value) => setField('barcode_color_align', value)}
            />

            <BarcodeItemEditor
              title="رقم الباركود"
              fontSize={settings.barcode_value_font_size}
              position={settings.barcode_value_position}
              align={settings.barcode_value_align}
              onFontSizeChange={(value) => setField('barcode_value_font_size', value)}
              onPositionChange={(value) => setField('barcode_value_position', value)}
              onAlignChange={(value) => setField('barcode_value_align', value)}
            />
          </div>

          <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
            <button
              onClick={() => void saveSettings()}
              disabled={saving}
              style={primaryButtonStyle}
            >
              {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
            </button>
          </div>
        </div>
      )}
      {activeTab === 'loyalty' && (   
        <div
          className="glass-card"
          style={{
            padding: '22px',
            borderRadius: '18px',
            display: 'grid',
            gap: '18px',       
            direction: 'rtl'
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '14px',
              flexWrap: 'wrap'
            }}
          >
            <div>
              <h3 style={{ margin: '0 0 6px' }}>إعدادات نقاط الولاء</h3>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '14px' }}>
                حدد العميل يكسب كام نقطة، وقيمة النقطة عند استخدامها كخصم.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={loyaltySettings.loyalty_enabled}
              onClick={() =>
                setLoyaltySettings((prev) => ({
                  ...prev,
                  loyalty_enabled: !prev.loyalty_enabled
                }))
              }
              style={{
                width: '54px',
                height: '28px',
                borderRadius: '999px',
                border: 'none',
                padding: '3px',
                cursor: 'pointer',
                background: loyaltySettings.loyalty_enabled ? '#2563eb' : '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: loyaltySettings.loyalty_enabled ? 'flex-end' : 'flex-start',
                transition: 'all 0.2s ease'
              }}
            >
              <span
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background: '#fff',
                  display: 'block',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.25)'
                }}
              />
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '14px'
            }}
          >
            <div style={loyaltyFieldStyle}>
              <label style={labelStyle}>كل كام جنيه شراء؟</label>
              <input
                type="number"
                min={1}
                value={loyaltySettings.loyalty_earn_amount}
                onChange={(e) =>
                  setLoyaltySettings((p) => ({
                    ...p,
                    loyalty_earn_amount: Number(e.target.value)
                  }))
                }
                style={inputStyle}
              />
              <small style={hintStyle}>مثال: 1000 يعني كل 1000 جنيه</small>
            </div>

            <div style={loyaltyFieldStyle}>
              <label style={labelStyle}>يكسب كام نقطة؟</label>
              <input
                type="number"
                min={1}
                value={loyaltySettings.loyalty_earn_points}
                onChange={(e) =>
                  setLoyaltySettings((p) => ({
                    ...p,
                    loyalty_earn_points: Number(e.target.value)
                  }))
                }
                style={inputStyle}
              />
              <small style={hintStyle}>مثال: 10 نقاط لكل 1000 جنيه</small>
            </div>

            <div style={loyaltyFieldStyle}>
              <label style={labelStyle}>قيمة النقطة بالجنيه</label>
              <input
                type="number"
                min={0}
                value={loyaltySettings.loyalty_point_value}
                onChange={(e) =>
                  setLoyaltySettings((p) => ({
                    ...p,
                    loyalty_point_value: Number(e.target.value)
                  }))
                }
                style={inputStyle}
              />
              <small style={hintStyle}>مثال: كل نقطة = 10 جنيه خصم</small>
            </div>

            <div style={loyaltyFieldStyle}>
              <label style={labelStyle}>أقل عدد نقاط للاستخدام</label>
              <input
                type="number"
                min={1}
                value={loyaltySettings.loyalty_min_redeem_points}
                onChange={(e) =>
                  setLoyaltySettings((p) => ({
                    ...p,
                    loyalty_min_redeem_points: Number(e.target.value)
                  }))
                }
                style={inputStyle}
              />
              <small style={hintStyle}>أقل رصيد نقاط يسمح للعميل يستخدمه كخصم</small>
            </div>
          </div>

          <div
            style={{
              padding: '14px',
              borderRadius: '14px',
              background: 'rgba(37,99,235,0.10)',
              border: '1px solid rgba(37,99,235,0.25)',
              color: '#bfdbfe',
              fontWeight: 700,
              lineHeight: 1.8
            }}
          >
            مثال النظام الحالي:
            كل {loyaltySettings.loyalty_earn_amount} جنيه =
            {' '}{loyaltySettings.loyalty_earn_points} نقطة،
            وكل نقطة = {loyaltySettings.loyalty_point_value} جنيه خصم.
            أقل استخدام = {loyaltySettings.loyalty_min_redeem_points} نقطة.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <button
              type="button"
              onClick={saveLoyaltySettings}
              disabled={savingLoyalty}
              style={{
                ...primaryButtonStyle,
                opacity: savingLoyalty ? 0.6 : 1,
                cursor: savingLoyalty ? 'not-allowed' : 'pointer'
              }}
            >
              {savingLoyalty ? 'جاري الحفظ...' : 'حفظ إعدادات النقاط'}
            </button>
          </div>
        </div>
      )}

      {showDeactivateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            background: 'rgba(0,0,0,0.65)',
            display: 'grid',
            placeItems: 'center',
            padding: '20px'
          }}
        >
          <div
            className="glass-card"
            style={{
              width: 'min(460px, 100%)',
              borderRadius: '22px',
              padding: '22px',
              direction: 'rtl',
              display: 'grid',
              gap: '14px',
              border: '1px solid rgba(248,113,113,0.35)'
            }}
          >
            <h3 style={{ margin: 0, color: '#fecaca' }}>تأكيد إلغاء التفعيل</h3>

            <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.8, fontWeight: 700 }}>
              هل أنت متأكد إنك عايز تلغي تفعيل البرنامج؟ لو فترة التجربة منتهية، البرنامج هيقفل ويطلب كود تفعيل جديد.
            </p>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start' }}>
              <button
                type="button"
                onClick={handleDeactivateApp}
                disabled={deactivatingApp}
                style={{
                  ...dangerButtonStyle,
                  opacity: deactivatingApp ? 0.6 : 1
                }}
              >
                {deactivatingApp ? 'جاري الإلغاء...' : 'تأكيد إلغاء التفعيل'}
              </button>

              <button
                type="button"
                onClick={() => setShowDeactivateModal(false)}
                disabled={deactivatingApp}
                style={{
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  borderRadius: '12px',
                  padding: '11px 16px',
                  fontWeight: 900,
                  cursor: 'pointer'
                }}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    );
}

function BarcodeItemEditor(props: {
  title: string;
  fontSize: number;
  position: BarcodeItemPosition;
  align: BarcodeItemAlign;
  onFontSizeChange: (value: number) => void;
  onPositionChange: (value: BarcodeItemPosition) => void;
  onAlignChange: (value: BarcodeItemAlign) => void;
}) {
  return (
    <div
      className="glass-card"
      style={{
        borderRadius: '18px',
        padding: '16px',
        display: 'grid',
        gap: '12px'
      }}
    >
      <div style={{ fontSize: '16px', fontWeight: 700 }}>{props.title}</div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px'
        }}
      >
        <div>
          <label style={labelStyle}>حجم الخط</label>
          <input
            type="number"
            value={props.fontSize}
            onChange={(e) => props.onFontSizeChange(Number(e.target.value))}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>المكان</label>
          <select
            value={props.position}
            onChange={(e) =>
              props.onPositionChange(e.target.value as BarcodeItemPosition)
            }
            style={inputStyle}
          >
            <option value="top">أعلى</option>
            <option value="top-left">أعلى يسار</option>
            <option value="top-right">أعلى يمين</option>
            <option value="above_barcode">فوق الباركود</option>
            <option value="below_barcode">تحت الباركود</option>
            <option value="bottom">أسفل</option>
            <option value="bottom-left">أسفل يسار</option>
            <option value="bottom-right">أسفل يمين</option>
            <option value="hidden">إخفاء</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>المحاذاة</label>
          <select
            value={props.align}
            onChange={(e) =>
              props.onAlignChange(e.target.value as BarcodeItemAlign)
            }
            style={inputStyle}
          >
            <option value="left">يسار</option>
            <option value="center">وسط</option>
            <option value="right">يمين</option>
          </select>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '8px',
  color: '#cbd5e1',
  fontSize: '14px'
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: '#e5e7eb'
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '48px',
  borderRadius: '14px',
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)',
  color: '#fff',
  padding: '0 14px',
  outline: 'none'
};

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  height: '48px',
  borderRadius: '14px',
  background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
  color: '#fff',
  fontWeight: 700,
  padding: '0 18px',
  cursor: 'pointer'
};


const loyaltyFieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: '8px',
  padding: '14px',
  borderRadius: '14px',
  background: 'rgba(255,255,255,0.035)',
  border: '1px solid rgba(255,255,255,0.08)'
};

const hintStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: '12px',
  lineHeight: 1.6
};

const dangerButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(239,68,68,0.35)',
  height: '48px',
  borderRadius: '14px',
  background: 'rgba(239,68,68,0.14)',
  color: '#fca5a5',
  fontWeight: 700,
  padding: '0 18px',
  cursor: 'pointer'
};

const statCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: '8px',
  padding: '14px',
  borderRadius: '16px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#94a3b8',
  fontWeight: 800
};

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: active
      ? '1px solid rgba(96,165,250,0.55)'
      : '1px solid rgba(255,255,255,0.10)',
    minHeight: '44px',
    borderRadius: '14px',
    background: active
      ? 'linear-gradient(135deg, rgba(37,99,235,0.95), rgba(124,58,237,0.95))'
      : 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontWeight: 900,
    padding: '0 18px',
    cursor: 'pointer',
    boxShadow: active ? '0 12px 26px rgba(37,99,235,0.22)' : 'none'
  };
}