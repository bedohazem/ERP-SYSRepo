import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

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
  };
  topProducts: any[];
  dailySales: any[];
  paymentMethods: any[];
  lowStock: any[];
  topCustomers: any[];
};

type DashboardState = {
  today: ReportsData;
  month: ReportsData;
  overview: ReportsData;
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
    net_profit_after_discounts: 0
  },
  topProducts: [],
  dailySales: [],
  paymentMethods: [],
  lowStock: [],
  topCustomers: []
};

const emptyDashboard: DashboardState = {
  today: emptyReports,
  month: emptyReports,
  overview: emptyReports
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardState>(emptyDashboard);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');

  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);
  const monthStartKey = useMemo(() => getMonthStartKey(new Date()), []);

  async function loadDashboard() {
    setLoading(true);
    setMessage('');

    try {
      const [today, month, overview] = await Promise.all([
        window.api.getReportsSummary({ date_from: todayKey, date_to: todayKey }),
        window.api.getReportsSummary({ date_from: monthStartKey, date_to: todayKey }),
        window.api.getReportsSummary()
      ]);

      setData({ today, month, overview });

      setLastUpdated(
        new Date().toLocaleTimeString('ar-EG', {
          hour: '2-digit',
          minute: '2-digit'
        })
      );
    } catch (error) {
      console.error('Failed to load dashboard:', error);
      setData(emptyDashboard);
      setMessage('حدث خطأ أثناء تحميل لوحة التحكم');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  const bestProduct = data.month.topProducts[0];
  const bestCustomer = data.month.topCustomers[0];
  const lowStockCount = data.overview.lowStock.length;

  return (
    <div className="fade-slide-in" style={{ display: 'grid', gap: '18px' }}>
      {message ? <Toast>{message}</Toast> : null}

      <section className="glass-card" style={heroStyle}>
        <div style={{ display: 'grid', gap: '8px' }}>
          <div style={{ color: '#93c5fd', fontWeight: 900 }}>نظرة عامة</div>

          <h2 style={{ margin: 0, fontSize: '30px' }}>
            أداء المحل اليوم والشهر الحالي
          </h2>

          <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700, lineHeight: 1.8 }}>
            ملخص سريع للمبيعات، الأرباح، المرتجعات، أفضل المنتجات، والتنبيهات المهمة.
          </p>

          <div style={{ color: '#64748b', fontSize: '13px', fontWeight: 700 }}>
            {lastUpdated ? `آخر تحديث: ${lastUpdated}` : 'يتم تحميل البيانات الآن...'}
          </div>
        </div>

        <div style={heroActionsStyle}>
          <button type="button" onClick={loadDashboard} style={primaryButtonStyle}>
            {loading ? 'جاري التحديث...' : 'تحديث البيانات'}
          </button>

          <button type="button" onClick={() => navigate('/sales')} style={secondaryButtonStyle}>
            فاتورة بيع جديدة
          </button>
        </div>
      </section>

      <section style={statsGridStyle}>
        <StatCard
          icon="☀️"
          title="مبيعات اليوم"
          value={money(data.today.summary.net_sales)}
          subtitle={`${data.today.summary.sales_count} فاتورة`}
          tone="blue"
        />

        <StatCard
          icon="📅"
          title="مبيعات الشهر"
          value={money(data.month.summary.net_sales)}
          subtitle={`${data.month.summary.sales_count} فاتورة منذ بداية الشهر`}
          tone="violet"
        />

        <StatCard
          icon="💰"
          title="صافي ربح الشهر"
          value={money(data.month.summary.net_profit_after_discounts)}
          subtitle="بعد الخصومات والمرتجعات"
          tone="green"
        />

        <StatCard
          icon="↩️"
          title="مرتجعات الشهر"
          value={money(data.month.summary.total_returns)}
          subtitle={`${data.month.summary.returns_count} عملية مرتجع`}
          tone="red"
        />

        <StatCard
          icon="⚠️"
          title="تنبيهات المخزون"
          value={String(lowStockCount)}
          subtitle="منتجات وصلت للحد الأدنى أو أقل"
          tone={lowStockCount > 0 ? 'amber' : 'green'}
        />

        <StatCard
          icon="🎁"
          title="خصومات النقاط"
          value={money(data.month.summary.loyalty_discounts)}
          subtitle="إجمالي خصومات الولاء هذا الشهر"
          tone="slate"
        />
      </section>

      <section style={mainGridStyle}>
        <div className="glass-card" style={cardStyle}>
          <SectionHeader
            title="مبيعات آخر الأيام"
            subtitle="صافي المبيعات اليومية خلال الشهر الحالي"
            action={
              <button type="button" onClick={() => navigate('/reports')} style={ghostButtonStyle}>
                التقارير
              </button>
            }
          />

          <DailySalesChart rows={data.month.dailySales} />
        </div>

        <div className="glass-card" style={cardStyle}>
          <SectionHeader title="أهم المؤشرات" subtitle="أفضل منتج وعميل خلال الشهر" />

          <InsightCard
            icon="🏆"
            title="أفضل منتج"
            value={bestProduct?.product_name || 'لا توجد مبيعات بعد'}
            meta={
              bestProduct
                ? `${Number(bestProduct.net_quantity || 0)} قطعة • ${money(bestProduct.net_total)}`
                : 'ابدأ بتسجيل فواتير البيع لظهور البيانات'
            }
          />

          <InsightCard
            icon="👤"
            title="أفضل عميل"
            value={bestCustomer?.name || 'لا توجد بيانات عملاء'}
            meta={
              bestCustomer
                ? `${bestCustomer.sales_count} فاتورة • ${money(bestCustomer.total_spent)}`
                : 'اربط الفواتير بالعملاء لعرض أفضل العملاء'
            }
          />

          <PaymentBreakdown rows={data.month.paymentMethods} />
        </div>
      </section>

      <section style={bottomGridStyle}>
        <DashboardTable
          title="منتجات تحتاج متابعة"
          emptyText="المخزون تمام، لا توجد تنبيهات حالياً"
          columns={['المنتج', 'باركود', 'المقاس', 'اللون', 'المخزون', 'الحد الأدنى']}
          rows={data.overview.lowStock.slice(0, 8).map((item) => [
            item.product_name,
            item.barcode || '—',
            item.size || '—',
            item.color || '—',
            Number(item.stock || 0),
            Number(item.min_stock || 0)
          ])}
          actionLabel="فتح المخزون"
          onAction={() => navigate('/inventory')}
        />

        <div className="glass-card" style={cardStyle}>
          <SectionHeader title="اختصارات سريعة" subtitle="أكثر العمليات استخدامًا" />

          <div style={{ display: 'grid', gap: '10px' }}>
            <QuickAction
              icon="🧾"
              title="بيع جديد"
              subtitle="إنشاء فاتورة بيع"
              onClick={() => navigate('/sales')}
            />

            <QuickAction
              icon="👕"
              title="إضافة أو تعديل منتج"
              subtitle="إدارة المنتجات والباركود"
              onClick={() => navigate('/products')}
            />

            <QuickAction
              icon="🛒"
              title="فاتورة شراء"
              subtitle="تسجيل مشتريات من مورد"
              onClick={() => navigate('/purchases')}
            />

            <QuickAction
              icon="📊"
              title="تحليل مفصل"
              subtitle="فتح صفحة التقارير الكاملة"
              onClick={() => navigate('/reports')}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  tone
}: {
  icon: string;
  title: string;
  value: string;
  subtitle: string;
  tone: 'blue' | 'violet' | 'green' | 'red' | 'amber' | 'slate';
}) {
  const toneStyle = toneStyles[tone];

  return (
    <div className="glass-card hover-lift" style={statCardStyle}>
      <div style={{ ...iconBoxStyle, background: toneStyle.background, color: toneStyle.color }}>
        {icon}
      </div>

      <div style={{ color: '#94a3b8', fontWeight: 800 }}>{title}</div>

      <strong style={{ color: '#f8fafc', fontSize: '24px' }}>{value}</strong>

      <div style={{ color: '#64748b', fontWeight: 700, fontSize: '13px' }}>
        {subtitle}
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap'
      }}
    >
      <div>
        <h3 style={{ margin: '0 0 6px', fontSize: '20px' }}>{title}</h3>

        {subtitle ? (
          <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
            {subtitle}
          </p>
        ) : null}
      </div>

      {action}
    </div>
  );
}

function DailySalesChart({ rows }: { rows: any[] }) {
  const visibleRows = rows.slice(-14);
  const maxValue = Math.max(...visibleRows.map((row) => Number(row.total || 0)), 0);

  if (!visibleRows.length) {
    return <EmptyState text="لا توجد مبيعات مسجلة خلال الشهر الحالي" />;
  }

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {visibleRows.map((row) => {
        const total = Number(row.total || 0);
        const width = maxValue > 0 ? Math.max((total / maxValue) * 100, 4) : 4;

        return (
          <div key={row.day} style={{ display: 'grid', gap: '7px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                color: '#cbd5e1',
                fontWeight: 800,
                fontSize: '13px'
              }}
            >
              <span>{formatDateOnly(row.day)}</span>
              <span>{money(total)}</span>
            </div>

            <div style={barTrackStyle}>
              <div style={{ ...barFillStyle, width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InsightCard({
  icon,
  title,
  value,
  meta
}: {
  icon: string;
  title: string;
  value: string;
  meta: string;
}) {
  return (
    <div style={insightStyle}>
      <div style={smallIconStyle}>{icon}</div>

      <div style={{ minWidth: 0 }}>
        <div style={{ color: '#94a3b8', fontWeight: 800, marginBottom: '4px' }}>
          {title}
        </div>

        <div
          style={{
            color: '#f8fafc',
            fontWeight: 900,
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {value}
        </div>

        <div style={{ color: '#64748b', fontSize: '13px', fontWeight: 700, marginTop: '4px' }}>
          {meta}
        </div>
      </div>
    </div>
  );
}

function PaymentBreakdown({ rows }: { rows: any[] }) {
  if (!rows.length) {
    return <EmptyState text="لا توجد بيانات طرق دفع حتى الآن" />;
  }

  const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <h4 style={{ margin: '8px 0 0', color: '#cbd5e1' }}>
        طرق الدفع هذا الشهر
      </h4>

      {rows.map((row) => {
        const rowTotal = Number(row.total || 0);
        const percent = total > 0 ? Math.round((rowTotal / total) * 100) : 0;

        return (
          <div key={row.payment_method} style={paymentRowStyle}>
            <span>{paymentName(row.payment_method)}</span>
            <strong>{money(rowTotal)}</strong>
            <span style={{ color: '#94a3b8' }}>{percent}%</span>
          </div>
        );
      })}
    </div>
  );
}

function DashboardTable({
  title,
  columns,
  rows,
  emptyText,
  actionLabel,
  onAction
}: {
  title: string;
  columns: string[];
  rows: any[][];
  emptyText: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="glass-card" style={cardStyle}>
      <SectionHeader
        title={title}
        action={
          actionLabel && onAction ? (
            <button type="button" onClick={onAction} style={ghostButtonStyle}>
              {actionLabel}
            </button>
          ) : undefined
        }
      />

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
            {rows.length === 0 ? (
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
            ) : (
              rows.map((row, index) => (
                <tr key={index} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} style={tdStyle}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  title,
  subtitle,
  onClick
}: {
  icon: string;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={quickActionStyle}>
      <span style={smallIconStyle}>{icon}</span>

      <span style={{ display: 'grid', gap: '4px', textAlign: 'right' }}>
        <strong style={{ color: '#f8fafc' }}>{title}</strong>
        <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: '13px' }}>
          {subtitle}
        </span>
      </span>
    </button>
  );
}

function Toast({ children }: { children: ReactNode }) {
  return <div style={toastStyle}>{children}</div>;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ padding: '26px', textAlign: 'center', color: '#94a3b8', fontWeight: 800 }}>
      {text}
    </div>
  );
}

function money(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`;
}

function paymentName(value: string) {
  if (value === 'cash') return 'كاش';
  if (value === 'card') return 'كارت';
  if (value === 'wallet') return 'محفظة';
  return value || 'كاش';
}

function formatDateOnly(value?: string) {
  if (!value) return '—';

  try {
    const raw = String(value);
    const normalized = raw.includes('T') ? raw : `${raw}T00:00:00`;

    return new Date(normalized).toLocaleDateString('ar-EG', {
      month: 'short',
      day: '2-digit'
    });
  } catch {
    return value;
  }
}

function getLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getMonthStartKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${year}-${month}-01`;
}

const toneStyles = {
  blue: { background: 'rgba(59,130,246,0.16)', color: '#93c5fd' },
  violet: { background: 'rgba(139,92,246,0.16)', color: '#c4b5fd' },
  green: { background: 'rgba(16,185,129,0.16)', color: '#6ee7b7' },
  red: { background: 'rgba(239,68,68,0.16)', color: '#fca5a5' },
  amber: { background: 'rgba(245,158,11,0.16)', color: '#fcd34d' },
  slate: { background: 'rgba(148,163,184,0.12)', color: '#cbd5e1' }
};

const heroStyle: CSSProperties = {
  padding: '22px',
  borderRadius: '24px',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '18px',
  alignItems: 'center',
  background:
    'linear-gradient(135deg, rgba(37,99,235,0.22), rgba(139,92,246,0.12)), rgba(17,24,39,0.78)'
};

const heroActionsStyle: CSSProperties = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  justifyContent: 'flex-end'
};

const statsGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px'
};

const mainGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: '18px'
};

const bottomGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: '18px'
};

const cardStyle: CSSProperties = {
  padding: '18px',
  borderRadius: '20px',
  display: 'grid',
  gap: '16px'
};

const statCardStyle: CSSProperties = {
  padding: '18px',
  borderRadius: '20px',
  display: 'grid',
  gap: '9px',
  minHeight: '154px'
};

const iconBoxStyle: CSSProperties = {
  width: '42px',
  height: '42px',
  borderRadius: '14px',
  display: 'grid',
  placeItems: 'center',
  fontSize: '20px'
};

const smallIconStyle: CSSProperties = {
  width: '42px',
  height: '42px',
  borderRadius: '14px',
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  flexShrink: 0
};

const primaryButtonStyle: CSSProperties = {
  border: 'none',
  minHeight: '44px',
  borderRadius: '12px',
  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 18px',
  cursor: 'pointer'
};

const secondaryButtonStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  minHeight: '44px',
  borderRadius: '12px',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 18px',
  cursor: 'pointer'
};

const ghostButtonStyle: CSSProperties = {
  border: '1px solid rgba(96,165,250,0.28)',
  minHeight: '38px',
  borderRadius: '10px',
  background: 'rgba(37,99,235,0.12)',
  color: '#93c5fd',
  fontWeight: 900,
  padding: '0 14px',
  cursor: 'pointer'
};

const insightStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '42px minmax(0, 1fr)',
  gap: '12px',
  alignItems: 'center',
  padding: '14px',
  borderRadius: '16px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.06)'
};

const paymentRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 46px',
  gap: '10px',
  alignItems: 'center',
  padding: '12px',
  borderRadius: '14px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.06)',
  fontWeight: 800
};

const quickActionStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '42px minmax(0, 1fr)',
  alignItems: 'center',
  gap: '12px',
  width: '100%',
  padding: '13px',
  borderRadius: '16px',
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)',
  color: '#fff',
  cursor: 'pointer'
};

const barTrackStyle: CSSProperties = {
  height: '12px',
  borderRadius: '999px',
  background: 'rgba(255,255,255,0.06)',
  overflow: 'hidden'
};

const barFillStyle: CSSProperties = {
  height: '100%',
  borderRadius: '999px',
  background: 'linear-gradient(90deg, #2563eb, #8b5cf6)',
  transition: 'width 0.25s ease'
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

const toastStyle: CSSProperties = {
  position: 'fixed',
  top: '24px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 99999,
  padding: '12px 18px',
  borderRadius: '14px',
  background: 'rgba(239,68,68,0.95)',
  color: '#fff',
  fontWeight: 900,
  boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
  pointerEvents: 'none'
};