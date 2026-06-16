import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../store/auth.store';
import { getPaymentMethodLabel } from '../../utils/payment-method';

type Liability = {
  id: number;
  party_name: string;
  title: string;
  category?: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: 'open' | 'paid' | 'cancelled' | string;
  due_date?: string | null;
  notes?: string | null;
  created_by_name?: string | null;
  payments_count?: number;
  created_at: string;
  updated_at?: string | null;
};

type LiabilityPayment = {
  id: number;
  liability_id: number;
  amount: number;
  payment_method: string;
  notes?: string | null;
  created_by_name?: string | null;
  created_at: string;
};

const emptyForm = {
  party_name: '',
  title: '',
  category: '',
  total_amount: '',
  paid_amount: '',
  payment_method: 'cash',
  due_date: '',
  notes: ''
};

function money(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`;
}

function formatDate(value?: string | null) {
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

function getStatusLabel(status: string) {
  if (status === 'paid') return 'مسدد';
  if (status === 'cancelled') return 'ملغي';
  return 'مفتوح';
}

export default function LiabilitiesPage() {
  const currentUser = useAuthStore((s) => s.user);

  const [items, setItems] = useState<Liability[]>([]);
  const [summary, setSummary] = useState({
    paid_in_period: 0,
    total_liabilities: 0,
    total_paid: 0,
    total_remaining: 0,
    count: 0
  });

  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [paymentTarget, setPaymentTarget] = useState<Liability | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  const [statementData, setStatementData] = useState<{
    liability: Liability;
    payments: LiabilityPayment[];
  } | null>(null);

  const [cancelTarget, setCancelTarget] = useState<Liability | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isLight = document.documentElement.getAttribute('data-theme') === 'light';

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 1800);
  }

  async function loadData() {
    setLoading(true);

    try {
      const [list, nextSummary] = await Promise.all([
        window.api.getLiabilities({
          search,
          status: statusFilter
        }),
        window.api.getLiabilitiesSummary()
      ]);

      setItems(list || []);
      setSummary(nextSummary || {
        paid_in_period: 0,
        total_liabilities: 0,
        total_paid: 0,
        total_remaining: 0,
        count: 0
      });
    } catch (error) {
      console.error(error);
      showMessage('error', 'حدث خطأ أثناء تحميل الالتزامات');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleCreate() {
    const totalAmount = Number(form.total_amount || 0);
    const paidAmount = Number(form.paid_amount || 0);

    if (!form.party_name.trim()) {
      showMessage('error', 'اسم الشخص أو الجهة مطلوب');
      return;
    }

    if (!form.title.trim()) {
      showMessage('error', 'عنوان الالتزام مطلوب');
      return;
    }

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      showMessage('error', 'اكتب إجمالي مبلغ صحيح');
      return;
    }

    if (paidAmount < 0 || paidAmount > totalAmount) {
      showMessage('error', 'المدفوع المبدئي غير صحيح');
      return;
    }

    setSaving(true);

    try {
      const result = await window.api.createLiability({
        party_name: form.party_name.trim(),
        title: form.title.trim(),
        category: form.category.trim() || null,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        payment_method: form.payment_method,
        due_date: form.due_date || null,
        notes: form.notes.trim() || null,
        actor_id: currentUser?.id ?? null
      });

      if (result?.success === false) {
        showMessage('error', result.message || 'تعذر حفظ الالتزام');
        return;
      }

      setForm(emptyForm);
      showMessage('success', 'تم حفظ الالتزام');
      await loadData();
    } catch (error: any) {
      showMessage('error', error.message || 'حدث خطأ أثناء حفظ الالتزام');
    } finally {
      setSaving(false);
    }
  }

  async function handleRecordPayment() {
    if (!paymentTarget) return;

    const amount = Number(paymentAmount || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      showMessage('error', 'اكتب مبلغ دفعة صحيح');
      return;
    }

    if (amount > Number(paymentTarget.remaining_amount || 0)) {
      showMessage('error', 'مبلغ الدفعة أكبر من المتبقي');
      return;
    }

    setSavingPayment(true);

    try {
      const result = await window.api.recordLiabilityPayment({
        liability_id: paymentTarget.id,
        amount,
        payment_method: paymentMethod,
        notes: paymentNotes.trim() || null,
        actor_id: currentUser?.id ?? null
      });

      if (result?.success === false) {
        showMessage('error', result.message || 'تعذر تسجيل الدفعة');
        return;
      }

      setPaymentTarget(null);
      setPaymentAmount('');
      setPaymentMethod('cash');
      setPaymentNotes('');

      showMessage('success', 'تم تسجيل الدفعة');
      await loadData();
    } catch (error: any) {
      showMessage('error', error.message || 'حدث خطأ أثناء تسجيل الدفعة');
    } finally {
      setSavingPayment(false);
    }
  }

  async function openStatement(item: Liability) {
    try {
      const data = await window.api.getLiabilityStatement(item.id);
      setStatementData(data);
    } catch (error) {
      console.error(error);
      showMessage('error', 'تعذر فتح كشف الحساب');
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;

    try {
      const result = await window.api.cancelLiability({
        id: cancelTarget.id,
        actor_id: currentUser?.id ?? null
      });

      if (result?.success === false) {
        showMessage('error', result.message || 'تعذر إلغاء الالتزام');
        return;
      }

      setCancelTarget(null);
      showMessage('success', 'تم إلغاء الالتزام');
      await loadData();
    } catch (error: any) {
      showMessage('error', error.message || 'حدث خطأ أثناء إلغاء الالتزام');
    }
  }

  const openCount = useMemo(
    () => items.filter((item) => item.status === 'open').length,
    [items]
  );

  const paidCount = useMemo(
    () => items.filter((item) => item.status === 'paid').length,
    [items]
  );

  return (
    <div
      style={{
        display: 'grid',
        gap: '12px',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        gridTemplateRows: 'auto auto minmax(0, 1fr)'
      }}
    >
      <style>
        {`
          .liabilities-body-scroll {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }

          .liabilities-body-scroll::-webkit-scrollbar {
            width: 0;
            height: 0;
            display: none;
          }
        `}
      </style>
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
            background: message.type === 'error'
              ? 'rgba(239,68,68,0.95)'
              : 'rgba(16,185,129,0.95)',
            color: '#fff',
            fontWeight: 900,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            pointerEvents: 'none'
          }}
        >
          {message.text}
        </div>
      )}

      <section
        className="glass-card"
        style={{
          padding: '14px',
          display: 'grid',
          gap: '10px',
          minHeight: 0
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>التزامات المحل</h2>
          <p style={{ margin: '8px 0 0', color: isLight ? '#64748b' : '#94a3b8', fontWeight: 700 }}>
            سجل الديون والالتزامات التي على المحل، وسجل الدفعات التي تخصم من صافي الربح.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(150px, 1fr))',
            gap: '12px'
          }}
        >
          <SummaryCard title="إجمالي الالتزامات" value={money(summary.total_liabilities)} />
          <SummaryCard title="إجمالي المدفوع" value={money(summary.total_paid)} />
          <SummaryCard title="المتبقي" value={money(summary.total_remaining)} danger />
          <SummaryCard title="مفتوحة" value={String(openCount)} />
          <SummaryCard title="مسددة" value={String(paidCount)} success />
        </div>
      </section>

      <section
        className="glass-card"
        style={{
          padding: '14px',
          display: 'grid',
          gap: '10px',
          minHeight: 0
        }}
      >
        <h3 style={{ margin: 0 }}>إضافة التزام جديد</h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '12px'
          }}
        >
          <input
            value={form.party_name}
            onChange={(e) => setForm((prev) => ({ ...prev, party_name: e.target.value }))}
            placeholder="اسم الشخص / الجهة"
            style={inputStyle}
          />

          <input
            value={form.title}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="عنوان الالتزام مثال: إيجار / سلفة / كهرباء"
            style={inputStyle}
          />

          <input
            value={form.category}
            onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
            placeholder="التصنيف"
            style={inputStyle}
          />

          <input
            type="date"
            value={form.due_date}
            onChange={(e) => setForm((prev) => ({ ...prev, due_date: e.target.value }))}
            style={inputStyle}
          />

          <input
            type="number"
            value={form.total_amount}
            onChange={(e) => setForm((prev) => ({ ...prev, total_amount: e.target.value }))}
            placeholder="إجمالي المبلغ"
            style={inputStyle}
          />

          <input
            type="number"
            value={form.paid_amount}
            onChange={(e) => setForm((prev) => ({ ...prev, paid_amount: e.target.value }))}
            placeholder="مدفوع مبدئيًا"
            style={inputStyle}
          />

          <select
            value={form.payment_method}
            onChange={(e) => setForm((prev) => ({ ...prev, payment_method: e.target.value }))}
            style={inputStyle}
          >
            <option value="cash">كاش</option>
            <option value="card">كارت / فيزا</option>
            <option value="wallet">محفظة</option>
            <option value="bank">تحويل بنكي / إنستا باي</option>
          </select>

          <input
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="ملاحظات"
            style={inputStyle}
          />
        </div>

        <button
          type="button"
          onClick={handleCreate}
          disabled={saving}
          style={{
            ...primaryButtonStyle,
            width: 'fit-content',
            opacity: saving ? 0.6 : 1
          }}
        >
          {saving ? 'جاري الحفظ...' : 'حفظ الالتزام'}
        </button>
      </section>

      <section
        className="glass-card"
        style={{
          padding: '14px',
          display: 'grid',
          gap: '12px',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          gridTemplateRows: 'auto minmax(0, 1fr)'
        }}
      >
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم الجهة / العنوان / التصنيف"
            style={{ ...inputStyle, flex: 1 }}
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ ...inputStyle, width: '180px' }}
          >
            <option value="all">كل الحالات</option>
            <option value="open">مفتوح</option>
            <option value="paid">مسدد</option>
            <option value="cancelled">ملغي</option>
          </select>

          <button type="button" onClick={loadData} style={secondaryButtonStyle}>
            {loading ? 'تحميل...' : 'تحديث'}
          </button>
        </div>

        <div
          className="liabilities-body-scroll"
          style={{
            overflow: 'auto',
            minHeight: 0,
            height: '100%',
            maxWidth: '100%'
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1050px' }}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>الجهة</Th>
                <Th>الالتزام</Th>
                <Th>التصنيف</Th>
                <Th>الإجمالي</Th>
                <Th>المدفوع</Th>
                <Th>المتبقي</Th>
                <Th>الحالة</Th>
                <Th>الاستحقاق</Th>
                <Th>إجراءات</Th>
              </tr>
            </thead>

            <tbody>
              {items.map((item) => (
                <tr key={item.id} style={{ borderTop: '1px solid rgba(148,163,184,0.16)' }}>
                  <Td>#{item.id}</Td>
                  <Td>{item.party_name}</Td>
                  <Td>
                    <strong>{item.title}</strong>
                    {item.notes ? (
                      <div style={{ color: isLight ? '#64748b' : '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
                        {item.notes}
                      </div>
                    ) : null}
                  </Td>
                  <Td>{item.category || '—'}</Td>
                  <Td>{money(item.total_amount)}</Td>
                  <Td>{money(item.paid_amount)}</Td>
                  <Td>
                    <strong style={{ color: Number(item.remaining_amount) > 0 ? '#ef4444' : '#16a34a' }}>
                      {money(item.remaining_amount)}
                    </strong>
                  </Td>
                  <Td>
                    <span
                      style={{
                        padding: '6px 10px',
                        borderRadius: '999px',
                        fontWeight: 900,
                        color:
                          item.status === 'paid'
                            ? '#16a34a'
                            : item.status === 'cancelled'
                              ? '#ef4444'
                              : '#2563eb',
                        background:
                          item.status === 'paid'
                            ? 'rgba(16,185,129,0.12)'
                            : item.status === 'cancelled'
                              ? 'rgba(239,68,68,0.12)'
                              : 'rgba(37,99,235,0.12)'
                      }}
                    >
                      {getStatusLabel(item.status)}
                    </span>
                  </Td>
                  <Td>{item.due_date || '—'}</Td>
                  <Td>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button type="button" style={smallButtonStyle} onClick={() => openStatement(item)}>
                        كشف
                      </button>

                      {item.status === 'open' && (
                        <button
                          type="button"
                          style={successSmallButtonStyle}
                          onClick={() => {
                            setPaymentTarget(item);
                            setPaymentAmount(String(item.remaining_amount || ''));
                          }}
                        >
                          دفعة
                        </button>
                      )}

                      {item.status === 'open' && Number(item.paid_amount || 0) <= 0 && (
                        <button
                          type="button"
                          style={dangerSmallButtonStyle}
                          onClick={() => setCancelTarget(item)}
                        >
                          إلغاء
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}

              {!items.length && (
                <tr>
                  <td colSpan={10} style={{ padding: '28px', textAlign: 'center', color: '#94a3b8' }}>
                    لا توجد التزامات مسجلة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {paymentTarget && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div className="theme-modal-card" style={modalStyle}>
            <h3 style={{ margin: 0 }}>تسجيل دفعة</h3>

            <p style={{ margin: '8px 0 0', color: '#94a3b8', lineHeight: 1.8 }}>
              {paymentTarget.title} — {paymentTarget.party_name}
              <br />
              المتبقي: {money(paymentTarget.remaining_amount)}
            </p>

            <input
              type="number"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              placeholder="مبلغ الدفعة"
              style={inputStyle}
            />

            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              style={inputStyle}
            >
              <option value="cash">كاش</option>
              <option value="card">كارت / فيزا</option>
              <option value="wallet">محفظة</option>
              <option value="bank">تحويل بنكي / إنستا باي</option>
            </select>

            <input
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="ملاحظات"
              style={inputStyle}
            />

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={handleRecordPayment}
                disabled={savingPayment}
                style={{ ...primaryButtonStyle, flex: 1, opacity: savingPayment ? 0.6 : 1 }}
              >
                {savingPayment ? 'جاري الحفظ...' : 'حفظ الدفعة'}
              </button>

              <button type="button" onClick={() => setPaymentTarget(null)} style={{ ...secondaryButtonStyle, flex: 1 }}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {statementData && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div className="theme-modal-card" style={{ ...modalStyle, width: '760px' }}>
            <button type="button" onClick={() => setStatementData(null)} style={closeButtonStyle}>
              ×
            </button>

            <h3 style={{ margin: 0 }}>كشف حساب الالتزام</h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              <SummaryCard title="الإجمالي" value={money(statementData.liability.total_amount)} />
              <SummaryCard title="المدفوع" value={money(statementData.liability.paid_amount)} success />
              <SummaryCard title="المتبقي" value={money(statementData.liability.remaining_amount)} danger />
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
              {statementData.payments.map((payment) => (
                <div
                  key={payment.id}
                  style={{
                    padding: '12px',
                    borderRadius: '14px',
                    background: isLight ? '#f8fafc' : 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(148,163,184,0.14)',
                    display: 'grid',
                    gap: '6px'
                  }}
                >
                  <strong>{money(payment.amount)}</strong>
                  <span style={{ color: isLight ? '#64748b' : '#94a3b8', fontWeight: 700 }}>
                    {getPaymentMethodLabel(payment.payment_method)} • {formatDate(payment.created_at)} • {payment.created_by_name || '—'}
                  </span>
                  {payment.notes ? <span>{payment.notes}</span> : null}
                </div>
              ))}

              {!statementData.payments.length && (
                <div style={{ color: '#94a3b8', textAlign: 'center', padding: '24px' }}>
                  لا توجد دفعات مسجلة
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {cancelTarget && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div className="theme-modal-card" style={modalStyle}>
            <h3 style={{ margin: 0, color: '#ef4444' }}>تأكيد إلغاء الالتزام</h3>

            <p style={{ margin: 0, color: '#94a3b8', lineHeight: 1.8 }}>
              هل تريد إلغاء الالتزام: <strong>{cancelTarget.title}</strong>؟
            </p>

            <div
              className="theme-danger-panel"
              style={{
                padding: '12px',
                borderRadius: '12px',
                background: 'rgba(239,68,68,0.10)',
                border: '1px solid rgba(239,68,68,0.25)',
                color: '#fca5a5',
                lineHeight: 1.8
              }}
            >
              الإلغاء مسموح فقط للالتزامات التي لا تحتوي على دفعات.
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" onClick={confirmCancel} style={{ ...dangerSmallButtonStyle, flex: 1 }}>
                تأكيد الإلغاء
              </button>

              <button type="button" onClick={() => setCancelTarget(null)} style={{ ...secondaryButtonStyle, flex: 1 }}>
                رجوع
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  danger,
  success
}: {
  title: string;
  value: string;
  danger?: boolean;
  success?: boolean;
}) {
  return (
    <div
      style={{
        padding: '12px',
        borderRadius: '16px',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(148,163,184,0.14)',
        display: 'grid',
        gap: '8px'
      }}
    >
      <span style={{ color: '#94a3b8', fontWeight: 800 }}>{title}</span>
      <strong
        style={{
          fontSize: '18px',
          color: danger ? '#ef4444' : success ? '#16a34a' : 'inherit'
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: '12px', textAlign: 'right', color: '#94a3b8', fontWeight: 900 }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: '12px', verticalAlign: 'middle', fontWeight: 700 }}>
      {children}
    </td>
  );
}

const inputStyle: React.CSSProperties = {
  height: '44px',
  borderRadius: '12px',
  border: '1px solid rgba(148,163,184,0.20)',
  background: 'rgba(255,255,255,0.04)',
  color: 'inherit',
  padding: '0 12px',
  outline: 'none',
  fontWeight: 700
};

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: '12px',
  padding: '12px 18px',
  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
  color: '#fff',
  fontWeight: 900,
  cursor: 'pointer'
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148,163,184,0.20)',
  borderRadius: '12px',
  padding: '12px 18px',
  background: 'rgba(255,255,255,0.05)',
  color: 'inherit',
  fontWeight: 900,
  cursor: 'pointer'
};

const smallButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  padding: '8px 12px'
};

const successSmallButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  background: 'rgba(16,185,129,0.12)',
  borderColor: 'rgba(16,185,129,0.30)',
  color: '#34d399'
};

const dangerSmallButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  background: 'rgba(239,68,68,0.12)',
  borderColor: 'rgba(239,68,68,0.30)',
  color: '#f87171'
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  background: 'rgba(0,0,0,0.55)',
  display: 'grid',
  placeItems: 'center',
  padding: '20px'
};

const modalStyle: React.CSSProperties = {
  width: '460px',
  maxWidth: '96vw',
  maxHeight: '88vh',
  overflow: 'auto',
  background: '#111827',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '18px',
  padding: '20px',
  display: 'grid',
  gap: '14px',
  boxShadow: '0 28px 80px rgba(0,0,0,0.35)'
};

const closeButtonStyle: React.CSSProperties = {
  width: '34px',
  height: '34px',
  borderRadius: '999px',
  border: 'none',
  background: 'rgba(148,163,184,0.12)',
  color: 'inherit',
  cursor: 'pointer',
  fontWeight: 900
};