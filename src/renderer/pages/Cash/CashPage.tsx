import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth.store';

type CashSummary = {
  total_in: number;
  total_out: number;
  balance: number;
};

type CashMovement = {
  id: number;
  type: string;
  direction: 'in' | 'out';
  amount: number;
  payment_method: string;
  notes: string;
  created_at: string;
  created_by_name?: string;
};

export default function CashPage() {
  const currentUser = useAuthStore((s) => s.user);

  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [movementType, setMovementType] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [notes, setNotes] = useState('');

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterDirection, setFilterDirection] = useState<'all' | 'in' | 'out'>('all');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('all');
  const [search, setSearch] = useState('');

  async function loadData() {
    setLoading(true);

    const filters = {
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      type: filterType,
      direction: filterDirection,
      payment_method: filterPaymentMethod,
      search: search || undefined
    };

    try {
      const summaryData = await window.api.getCashSummary(filters);
      const movementsData = await window.api.getCashMovements(filters);

      setSummary(summaryData);
      setMovements(movementsData);
    } catch (error) {
      console.error(error);
      alert('حدث خطأ أثناء تحميل بيانات الخزنة');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateMovement() {
    const parsedAmount = Number(amount);

    if (!parsedAmount || parsedAmount <= 0) {
      alert('اكتب مبلغ صحيح');
      return;
    }

    const direction = movementType === 'deposit' ? 'in' : 'out';

    if (direction === 'out' && summary && parsedAmount > Number(summary.balance || 0)) {
      const confirmed = confirm(
        'المبلغ أكبر من رصيد الخزنة الحالي. هل تريد تسجيل السحب anyway؟'
      );

      if (!confirmed) {
        return;
      }
    }

    setSaving(true);

    try {
      await window.api.createCashMovement({
        type: movementType,
        direction,
        amount: parsedAmount,
        payment_method: paymentMethod,
        reference_id: null,
        reference_type: 'manual',
        notes: notes.trim() || (movementType === 'deposit' ? 'إيداع يدوي' : 'سحب يدوي'),
        created_by: currentUser?.id ?? null
      });

      setMovementType('deposit');
      setAmount('');
      setPaymentMethod('cash');
      setNotes('');

      await loadData();
    } catch (error) {
      console.error(error);
      alert('حدث خطأ أثناء حفظ حركة الخزنة');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function getTypeLabel(type: string) {
    switch (type) {
      case 'sale':
        return 'بيع';
      case 'sale_return':
        return 'مرتجع بيع';
      case 'customer_payment':
        return 'دفعة عميل';
      case 'supplier_payment':
        return 'دفعة مورد';
      case 'expense':
        return 'مصروف';
      case 'withdraw':
        return 'سحب';
      case 'deposit':
        return 'إيداع';
      default:
        return type;
    }
  }

  function getPaymentMethodLabel(value: string) {
    if (value === 'cash') return 'كاش';
    if (value === 'card') return 'كارت';
    if (value === 'wallet') return 'محفظة';
    if (value === 'bank') return 'بنك';
    return value || '—';
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

  function money(value: unknown) {
    return `${Number(value || 0).toFixed(2)} ج.م`;
  }

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '14px'
        }}
      >
        <SummaryCard
          title="إجمالي الداخل"
          value={money(summary?.total_in)}
          color="#34d399"
          border="rgba(34,197,94,0.20)"
        />

        <SummaryCard
          title="إجمالي الخارج"
          value={money(summary?.total_out)}
          color="#f87171"
          border="rgba(239,68,68,0.20)"
        />

        <SummaryCard
          title="رصيد الخزنة"
          value={money(summary?.balance)}
          color="#60a5fa"
          border="rgba(37,99,235,0.20)"
        />
      </div>

      <div
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '18px',
          display: 'grid',
          gap: '16px'
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 6px', textAlign: 'right' }}>إضافة حركة يدوية</h2>
          <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700, textAlign: 'right' }}>
            استخدمها لتسجيل إيداع أو سحب خارج عمليات البيع والشراء.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: '12px',
            alignItems: 'end'
          }}
        >
          <Field label="نوع الحركة">
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value as 'deposit' | 'withdraw')}
              style={inputStyle}
            >
              <option value="deposit">إيداع</option>
              <option value="withdraw">سحب</option>
            </select>
          </Field>

          <Field label="المبلغ">
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={inputStyle}
            />
          </Field>

          <Field label="طريقة الدفع">
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              style={inputStyle}
            >
              <option value="cash">كاش</option>
              <option value="card">كارت</option>
              <option value="wallet">محفظة</option>
              <option value="bank">بنك</option>
            </select>
          </Field>

          <Field label="ملاحظات">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="سبب الإيداع أو السحب"
              style={inputStyle}
            />
          </Field>

          <button
            type="button"
            onClick={handleCreateMovement}
            disabled={saving}
            style={{
              ...primaryButtonStyle,
              opacity: saving ? 0.6 : 1,
              cursor: saving ? 'not-allowed' : 'pointer'
            }}
          >
            {saving ? 'جاري الحفظ...' : 'حفظ الحركة'}
          </button>
        </div>
      </div>

      <div
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '18px',
          display: 'grid',
          gap: '16px'
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 6px', textAlign: 'right' }}>فلترة حركة الخزنة</h2>
          <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700, textAlign: 'right' }}>
            ابحث حسب التاريخ، نوع الحركة، الاتجاه، أو طريقة الدفع.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '12px',
            alignItems: 'end'
          }}
        >
          <Field label="من تاريخ">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={inputStyle}
            />
          </Field>

          <Field label="إلى تاريخ">
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={inputStyle}
            />
          </Field>

          <Field label="نوع العملية">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={inputStyle}
            >
              <option value="all">الكل</option>
              <option value="sale">بيع</option>
              <option value="sale_return">مرتجع بيع</option>
              <option value="customer_payment">دفعة عميل</option>
              <option value="supplier_payment">دفعة مورد</option>
              <option value="expense">مصروف</option>
              <option value="deposit">إيداع</option>
              <option value="withdraw">سحب</option>
            </select>
          </Field>

          <Field label="الاتجاه">
            <select
              value={filterDirection}
              onChange={(e) => setFilterDirection(e.target.value as 'all' | 'in' | 'out')}
              style={inputStyle}
            >
              <option value="all">الكل</option>
              <option value="in">داخل</option>
              <option value="out">خارج</option>
            </select>
          </Field>

          <Field label="طريقة الدفع">
            <select
              value={filterPaymentMethod}
              onChange={(e) => setFilterPaymentMethod(e.target.value)}
              style={inputStyle}
            >
              <option value="all">الكل</option>
              <option value="cash">كاش</option>
              <option value="card">كارت</option>
              <option value="wallet">محفظة</option>
              <option value="bank">بنك</option>
            </select>
          </Field>

          <Field label="بحث">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ملاحظات / مستخدم"
              style={inputStyle}
            />
          </Field>

          <button type="button" onClick={loadData} style={primaryButtonStyle}>
            {loading ? 'جاري التحميل...' : 'تطبيق الفلتر'}
          </button>

          <button
            type="button"
            onClick={() => {
              setDateFrom('');
              setDateTo('');
              setFilterType('all');
              setFilterDirection('all');
              setFilterPaymentMethod('all');
              setSearch('');
              setTimeout(() => void loadData(), 0);
            }}
            style={{
              ...primaryButtonStyle,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)'
            }}
          >
            مسح الفلتر
          </button>
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
        <div style={{ marginBottom: '16px' }}>
          <h2 style={{ margin: '0 0 6px', textAlign: 'right' }}>حركة الخزنة</h2>
          <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700, textAlign: 'right' }}>
            جميع عمليات السحب والإيداع والتحصيل
          </p>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
          <thead>
            <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
              <th style={thStyle}>النوع</th>
              <th style={thStyle}>الحركة</th>
              <th style={thStyle}>المبلغ</th>
              <th style={thStyle}>طريقة الدفع</th>
              <th style={thStyle}>ملاحظات</th>
              <th style={thStyle}>المستخدم</th>
              <th style={thStyle}>التاريخ</th>
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
              movements.map((item) => (
                <tr
                  key={item.id}
                  style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <td style={tdStyle}>{getTypeLabel(item.type)}</td>

                  <td style={tdStyle}>
                    <span
                      style={{
                        display: 'inline-flex',
                        padding: '4px 10px',
                        borderRadius: '999px',
                        fontSize: '12px',
                        fontWeight: 800,
                        color: item.direction === 'in' ? '#34d399' : '#f87171',
                        background:
                          item.direction === 'in'
                            ? 'rgba(34,197,94,0.10)'
                            : 'rgba(239,68,68,0.10)',
                        border: `1px solid ${
                          item.direction === 'in'
                            ? 'rgba(34,197,94,0.25)'
                            : 'rgba(239,68,68,0.25)'
                        }`
                      }}
                    >
                      {item.direction === 'in' ? 'داخل' : 'خارج'}
                    </span>
                  </td>

                  <td
                    style={{
                      ...tdStyle,
                      fontWeight: 900,
                      color: item.direction === 'in' ? '#34d399' : '#f87171'
                    }}
                  >
                    {money(item.amount)}
                  </td>

                  <td style={tdStyle}>{getPaymentMethodLabel(item.payment_method)}</td>
                  <td style={tdStyle}>{item.notes || '—'}</td>
                  <td style={tdStyle}>{item.created_by_name || '—'}</td>
                  <td style={{ ...tdStyle, color: '#94a3b8' }}>
                    {formatDate(item.created_at)}
                  </td>
                </tr>
              ))}

            {!loading && movements.length === 0 && (
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
                  لا توجد حركات خزنة
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  color,
  border
}: {
  title: string;
  value: string;
  color: string;
  border: string;
}) {
  return (
    <div
      className="glass-card"
      style={{
        padding: '18px',
        borderRadius: '18px',
        display: 'grid',
        gap: '10px',
        border: `1px solid ${border}`
      }}
    >
      <div style={{ color: '#94a3b8', fontWeight: 800 }}>{title}</div>
      <strong style={{ color, fontSize: '28px' }}>{value}</strong>
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '44px',
  borderRadius: '12px',
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
  borderRadius: '12px',
  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 18px',
  cursor: 'pointer'
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