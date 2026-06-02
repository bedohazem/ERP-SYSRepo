import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAuthStore } from '../../store/auth.store';

type Role = 'admin' | 'cashier';

type UserForm = {
  id?: number;
  name: string;
  username: string;
  password: string;
  role: Role;
  is_active: number;
};

const emptyForm: UserForm = {
  name: '',
  username: '',
  password: '',
  role: 'cashier',
  is_active: 1
};

export default function UsersPage() {
  const currentUser = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [passwordUser, setPasswordUser] = useState<SystemUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [activeConfirmUser, setActiveConfirmUser] = useState<SystemUser | null>(null);
  const [savingActive, setSavingActive] = useState(false);
  const [pageMessage, setPageMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  function showMessage(type: 'success' | 'error', text: string) {
    setPageMessage({ type, text });

    setTimeout(() => {
      setPageMessage(null);
    }, 1800);
  }


  const isAdmin = currentUser?.role === 'admin';
  const editing = Boolean(form.id);

  const filteredUsers = useMemo(() => users, [users]);

  async function loadUsers() {
    setLoading(true);

    try {
      const result = await window.api.getUsers({
        search,
        actor_id: currentUser?.id
      });

      if (!result.success) {
        showMessage('error', result.message || 'غير مصرح بتحميل المستخدمين');
        setUsers([]);
        return;
      }

      setUsers(result.users);
    } catch (error) {
      console.error('Failed to load users:', error);
      showMessage('error', 'حدث خطأ أثناء تحميل المستخدمين');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      showMessage('error', 'اكتب اسم المستخدم');
      return;
    }

    if (!form.username.trim()) {
      showMessage('error', 'اكتب اسم الدخول');
      return;
    }

    if (!editing && form.password.trim().length < 4) {
      showMessage('error', 'كلمة المرور يجب ألا تقل عن 4 أحرف');
      return;
    }

    setSaving(true);

    try {
      const result = editing
        ? await window.api.updateSystemUser({
            id: Number(form.id),
            name: form.name,
            username: form.username,
            role: form.role,
            is_active: form.is_active,
            actor_id: currentUser?.id
          })
        : await window.api.createSystemUser({
            name: form.name,
            username: form.username,
            password: form.password,
            role: form.role,
            actor_id: currentUser?.id
          });

      if (!result.success) {
        showMessage('error', result.message || 'فشل حفظ المستخدم');
        return;
      }

      showMessage('success', editing ? 'تم حفظ تعديل المستخدم بنجاح' : 'تم إضافة المستخدم بنجاح');
      setForm(emptyForm);
      await loadUsers();
    } catch (error) {
      console.error('Failed to save user:', error);
      showMessage('error', 'حدث خطأ أثناء حفظ المستخدم');
    } finally {
      setSaving(false);
    }
  }

  function openActiveConfirm(user: SystemUser) {
    const nextActive = user.is_active ? 0 : 1;

    if (user.id === currentUser?.id && nextActive === 0) {
      showMessage('error', 'لا يمكنك تعطيل حسابك الحالي');
      return;
    }

    setActiveConfirmUser(user);
  }

  function closeActiveConfirm() {
    if (savingActive) return;
    setActiveConfirmUser(null);
  }

  async function confirmToggleActive() {
    if (!activeConfirmUser) return;
    if (savingActive) return;

    const nextActive = activeConfirmUser.is_active ? 0 : 1;

    setSavingActive(true);

    try {
      const result = await window.api.setUserActive(
        activeConfirmUser.id,
        nextActive,
        currentUser?.id
      );

      if (!result.success) {
        showMessage('error', result.message || 'فشل تحديث حالة المستخدم');
        return;
      }

      showMessage(
        'success',
        nextActive ? 'تم تفعيل المستخدم بنجاح' : 'تم تعطيل المستخدم بنجاح'
      );

      setActiveConfirmUser(null);
      await loadUsers();
    } catch (error) {
      console.error('Failed to update user active state:', error);
      showMessage('error', 'حدث خطأ أثناء تحديث حالة المستخدم');
    } finally {
      setSavingActive(false);
    }
  }

  function openPasswordModal(user: SystemUser) {
    setPasswordUser(user);
    setNewPassword('');
    setConfirmPassword('');
  }

  function closePasswordModal() {
    setPasswordUser(null);
    setNewPassword('');
    setConfirmPassword('');
  }

  async function saveNewPassword() {
    if (!passwordUser) return;
    if (savingPassword) return;

    const password = newPassword.trim();

    if (password.length < 4) {
      showMessage('error', 'كلمة المرور يجب ألا تقل عن 4 أحرف');
      return;
    }

    if (password !== confirmPassword.trim()) {
      showMessage('error', 'كلمة المرور وتأكيدها غير متطابقين');
      return;
    }

    setSavingPassword(true);

    try {
     const result = await window.api.resetUserPassword(
      passwordUser.id,
      password,
      currentUser?.id
    );

      if (!result.success) {
        showMessage('error', result.message || 'فشل تغيير كلمة المرور');
        return;
      }

      closePasswordModal();
      showMessage('success', 'تم تغيير كلمة المرور بنجاح');
    } catch (error) {
      console.error('Failed to reset password:', error);
      showMessage('error', 'حدث خطأ أثناء تغيير كلمة المرور');
    } finally {
      setSavingPassword(false);
    }
  }

  function startEdit(user: SystemUser) {
    setForm({
      id: user.id,
      name: user.name,
      username: user.username,
      password: '',
      role: user.role === 'admin' ? 'admin' : 'cashier',
      is_active: user.is_active ? 1 : 0
    });
  }

  function resetForm() {
    setForm(emptyForm);
  }

  useEffect(() => {
    if (isAdmin) {
      void loadUsers();
    }
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="glass-card" style={accessDeniedStyle}>
        <div style={{ fontSize: '42px' }}>🔒</div>
        <h2 style={{ margin: 0 }}>غير مصرح</h2>
        <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
          هذه الصفحة متاحة لمدير النظام فقط.
        </p>
      </div>
    );
  }

  return (
    <div className="fade-slide-in" style={{ display: 'grid', gap: '18px' }}>
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
      <section className="glass-card" style={headerStyle}>
        <div>
          <h2 style={{ margin: '0 0 8px' }}>إدارة المستخدمين</h2>
          <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
            إضافة وتعديل المستخدمين وتحديد صلاحيات المدير والكاشير.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو username"
            style={inputStyle}
          />

          <button type="button" onClick={loadUsers} style={secondaryButtonStyle}>
            {loading ? 'جاري التحميل...' : 'بحث'}
          </button>
        </div>
      </section>

      <section style={layoutStyle}>
        <div className="glass-card" style={cardStyle}>
          <h3 style={{ margin: 0 }}>{editing ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}</h3>

          <div style={formGridStyle}>
            <Field label="الاسم">
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="مثال: أحمد محمد"
                style={inputStyle}
              />
            </Field>

            <Field label="اسم الدخول">
              <input
                value={form.username}
                onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                placeholder="مثال: ahmed"
                style={inputStyle}
              />
            </Field>

            {!editing ? (
              <Field label="كلمة المرور">
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="4 أحرف على الأقل"
                  style={inputStyle}
                />
              </Field>
            ) : null}

            <Field label="الصلاحية">
              <select
                value={form.role}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, role: e.target.value as Role }))
                }
                style={inputStyle}
              >
                <option value="cashier">كاشير</option>
                <option value="admin">مدير النظام</option>
              </select>
            </Field>

            {editing ? (
              <Field label="الحالة">
                <select
                  value={form.is_active}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, is_active: Number(e.target.value) }))
                  }
                  style={inputStyle}
                >
                  <option value={1}>مفعل</option>
                  <option value={0}>متوقف</option>
                </select>
              </Field>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" onClick={handleSave} disabled={saving} style={primaryButtonStyle}>
              {saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديل' : 'إضافة المستخدم'}
            </button>

            {editing ? (
              <button type="button" onClick={resetForm} style={secondaryButtonStyle}>
                إلغاء التعديل
              </button>
            ) : null}
          </div>
        </div>

        <div className="glass-card" style={cardStyle}>
          <h3 style={{ margin: 0 }}>قائمة المستخدمين</h3>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>الاسم</th>
                  <th style={thStyle}>Username</th>
                  <th style={thStyle}>الصلاحية</th>
                  <th style={thStyle}>الحالة</th>
                  <th style={thStyle}>إجراءات</th>
                </tr>
              </thead>

              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        ...tdStyle,
                        textAlign: 'center',
                        color: '#94a3b8',
                        padding: '26px'
                      }}
                    >
                      لا يوجد مستخدمين
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr key={user.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <td style={tdStyle}>{user.id}</td>
                      <td style={tdStyle}>{user.name}</td>
                      <td style={tdStyle}>{user.username}</td>
                      <td style={tdStyle}>
                        <span style={user.role === 'admin' ? adminBadgeStyle : cashierBadgeStyle}>
                          {user.role === 'admin' ? 'مدير' : 'كاشير'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={user.is_active ? activeBadgeStyle : inactiveBadgeStyle}>
                          {user.is_active ? 'مفعل' : 'متوقف'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button type="button" onClick={() => startEdit(user)} style={smallButtonStyle}>
                            تعديل
                          </button>

                          <button
                            type="button"
                            onClick={() => openPasswordModal(user)}
                            style={smallButtonStyle}
                          >
                            كلمة المرور
                          </button>

                          <button
                            type="button"
                            onClick={() => openActiveConfirm(user)}
                            style={user.is_active ? dangerButtonStyle : successButtonStyle}
                          >
                            {user.is_active ? 'تعطيل' : 'تفعيل'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {passwordUser && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div className="theme-modal-card user-password-modal" style={modalStyle}>
                  <h3 style={{ margin: '0 0 8px' }}>تغيير كلمة المرور</h3>

            <p style={{ margin: '0 0 18px', color: '#94a3b8', fontWeight: 700 }}>
              المستخدم: {passwordUser.name} - {passwordUser.username}
            </p>

            <div style={{ display: 'grid', gap: '14px' }}>
              <Field label="كلمة المرور الجديدة">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="4 أحرف على الأقل"
                  style={inputStyle}
                  autoFocus
                />
              </Field>

              <Field label="تأكيد كلمة المرور">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="أعد كتابة كلمة المرور"
                  style={inputStyle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void saveNewPassword();
                    }
                  }}
                />
              </Field>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void saveNewPassword()}
                disabled={savingPassword}
                style={{
                  ...primaryButtonStyle,
                  opacity: savingPassword ? 0.6 : 1,
                  cursor: savingPassword ? 'not-allowed' : 'pointer'
                }}
              >
                {savingPassword ? 'جاري الحفظ...' : 'حفظ كلمة المرور'}
              </button>

              <button type="button" onClick={closePasswordModal} style={secondaryButtonStyle}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {activeConfirmUser && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div className="theme-modal-card user-active-modal" style={modalStyle}>
            <h3
              className={`user-active-title ${
                activeConfirmUser.is_active ? 'disable' : 'enable'
              }`}
              style={{ margin: '0 0 8px' }}
            >
              {activeConfirmUser.is_active ? 'تعطيل مستخدم' : 'تفعيل مستخدم'}
            </h3>

            <p style={{ margin: '0 0 18px', color: '#94a3b8', fontWeight: 700, lineHeight: 1.8 }}>
              هل أنت متأكد من {activeConfirmUser.is_active ? 'تعطيل' : 'تفعيل'} المستخدم:
              <br />
              <span style={{ color: '#fff' }}>
                {activeConfirmUser.name} - {activeConfirmUser.username}
              </span>
            </p>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
              <button
                type="button"
                  className={`user-active-action ${
                    activeConfirmUser.is_active ? 'disable' : 'enable'
                  }`}
                onClick={() => void confirmToggleActive()}
                disabled={savingActive}
                style={{
                  ...(activeConfirmUser.is_active ? dangerButtonStyle : successButtonStyle),
                  opacity: savingActive ? 0.6 : 1,
                  cursor: savingActive ? 'not-allowed' : 'pointer'
                }}
              >
                {savingActive
                  ? 'جاري الحفظ...'
                  : activeConfirmUser.is_active
                    ? 'تعطيل المستخدم'
                    : 'تفعيل المستخدم'}
              </button>

              <button type="button" onClick={closeActiveConfirm} style={secondaryButtonStyle}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: '8px' }}>
      <span style={{ color: '#cbd5e1', fontWeight: 800 }}>{label}</span>
      {children}
    </label>
  );
}

const accessDeniedStyle: CSSProperties = {
  padding: '40px',
  borderRadius: '24px',
  minHeight: '300px',
  display: 'grid',
  placeItems: 'center',
  textAlign: 'center',
  gap: '12px'
};

const headerStyle: CSSProperties = {
  padding: '20px',
  borderRadius: '22px',
  display: 'flex',
  justifyContent: 'space-between',
  gap: '16px',
  alignItems: 'center',
  flexWrap: 'wrap'
};

const layoutStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(300px, 420px) minmax(420px, 1fr)',
  gap: '18px',
  alignItems: 'start'
};

const cardStyle: CSSProperties = {
  padding: '18px',
  borderRadius: '20px',
  display: 'grid',
  gap: '16px'
};

const formGridStyle: CSSProperties = {
  display: 'grid',
  gap: '14px'
};

const inputStyle: CSSProperties = {
  height: '44px',
  borderRadius: '12px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  outline: 'none',
  padding: '0 12px',
  textAlign: 'right',
  direction: 'rtl',
  boxSizing: 'border-box',
  minWidth: '220px'
};

const primaryButtonStyle: CSSProperties = {
  border: 'none',
  height: '44px',
  borderRadius: '12px',
  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 18px',
  cursor: 'pointer'
};

const secondaryButtonStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  height: '44px',
  borderRadius: '12px',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 18px',
  cursor: 'pointer'
};

const smallButtonStyle: CSSProperties = {
  border: '1px solid rgba(96,165,250,0.28)',
  minHeight: '34px',
  borderRadius: '10px',
  background: 'rgba(37,99,235,0.12)',
  color: '#93c5fd',
  fontWeight: 900,
  padding: '0 10px',
  cursor: 'pointer'
};

const dangerButtonStyle: CSSProperties = {
  ...smallButtonStyle,
  border: '1px solid rgba(239,68,68,0.32)',
  background: 'rgba(239,68,68,0.12)',
  color: '#fca5a5'
};

const successButtonStyle: CSSProperties = {
  ...smallButtonStyle,
  border: '1px solid rgba(16,185,129,0.32)',
  background: 'rgba(16,185,129,0.12)',
  color: '#6ee7b7'
};

const thStyle: CSSProperties = {
  padding: '12px',
  fontWeight: 900,
  whiteSpace: 'nowrap'
};

const tdStyle: CSSProperties = {
  padding: '12px',
  color: '#e5e7eb',
  whiteSpace: 'nowrap'
};

const adminBadgeStyle: CSSProperties = {
  padding: '5px 10px',
  borderRadius: '999px',
  background: 'rgba(139,92,246,0.16)',
  color: '#c4b5fd',
  fontWeight: 900
};

const cashierBadgeStyle: CSSProperties = {
  padding: '5px 10px',
  borderRadius: '999px',
  background: 'rgba(59,130,246,0.16)',
  color: '#93c5fd',
  fontWeight: 900
};

const activeBadgeStyle: CSSProperties = {
  padding: '5px 10px',
  borderRadius: '999px',
  background: 'rgba(16,185,129,0.16)',
  color: '#6ee7b7',
  fontWeight: 900
};

const inactiveBadgeStyle: CSSProperties = {
  padding: '5px 10px',
  borderRadius: '999px',
  background: 'rgba(239,68,68,0.16)',
  color: '#fca5a5',
  fontWeight: 900
};

const modalOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.60)',
  zIndex: 99999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px'
};

const modalStyle: CSSProperties = {
  width: '460px',
  maxWidth: '100%',
  borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: '#111827',
  padding: '22px',
  direction: 'rtl',
  boxShadow: '0 24px 70px rgba(0,0,0,0.55)'
};