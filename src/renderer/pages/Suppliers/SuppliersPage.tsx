import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../store/auth.store';

type Supplier = {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  total_purchased: number;
  balance: number;
  created_at: string;
};

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: ''
};

export default function SuppliersPage() {
  const currentUser = useAuthStore((s) => s.user);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [statementData, setStatementData] = useState<any | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [deletingSupplier, setDeletingSupplier] = useState(false);

  const editingSupplier = useMemo(
    () => suppliers.find((x) => x.id === editingId),
    [suppliers, editingId]
  );

  function showMessage(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(''), 1800);
  }

  async function loadSuppliers(searchValue = search) {
    setLoading(true);

    try {
      const data = await window.api.getSuppliers(searchValue);
      setSuppliers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load suppliers:', error);
      showMessage('حدث خطأ أثناء تحميل الموردين');
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadSuppliers(search);
    }, 250);

    return () => clearTimeout(handle);
  }, [search]);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function startEdit(supplier: Supplier) {
    setEditingId(supplier.id);
    setForm({
      name: supplier.name || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      address: supplier.address || '',
      notes: supplier.notes || ''
    });
  }

  async function saveSupplier() {
    if (saving) return;

    if (!form.name.trim()) {
      showMessage('اسم المورد مطلوب');
      return;
    }

    setSaving(true);

    try {
      if (editingId) {
        await window.api.updateSupplier({
          id: editingId,
          ...form,
          actor_id: currentUser?.id
        });

        showMessage('تم تعديل المورد');
      } else {
        await window.api.createSupplier({
          ...form,
          actor_id: currentUser?.id
        });
        showMessage('تم إضافة المورد');
      }

      setForm(emptyForm);
      setEditingId(null);
      await loadSuppliers();
    } catch (error) {
      console.error('Failed to save supplier:', error);
      showMessage('حدث خطأ أثناء حفظ المورد، تأكد أن رقم الهاتف غير مكرر');
    } finally {
      setSaving(false);
    }
  }

  function requestDeleteSupplier(supplier: Supplier) {
    setDeleteTarget(supplier);
  }

  function cancelDeleteSupplier() {
    if (deletingSupplier) return;
    setDeleteTarget(null);
  }

  async function confirmDeleteSupplier() {
    if (!deleteTarget || deletingSupplier) return;

    const deletedId = deleteTarget.id;

    setDeletingSupplier(true);

    try {
      await window.api.deleteSupplier(deletedId, currentUser?.id);

      if (statementData?.supplier?.id === deletedId) {
        setStatementData(null);
      }

      if (paymentSupplier?.id === deletedId) {
        setPaymentSupplier(null);
        setPaymentAmount('');
        setPaymentNotes('');
      }

      if (editingId === deletedId) {
        setEditingId(null);
        setForm(emptyForm);
      }

      setDeleteTarget(null);
      showMessage('تم حذف المورد');
      await loadSuppliers();
    } catch (error) {
      console.error('Failed to delete supplier:', error);
      showMessage('حدث خطأ أثناء حذف المورد');
    } finally {
      setDeletingSupplier(false);
    }
  }

  async function openStatement(supplier: Supplier) {
    setStatementLoading(true);

    try {
      const data = await window.api.getSupplierStatement(supplier.id);
      setStatementData(data);
    } catch (error) {
      console.error('Failed to load supplier statement:', error);
      showMessage('حدث خطأ أثناء تحميل كشف الحساب');
    } finally {
      setStatementLoading(false);
    }
  }

  function openSupplierPayment(supplier: Supplier) {
    setPaymentSupplier(supplier);
    setPaymentAmount(String(Number(supplier.balance || 0)));
    setPaymentMethod('cash');
    setPaymentNotes('');
  }

  async function saveSupplierPayment() {
    if (!paymentSupplier || savingPayment) return;

    const amount = Number(paymentAmount || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      showMessage('اكتب مبلغ صحيح');
      return;
    }

    setSavingPayment(true);

    try {
      const result = await window.api.recordSupplierPayment({
        supplier_id: paymentSupplier.id,
        amount,
        payment_method: paymentMethod,
        notes: paymentNotes.trim() || null,
        actor_id: currentUser?.id
      });

      showMessage(`تم تسجيل دفعة ${money(result.paid_amount)}`);

      setPaymentSupplier(null);
      setPaymentAmount('');
      setPaymentNotes('');

      await loadSuppliers();

      if (statementData?.supplier?.id === paymentSupplier.id) {
        const data = await window.api.getSupplierStatement(paymentSupplier.id);
        setStatementData(data);
      }
    } catch (error) {
      console.error('Failed to save supplier payment:', error);
      showMessage('حدث خطأ أثناء تسجيل الدفعة');
    } finally {
      setSavingPayment(false);
    }
  }

  function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div
      className="supplier-info-card"
      style={{
        padding: '14px',
        borderRadius: '14px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'grid',
        gap: '8px'
      }}
    >
      <span style={{ color: '#94a3b8', fontWeight: 800 }}>{title}</span>
      <strong style={{ color: '#fff', fontSize: '18px' }}>{value}</strong>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return '—';

  try {
    const raw = String(value);
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';

    return new Date(normalized).toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return value;
  }
}

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      {message && (
        <div
          style={{
            position: 'fixed',
            top: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            padding: '12px 18px',
            borderRadius: '14px',
            background: 'rgba(37,99,235,0.96)',
            color: '#fff',
            fontWeight: 800,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            pointerEvents: 'none'
          }}
        >
          {message}
        </div>
      )}

      <div className="glass-card" style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '14px',
            alignItems: 'center',
            flexWrap: 'wrap',
            direction: 'rtl'
          }}
        >
          <div>
            <h2 style={{ margin: '0 0 6px' }}>إدارة الموردين</h2>
            <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
              إضافة وتعديل بيانات الموردين وتجهيزهم لفواتير الشراء
            </p>
          </div>
        </div>

        <input
          placeholder="بحث باسم المورد / الهاتف / الإيميل / العنوان"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div className="glass-card" style={cardStyle}>
        <h3 style={{ margin: 0, textAlign: 'right' }}>
          {editingId ? `تعديل: ${editingSupplier?.name || ''}` : 'إضافة مورد'}
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: '12px'
          }}
        >
          <Input
            placeholder="اسم المورد"
            value={form.name}
            onChange={(value) => setForm((p) => ({ ...p, name: value }))}
          />

          <Input
            placeholder="رقم الهاتف"
            value={form.phone}
            onChange={(value) => setForm((p) => ({ ...p, phone: value }))}
          />

          <Input
            placeholder="الإيميل"
            value={form.email}
            onChange={(value) => setForm((p) => ({ ...p, email: value }))}
          />

          <Input
            placeholder="العنوان"
            value={form.address}
            onChange={(value) => setForm((p) => ({ ...p, address: value }))}
          />

          <input
            placeholder="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            style={{
              ...inputStyle,
              gridColumn: '1 / -1'
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start' }}>
          <button
            type="button"
            onClick={saveSupplier}
            disabled={saving}
            style={{
              ...primaryButtonStyle,
              opacity: saving ? 0.6 : 1,
              cursor: saving ? 'not-allowed' : 'pointer'
            }}
          >
            {saving ? 'جاري الحفظ...' : editingId ? 'حفظ التعديل' : 'حفظ المورد'}
          </button>

          {editingId && (
            <button type="button" onClick={startCreate} style={secondaryButtonStyle}>
              إلغاء التعديل
            </button>
          )}

          
        </div>
      </div>

      <div
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '18px',
          overflowX: 'auto'
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
          <thead>
            <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
              <th style={thStyle}>المورد</th>
              <th style={thStyle}>الهاتف</th>
              <th style={thStyle}>الإيميل</th>
              <th style={thStyle}>العنوان</th>
              <th style={thStyle}>إجمالي المشتريات</th>
              <th style={thStyle}>الرصيد</th>
              <th style={thStyle}>إجراءات</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} style={{ ...tdStyle, textAlign: 'center' }}>
                  جاري التحميل...
                </td>
              </tr>
            )}

            {!loading &&
              suppliers.map((supplier) => (
                <tr
                  key={supplier.id}
                  style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <td style={tdStyle}>
                    <strong>{supplier.name}</strong>
                    {supplier.notes && (
                      <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
                        {supplier.notes}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>{supplier.phone || '—'}</td>
                  <td style={tdStyle}>{supplier.email || '—'}</td>
                  <td style={tdStyle}>{supplier.address || '—'}</td>
                  <td style={tdStyle}>{money(supplier.total_purchased)}</td>
                  <td
                    style={{
                      ...tdStyle,
                      color: Number(supplier.balance || 0) > 0 ? '#fca5a5' : '#6ee7b7',
                      fontWeight: 900
                    }}
                  >
                    {money(supplier.balance)}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => startEdit(supplier)}
                        style={smallButtonStyle}
                      >
                        تعديل
                      </button>

                      <button
                        type="button"
                        onClick={() => requestDeleteSupplier(supplier)}
                        style={{
                          ...smallButtonStyle,
                          borderColor: '#ef4444',
                          color: '#fca5a5',
                          background: 'rgba(239,68,68,0.10)'
                        }}
                      >
                        حذف
                      </button>

                      <button
                        type="button"
                        onClick={() => openStatement(supplier)}
                        style={smallButtonStyle}
                      >
                        كشف حساب
                      </button>

                      {Number(supplier.balance || 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => openSupplierPayment(supplier)}
                          style={{
                            ...smallButtonStyle,
                            borderColor: '#22c55e',
                            color: '#86efac',
                            background: 'rgba(34,197,94,0.10)'
                          }}
                        >
                          تسجيل دفعة
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

            {!loading && suppliers.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    ...tdStyle,
                    textAlign: 'center',
                    color: '#94a3b8',
                    padding: '28px'
                  }}
                >
                  لا يوجد موردين
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {statementData && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div
            className="theme-modal-card supplier-statement-modal"
            style={{ ...modalStyle, width: '900px' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '18px'
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 6px' }}>
                  كشف حساب: {statementData.supplier?.name}
                </h3>
                <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
                  متابعة فواتير الشراء والدفعات والرصيد الحالي
                </p>
              </div>

              <button
                type="button"
                onClick={() => setStatementData(null)}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
                marginBottom: '18px'
              }}
            >
              <InfoCard title="إجمالي المشتريات" value={money(statementData.summary.total_purchased)} />
              <InfoCard title="إجمالي المدفوع" value={money(statementData.summary.total_paid)} />
              <InfoCard title="الرصيد الحالي" value={money(statementData.summary.balance)} />
              <InfoCard title="فواتير مفتوحة" value={String(statementData.summary.open_purchases)} />
            </div>

            {Number(statementData.summary.balance || 0) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '16px' }}>
                <button
                  type="button"
                  onClick={() =>
                    openSupplierPayment({
                      id: statementData.supplier.id,
                      name: statementData.supplier.name,
                      phone: statementData.supplier.phone,
                      email: statementData.supplier.email,
                      address: statementData.supplier.address,
                      notes: statementData.supplier.notes,
                      total_purchased: statementData.supplier.total_purchased,
                      balance: statementData.supplier.balance,
                      created_at: statementData.supplier.created_at
                    })
                  }
                  style={primaryButtonStyle}
                >
                  تسجيل دفعة
                </button>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
                <thead>
                  <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                    <th style={thStyle}>التاريخ</th>
                    <th style={thStyle}>البيان</th>
                    <th style={thStyle}>مدين</th>
                    <th style={thStyle}>دائن</th>
                    <th style={thStyle}>ملاحظات</th>
                  </tr>
                </thead>

                <tbody>
                  {statementLoading && (
                    <tr>
                      <td colSpan={5} style={{ ...tdStyle, textAlign: 'center' }}>
                        جاري التحميل...
                      </td>
                    </tr>
                  )}

                  {!statementLoading &&
                    statementData.entries.map((entry: any) => (
                      <tr
                        key={entry.id}
                        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                      >
                        <td style={tdStyle}>{formatDate(entry.created_at)}</td>
                        <td style={tdStyle}>
                          <strong>{entry.title}</strong>
                        </td>
                        <td style={{ ...tdStyle, color: entry.debit > 0 ? '#fca5a5' : '#e5e7eb' }}>
                          {entry.debit > 0 ? money(entry.debit) : '—'}
                        </td>
                        <td style={{ ...tdStyle, color: entry.credit > 0 ? '#6ee7b7' : '#e5e7eb' }}>
                          {entry.credit > 0 ? money(entry.credit) : '—'}
                        </td>
                        <td style={tdStyle}>{entry.notes || '—'}</td>
                      </tr>
                    ))}

                  {!statementLoading && statementData.entries.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          ...tdStyle,
                          textAlign: 'center',
                          color: '#94a3b8',
                          padding: '24px'
                        }}
                      >
                        لا توجد حركات
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {paymentSupplier && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div className="theme-modal-card supplier-payment-modal" style={modalStyle}>
            <h3 style={{ margin: '0 0 8px' }}>تسجيل دفعة للمورد</h3>

            <p style={{ margin: '0 0 18px', color: '#94a3b8', fontWeight: 700 }}>
              {paymentSupplier.name}
            </p>

            <div style={{ display: 'grid', gap: '14px' }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>الرصيد الحالي</label>
                <input
                  value={money(paymentSupplier.balance)}
                  readOnly
                  style={{ ...inputStyle, opacity: 0.7 }}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>مبلغ الدفعة</label>
                <input
                  type="number"
                  min={0}
                  max={paymentSupplier.balance}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>طريقة الدفع</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  style={inputStyle}
                >
                  <option value="cash">كاش</option>
                  <option value="card">كارت</option>
                  <option value="wallet">محفظة</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                </select>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>ملاحظات</label>
                <input
                  placeholder="مثال: دفعة من حساب المورد"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-start',
                marginTop: '22px'
              }}
            >
              <button
                type="button"
                onClick={saveSupplierPayment}
                disabled={savingPayment}
                style={{
                  ...primaryButtonStyle,
                  opacity: savingPayment ? 0.6 : 1,
                  cursor: savingPayment ? 'not-allowed' : 'pointer'
                }}
              >
                {savingPayment ? 'جاري الحفظ...' : 'حفظ الدفعة'}
              </button>

              <button
                type="button"
                onClick={() => setPaymentSupplier(null)}
                style={secondaryButtonStyle}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
      

      {deleteTarget && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div className="theme-modal-card supplier-delete-modal" style={modalStyle}>
            <h3 style={{ margin: '0 0 10px' }}>تأكيد حذف المورد</h3>

            <p style={{ margin: '0 0 18px', color: '#94a3b8', lineHeight: 1.8 }}>
              هل أنت متأكد من حذف المورد{' '}
              <strong style={{ color: '#fff' }}>{deleteTarget.name}</strong>؟
            </p>

            <div
              className="theme-danger-panel"
              style={{
                padding: '12px',
                borderRadius: '12px',
                background: 'rgba(239,68,68,0.10)',
                border: '1px solid rgba(239,68,68,0.25)',
                color: '#fca5a5',
                marginBottom: '18px',
                lineHeight: 1.8
              }}
            >
              سيتم إخفاء المورد من القائمة، ولن يظهر في البحث العادي.
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start' }}>
              <button
                type="button"
                className="supplier-delete-confirm-button"
                onClick={confirmDeleteSupplier}
                disabled={deletingSupplier}
                style={{
                  ...primaryButtonStyle,
                  background: 'rgba(239,68,68,0.16)',
                  border: '1px solid rgba(239,68,68,0.35)',
                  color: '#fca5a5',
                  opacity: deletingSupplier ? 0.6 : 1,
                  cursor: deletingSupplier ? 'not-allowed' : 'pointer'
                }}
              >
                {deletingSupplier ? 'جاري الحذف...' : 'تأكيد الحذف'}
              </button>

              <button
                type="button"
                onClick={cancelDeleteSupplier}
                disabled={deletingSupplier}
                style={secondaryButtonStyle}
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

function Input({
  placeholder,
  value,
  onChange
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
    />
  );
}

function money(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`;
}

const cardStyle: React.CSSProperties = {
  padding: '18px',
  borderRadius: '18px',
  display: 'grid',
  gap: '14px'
};

const inputStyle: React.CSSProperties = {
  height: '44px',
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  outline: 'none',
  padding: '0 12px',
  textAlign: 'right',
  direction: 'rtl',
  boxSizing: 'border-box'
};

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  height: '44px',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, #6d5dfc, #7c3aed)',
  color: '#fff',
  fontWeight: 800,
  padding: '0 18px',
  cursor: 'pointer'
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid #7c3aed',
  height: '44px',
  borderRadius: '10px',
  background: 'transparent',
  color: '#c4b5fd',
  fontWeight: 800,
  padding: '0 18px',
  cursor: 'pointer'
};

const smallButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(124,58,237,0.55)',
  borderRadius: '8px',
  background: 'rgba(124,58,237,0.10)',
  color: '#c4b5fd',
  padding: '8px 10px',
  cursor: 'pointer',
  fontWeight: 700
};

const thStyle: React.CSSProperties = {
  padding: '12px',
  fontWeight: 800,
  whiteSpace: 'nowrap'
};

const tdStyle: React.CSSProperties = {
  padding: '12px',
  color: '#e5e7eb',
  whiteSpace: 'nowrap'
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.60)',
  zIndex: 99999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px'
};

const modalStyle: React.CSSProperties = {
  width: '480px',
  maxWidth: '100%',
  maxHeight: '88vh',
  overflowY: 'auto',
  borderRadius: '18px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: '#111827',
  padding: '22px',
  direction: 'rtl',
  boxShadow: '0 24px 70px rgba(0,0,0,0.55)'
};

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: '8px'
};

const labelStyle: React.CSSProperties = {
  color: '#cbd5e1',
  fontWeight: 800
};

const closeButtonStyle: React.CSSProperties = {
  width: '34px',
  height: '34px',
  borderRadius: '50%',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '20px'
};