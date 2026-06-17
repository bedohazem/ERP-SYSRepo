import { useEffect, useState } from 'react';
import { getPaymentMethodLabel } from '../../utils/payment-method';

type ReportsData = {
  summary: {
    sales_count: number;
    returns_count: number;
    gross_sales: number;
    total_returns: number;
    loyalty_discounts: number;
    net_sales: number;
    gross_profit_before_discounts: number;
    net_profit_after_discounts: number;
    total_expenses: number;
    total_liability_payments: number;
    final_net_profit: number;
    normal_discounts: number;
    total_discounts: number;
  };
  cashAccounts: Array<{
    payment_method: string;
    label: string;
    total_in: number;
    total_out: number;
    balance: number;
  }>;
  cashTotalCapital: number;
  topProducts: any[];
  dailySales: any[];
  paymentMethods: any[];
  lowStock: any[];
  topCustomers: any[];
};

const emptyReports: ReportsData = {
  summary: {
    sales_count: 0,
    returns_count: 0,
    gross_sales: 0,
    total_returns: 0,
    loyalty_discounts: 0,
    net_sales: 0,
    gross_profit_before_discounts: 0,
    net_profit_after_discounts: 0,
    total_expenses: 0,
    total_liability_payments: 0,
    final_net_profit: 0,
    normal_discounts: 0,
    total_discounts: 0
  },
  cashAccounts: [],
  cashTotalCapital: 0,
  topProducts: [],
  dailySales: [],
  paymentMethods: [],
  lowStock: [],
  topCustomers: []
};

export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [data, setData] = useState<ReportsData>(emptyReports);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function loadReports() {
    setLoading(true);

    try {
      const result = await window.api.getReportsSummary({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined
      });

      setData(result);
    } catch (error) {
      console.error('Failed to load reports:', error);
      setMessage('حدث خطأ أثناء تحميل التقارير');
      setData(emptyReports);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReports();
  }, []);

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
          .reports-body-scroll {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }

          .reports-body-scroll::-webkit-scrollbar {
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
            background: 'rgba(239,68,68,0.95)',
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
            <h2 style={{ margin: '0 0 6px' }}>التقارير</h2>
            <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
              ملخص المبيعات، الأرباح، المرتجعات، وأقل مخزون
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={inputStyle}
            />

            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={inputStyle}
            />

            <button type="button" onClick={loadReports} style={primaryButtonStyle}>
              {loading ? 'جاري التحميل...' : 'تحديث'}
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: '10px',
          minHeight: 0
        }}
      >
        <StatCard
          title="رأس المال الحالي"
          value={money(data.cashTotalCapital)}
          highlight
        />
        <StatCard title="إجمالي المبيعات" value={money(data.summary.gross_sales)} />
        <StatCard title="صافي المبيعات" value={money(data.summary.net_sales)} highlight />
        <StatCard
          title="ربح قبل الخصومات"
          value={money(data.summary.gross_profit_before_discounts)}
        />

        <StatCard
          title="صافي الربح بعد الخصومات"
          value={money(data.summary.net_profit_after_discounts)}
          success
        />

        <StatCard
          title="المصروفات"
          value={money(data.summary.total_expenses)}
          danger
        />

        <StatCard
          title="دفعات الالتزامات"
          value={money(data.summary.total_liability_payments)}
          danger
        />

        <StatCard
          title="صافي الربح النهائي"
          value={money(data.summary.final_net_profit)}
          success
        />

        <StatCard title="إجمالي المرتجعات" value={money(data.summary.total_returns)} danger />
        <StatCard title="عدد الفواتير" value={String(data.summary.sales_count)} />
        <StatCard title="عدد المرتجعات" value={String(data.summary.returns_count)} />
        <StatCard title="خصومات النقاط" value={money(data.summary.loyalty_discounts)} />
        <StatCard title="خصومات عادية" value={money(data.summary.normal_discounts)} />
        <StatCard title="إجمالي الخصومات" value={money(data.summary.total_discounts)} />
      </div>

      <div
        className="reports-body-scroll"
        style={{
          display: 'grid',
          gap: '14px',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          alignContent: 'start',
          paddingBottom: '24px'
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 1.3fr) minmax(300px, 1fr)',
            gap: '14px'
          }}
        >
          <ReportTable
            title="أرصدة الحسابات المالية الحالية"
            emptyText="لا توجد حركات مالية"
            columns={['الحساب المالي', 'إجمالي الداخل', 'إجمالي الخارج', 'الرصيد الحالي']}
            rows={data.cashAccounts.map((x) => [
              x.label || getPaymentMethodLabel(x.payment_method),
              money(x.total_in),
              money(x.total_out),
              money(x.balance)
            ])}
          />
          <ReportTable
            title="أفضل المنتجات مبيعًا"
            emptyText="لا توجد منتجات مباعة"
            columns={['المنتج', 'المقاس', 'اللون', 'الكمية', 'الإجمالي']}
            rows={data.topProducts.map((x) => [
              x.product_name,
              x.size || '—',
              x.color || '—',
              Number(x.net_quantity || 0),
              money(x.net_total)
            ])}
          />

          <ReportTable
            title="طرق الدفع"
            emptyText="لا توجد بيانات"
            columns={['الطريقة', 'العدد', 'الإجمالي']}
            rows={data.paymentMethods.map((x) => [
              getPaymentMethodLabel(x.payment_method),
              x.count,
              money(x.total)
            ])}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)',
            gap: '14px'
          }}
        >
          <ReportTable
            title="مخزون منخفض / نافد"
            emptyText="لا يوجد مخزون منخفض"
            columns={['المنتج', 'باركود', 'المقاس', 'اللون', 'المخزون', 'الحد الأدنى']}
            rows={data.lowStock.map((x) => [
              x.product_name,
              x.barcode || '—',
              x.size || '—',
              x.color || '—',
              Number(x.stock || 0),
              Number(x.min_stock || 0)
            ])}
          />

          <ReportTable
            title="أفضل العملاء"
            emptyText="لا توجد بيانات عملاء"
            columns={['العميل', 'الهاتف', 'عدد الفواتير', 'إجمالي الشراء']}
            rows={data.topCustomers.map((x) => [
              x.name,
              x.phone || '—',
              x.sales_count,
              money(x.total_spent)
            ])}
          />
        </div>

        <ReportTable
          title="مبيعات الأيام"
          emptyText="لا توجد مبيعات في الفترة"
          columns={['اليوم', 'صافي المبيعات']}
          rows={data.dailySales.map((x) => [formatDateOnly(x.day), money(x.total)])}
        />
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  highlight,
  success,
  danger
}: {
  title: string;
  value: string;
  highlight?: boolean;
  success?: boolean;
  danger?: boolean;
}) {
  const color = danger
    ? '#fca5a5'
    : success
      ? '#6ee7b7'
      : highlight
        ? '#bfdbfe'
        : '#e5e7eb';

  return (
    <div className="glass-card" style={statCardStyle}>
      <div style={{ color: '#94a3b8', fontWeight: 800 }}>{title}</div>
      <strong style={{ color, fontSize: '24px' }}>{value}</strong>
    </div>
  );
}

function ReportTable({
  title,
  columns,
  rows,
  emptyText
}: {
  title: string;
  columns: string[];
  rows: any[][];
  emptyText: string;
}) {
  return (
    <div className="glass-card" style={cardStyle}>
      <h3 style={{ margin: '0 0 14px', textAlign: 'right' }}>{title}</h3>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
          <thead>
            <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
              {columns.map((column) => (
                <th key={column} style={thStyle}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    ...tdStyle,
                    textAlign: 'center',
                    color: '#94a3b8',
                    padding: '24px'
                  }}
                >
                  {emptyText}
                </td>
              </tr>
            )}

            {rows.map((row, index) => (
              <tr key={index} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} style={tdStyle}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function money(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`;
}

function formatDateOnly(value?: string) {
  if (!value) return '—';

  try {
    const raw = String(value);
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';

    return new Date(normalized).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch {
    return value;
  }
}

const cardStyle: React.CSSProperties = {
  padding: '14px',
  borderRadius: '16px',
  display: 'grid',
  gap: '10px'
};

const statCardStyle: React.CSSProperties = {
  padding: '14px',
  borderRadius: '16px',
  display: 'grid',
  gap: '8px'
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