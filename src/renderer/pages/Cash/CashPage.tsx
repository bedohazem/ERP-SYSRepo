import { useEffect, useState } from 'react';

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
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const summaryData = await window.api.getCashSummary();
      const movementsData = await window.api.getCashMovements();
      setSummary(summaryData);
      setMovements(movementsData);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function getTypeLabel(type: string) {
    switch (type) {
      case 'sale': return 'بيع';
      case 'sale_return': return 'مرتجع بيع';
      case 'customer_payment': return 'دفعة عميل';
      case 'supplier_payment': return 'دفعة مورد';
      case 'expense': return 'مصروف';
      case 'withdraw': return 'سحب';
      case 'deposit': return 'إيداع';
      default: return type;
    }
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

      {/* Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '14px'
        }}
      >
        <div
          className="glass-card"
          style={{
            padding: '18px',
            borderRadius: '18px',
            display: 'grid',
            gap: '10px',
            border: '1px solid rgba(34,197,94,0.20)'
          }}
        >
          <div style={{ color: '#94a3b8', fontWeight: 800 }}>إجمالي الداخل</div>
          <strong style={{ color: '#34d399', fontSize: '28px' }}>
            {money(summary?.total_in)}
          </strong>
        </div>

        <div
          className="glass-card"
          style={{
            padding: '18px',
            borderRadius: '18px',
            display: 'grid',
            gap: '10px',
            border: '1px solid rgba(239,68,68,0.20)'
          }}
        >
          <div style={{ color: '#94a3b8', fontWeight: 800 }}>إجمالي الخارج</div>
          <strong style={{ color: '#f87171', fontSize: '28px' }}>
            {money(summary?.total_out)}
          </strong>
        </div>

        <div
          className="glass-card"
          style={{
            padding: '18px',
            borderRadius: '18px',
            display: 'grid',
            gap: '10px',
            border: '1px solid rgba(37,99,235,0.20)'
          }}
        >
          <div style={{ color: '#94a3b8', fontWeight: 800 }}>رصيد الخزنة</div>
          <strong style={{ color: '#60a5fa', fontSize: '28px' }}>
            {money(summary?.balance)}
          </strong>
        </div>
      </div>

      {/* Movements Table */}
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

            {!loading && movements.map((item) => (
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
                      background: item.direction === 'in'
                        ? 'rgba(34,197,94,0.10)'
                        : 'rgba(239,68,68,0.10)',
                      border: `1px solid ${item.direction === 'in'
                        ? 'rgba(34,197,94,0.25)'
                        : 'rgba(239,68,68,0.25)'}`
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

                <td style={tdStyle}>{item.payment_method || '—'}</td>
                <td style={tdStyle}>{item.notes || '—'}</td>
                <td style={tdStyle}>{item.created_by_name || '—'}</td>
                <td style={{ ...tdStyle, color: '#94a3b8' }}>{formatDate(item.created_at)}</td>
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