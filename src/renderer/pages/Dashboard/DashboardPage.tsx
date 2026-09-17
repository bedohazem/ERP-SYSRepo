import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPaymentMethodLabel } from '../../utils/payment-method'
import { useAuthStore } from '../../store/auth.store'

type ReportsData = {
  summary: {
    sales_count: number
    returns_count: number
    gross_sales: number
    total_returns: number
    normal_discounts: number
    loyalty_discounts: number
    total_discounts: number
    net_sales: number
    gross_profit_before_discounts: number
    net_profit_after_discounts: number
    total_expenses: number
    total_liability_payments: number
    final_net_profit: number
    cancelled_sales_count: number
    cancelled_returns_count: number
    exchange_count: number
    exchange_adjustment: number
    exchange_cash_collection: number
    exchange_cash_refund: number
    exchange_debt_reduction: number
    exchange_discount_adjustment: number
  }
  cashAccounts: Array<{
    payment_method: string
    label: string
    total_in: number
    total_out: number
    balance: number
  }>
  cashTotalCapital: number
  topProducts: any[]
  dailySales: any[]
  paymentMethods: any[]
  lowStock: any[]
  topCustomers: any[]
}

type DashboardState = {
  today: ReportsData
  month: ReportsData
  overview: ReportsData
}

type CashierDashboardSummary = {
  date: string

  shift: {
    id: number

    status: 'open' | 'closed'

    opening_counted_amount: number

    opened_at: string

    closed_at: string | null
  } | null

  sales: {
    invoices_count: number
    cancelled_invoices_count: number

    invoice_sales: number

    returns_count: number
    cancelled_returns_count: number
    returns_total: number

    exchanges_count: number
    cancelled_exchanges_count: number
    exchange_adjustment: number
    exchange_cash_collection: number
    exchange_cash_refund: number

    exchange_cash_difference: number

    exchange_debt_reduction: number
    net_sales: number
  }

  discounts: {
    normal: number
    promotion: number
    loyalty: number
    total: number
  }

  operations: {
    customer_payments_count: number
    customer_payments_total: number
    cancelled_customer_payments_count: number

    expenses_count: number
    cancelled_expenses_count: number
    expenses_total: number

    stock_count_sessions_count: number
  }
}

const emptyCashierDashboard: CashierDashboardSummary = {
  date: '',
  shift: null,
  sales: {
    invoices_count: 0,
    cancelled_invoices_count: 0,

    invoice_sales: 0,

    returns_count: 0,
    cancelled_returns_count: 0,
    returns_total: 0,

    exchanges_count: 0,
    cancelled_exchanges_count: 0,
    exchange_adjustment: 0,
    exchange_cash_collection: 0,
    exchange_cash_refund: 0,

    exchange_cash_difference: 0,

    exchange_debt_reduction: 0,
    net_sales: 0,
  },

  discounts: {
    normal: 0,
    promotion: 0,
    loyalty: 0,
    total: 0,
  },

  operations: {
    customer_payments_count: 0,
    customer_payments_total: 0,
    cancelled_customer_payments_count: 0,

    expenses_count: 0,
    cancelled_expenses_count: 0,
    expenses_total: 0,

    stock_count_sessions_count: 0,
  },
}

const emptyReports: ReportsData = {
  summary: {
    sales_count: 0,
    returns_count: 0,
    gross_sales: 0,
    total_returns: 0,
    normal_discounts: 0,
    loyalty_discounts: 0,
    total_discounts: 0,
    net_sales: 0,
    gross_profit_before_discounts: 0,
    net_profit_after_discounts: 0,
    total_expenses: 0,
    total_liability_payments: 0,
    final_net_profit: 0,
    cancelled_sales_count: 0,
    cancelled_returns_count: 0,
    exchange_count: 0,
    exchange_adjustment: 0,
    exchange_cash_collection: 0,
    exchange_cash_refund: 0,
    exchange_debt_reduction: 0,
    exchange_discount_adjustment: 0,
  },
  cashAccounts: [],
  cashTotalCapital: 0,
  topProducts: [],
  dailySales: [],
  paymentMethods: [],
  lowStock: [],
  topCustomers: [],
}

const emptyDashboard: DashboardState = {
  today: emptyReports,
  month: emptyReports,
  overview: emptyReports,
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isCashier = user?.role !== 'admin'
  const [data, setData] = useState<DashboardState>(emptyDashboard)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')

  const [cashierSummary, setCashierSummary] = useState<CashierDashboardSummary>(
    emptyCashierDashboard,
  )

  const [todayKey, setTodayKey] = useState(() => getLocalDateKey(new Date()))

  const [monthStartKey, setMonthStartKey] = useState(() =>
    getMonthStartKey(new Date()),
  )

  async function loadDashboard(silent = false) {
    if (!silent) {
      setLoading(true)
    }
    setMessage('')

    try {
      if (isCashier) {
        const result = await window.api.getCashierDashboardSummary()

        setCashierSummary(result)
      } else {
        const [today, month, overview] = await Promise.all([
          window.api.getReportsSummary({
            date_from: todayKey,

            date_to: todayKey,
          }),

          window.api.getReportsSummary({
            date_from: monthStartKey,

            date_to: todayKey,
          }),

          window.api.getReportsSummary(),
        ])

        setData({
          today,
          month,
          overview,
        })
      }

      setLastUpdated(
        new Date().toLocaleTimeString('ar-EG', {
          hour: '2-digit',

          minute: '2-digit',
        }),
      )
    } catch (error) {
      console.error('Failed to load dashboard:', error)

      if (isCashier) {
        setCashierSummary(emptyCashierDashboard)
      } else {
        setData(emptyDashboard)
      }

      setMessage('حدث خطأ أثناء تحميل لوحة التحكم')
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date()

      setTodayKey(getLocalDateKey(now))
      setMonthStartKey(getMonthStartKey(now))
    }, 60_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!user?.id || !isCashier) {
      return
    }

    void loadDashboard()

    /*
     * لو تم قفل الشفت وفتح
     * شفت جديد، الشاشة تتغير
     * تلقائيًا حتى لو المستخدم
     * فضل واقف على الـDashboard.
     */
    const timer = window.setInterval(() => {
      void loadDashboard(true)
    }, 15_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [user?.id, isCashier])

  useEffect(() => {
    if (!user?.id || isCashier) return

    void loadDashboard()
  }, [user?.id, isCashier, todayKey])

  const bestProduct = data.month.topProducts[0]
  const bestCustomer = data.month.topCustomers[0]
  const lowStockCount = data.overview.lowStock.length

  if (isCashier) {
    return (
      <CashierRevenueView
        cashierName={user?.name || user?.username || 'الكاشير'}
        summary={cashierSummary}
        lastUpdated={lastUpdated}
        loading={loading}
        onNewSale={() => navigate('/sales')}
        onInvoices={() => navigate('/invoices')}
        onCustomers={() => navigate('/customers')}
        onExpenses={() => navigate('/expenses')}
        onStockCount={() => navigate('/stock-count')}
      />
    )
  }

  return (
    <div className="fade-slide-in" style={{ display: 'grid', gap: '18px' }}>
      {message ? <Toast>{message}</Toast> : null}

      <section className="glass-card" style={heroStyle}>
        <div style={{ display: 'grid', gap: '8px' }}>
          <div style={{ color: '#93c5fd', fontWeight: 900 }}>نظرة عامة</div>

          <h2 style={{ margin: 0, fontSize: '30px' }}>
            أداء المحل اليوم والشهر الحالي
          </h2>

          <p
            style={{
              margin: 0,
              color: '#94a3b8',
              fontWeight: 700,
              lineHeight: 1.8,
            }}
          >
            ملخص سريع للمبيعات، الأرباح، المرتجعات، أفضل المنتجات، والتنبيهات
            المهمة.
          </p>

          <div style={{ color: '#64748b', fontSize: '13px', fontWeight: 700 }}>
            {lastUpdated
              ? `آخر تحديث: ${lastUpdated}`
              : 'يتم تحميل البيانات الآن...'}
          </div>
        </div>

        <div style={heroActionsStyle}>
          <button
            type="button"
            onClick={() => {
              void loadDashboard()
            }}
            style={primaryButtonStyle}
          >
            {loading ? 'جاري التحديث...' : 'تحديث البيانات'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/sales')}
            style={secondaryButtonStyle}
          >
            فاتورة بيع جديدة
          </button>
        </div>
      </section>

      <section style={statsGridStyle}>
        <StatCard
          icon="🏦"
          title="رأس المال الحالي"
          value={money(data.overview.cashTotalCapital)}
          subtitle="إجمالي أرصدة الحسابات المالية"
          tone="amber"
        />
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
          title="صافي الربح النهائي"
          value={money(data.month.summary.final_net_profit)}
          subtitle="بعد الخصومات والمرتجعات والاستبدالات والمصروفات"
          tone="green"
        />

        <StatCard
          icon="💳"
          title="مصروفات الشهر"
          value={money(data.month.summary.total_expenses)}
          subtitle="إجمالي المصروفات المسجلة"
          tone="red"
        />

        <StatCard
          icon="📌"
          title="دفعات الالتزامات"
          value={money(data.month.summary.total_liability_payments)}
          subtitle="سداد ديون والتزامات المحل"
          tone="amber"
        />

        <StatCard
          icon="↩️"
          title="مرتجعات الشهر"
          value={money(data.month.summary.total_returns)}
          subtitle={`${data.month.summary.returns_count} عملية مرتجع`}
          tone="red"
        />

        <StatCard
          icon="🔄"
          title="استبدالات الشهر"
          value={String(data.month.summary.exchange_count || 0)}
          subtitle={`صافي الفروق: ${money(
            data.month.summary.exchange_adjustment || 0,
          )}`}
          tone="violet"
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
              <button
                type="button"
                onClick={() => navigate('/reports')}
                style={ghostButtonStyle}
              >
                التقارير
              </button>
            }
          />

          <DailySalesChart rows={data.month.dailySales} />
        </div>

        <div className="glass-card" style={cardStyle}>
          <SectionHeader
            title="أهم المؤشرات"
            subtitle="أفضل منتج وعميل خلال الشهر"
          />

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
          title="أرصدة الحسابات المالية"
          emptyText="لا توجد حركات مالية"
          columns={['الحساب المالي', 'الرصيد الحالي']}
          rows={data.overview.cashAccounts.map((account) => [
            account.label || getPaymentMethodLabel(account.payment_method),
            money(account.balance),
          ])}
          actionLabel="فتح الخزنة"
          onAction={() => navigate('/cash')}
        />
        <DashboardTable
          title="منتجات تحتاج متابعة"
          emptyText="المخزون تمام، لا توجد تنبيهات حالياً"
          columns={[
            'المنتج',
            'باركود',
            'المقاس',
            'اللون',
            'المخزون',
            'الحد الأدنى',
          ]}
          rows={data.overview.lowStock
            .slice(0, 8)
            .map((item) => [
              item.product_name,
              item.barcode || '—',
              item.size || '—',
              item.color || '—',
              Number(item.stock || 0),
              Number(item.min_stock || 0),
            ])}
          actionLabel="فتح المخزون"
          onAction={() => navigate('/inventory')}
        />

        <div className="glass-card" style={cardStyle}>
          <SectionHeader
            title="اختصارات سريعة"
            subtitle="أكثر العمليات استخدامًا"
          />

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
              icon="📌"
              title="التزامات المحل"
              subtitle="إضافة التزام أو تسجيل دفعة"
              onClick={() => navigate('/liabilities')}
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
  )
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  tone,
}: {
  icon: string
  title: string
  value: string
  subtitle: string
  tone: 'blue' | 'violet' | 'green' | 'red' | 'amber' | 'slate'
}) {
  const toneStyle = toneStyles[tone]

  return (
    <div className="glass-card hover-lift" style={statCardStyle}>
      <div
        style={{
          ...iconBoxStyle,
          background: toneStyle.background,
          color: toneStyle.color,
        }}
      >
        {icon}
      </div>

      <div style={{ color: '#94a3b8', fontWeight: 800 }}>{title}</div>

      <strong style={{ color: '#f8fafc', fontSize: '24px' }}>{value}</strong>

      <div style={{ color: '#64748b', fontWeight: 700, fontSize: '13px' }}>
        {subtitle}
      </div>
    </div>
  )
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
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
  )
}

function DailySalesChart({ rows }: { rows: any[] }) {
  const visibleRows = rows.slice(-14)
  const maxValue = Math.max(
    ...visibleRows.map((row) => Number(row.total || 0)),
    0,
  )

  if (!visibleRows.length) {
    return <EmptyState text="لا توجد مبيعات مسجلة خلال الشهر الحالي" />
  }

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {visibleRows.map((row) => {
        const total = Number(row.total || 0)
        const width = maxValue > 0 ? Math.max((total / maxValue) * 100, 4) : 4

        return (
          <div key={row.day} style={{ display: 'grid', gap: '7px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                color: '#cbd5e1',
                fontWeight: 800,
                fontSize: '13px',
              }}
            >
              <span>{formatDateOnly(row.day)}</span>
              <span>{money(total)}</span>
            </div>

            <div style={barTrackStyle}>
              <div style={{ ...barFillStyle, width: `${width}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function InsightCard({
  icon,
  title,
  value,
  meta,
}: {
  icon: string
  title: string
  value: string
  meta: string
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
            textOverflow: 'ellipsis',
          }}
        >
          {value}
        </div>

        <div
          style={{
            color: '#64748b',
            fontSize: '13px',
            fontWeight: 700,
            marginTop: '4px',
          }}
        >
          {meta}
        </div>
      </div>
    </div>
  )
}

function PaymentBreakdown({ rows }: { rows: any[] }) {
  if (!rows.length) {
    return <EmptyState text="لا توجد بيانات طرق دفع حتى الآن" />
  }

  const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0)

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <h4 style={{ margin: '8px 0 0', color: '#cbd5e1' }}>
        طرق الدفع هذا الشهر
      </h4>

      {rows.map((row) => {
        const rowTotal = Number(row.total || 0)
        const percent = total > 0 ? Math.round((rowTotal / total) * 100) : 0

        return (
          <div key={row.payment_method} style={paymentRowStyle}>
            <span>{getPaymentMethodLabel(row.payment_method)}</span>
            <strong>{money(rowTotal)}</strong>
            <span style={{ color: '#94a3b8' }}>{percent}%</span>
          </div>
        )
      })}
    </div>
  )
}

function DashboardTable({
  title,
  columns,
  rows,
  emptyText,
  actionLabel,
  onAction,
}: {
  title: string
  columns: string[]
  rows: any[][]
  emptyText: string
  actionLabel?: string
  onAction?: () => void
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
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            direction: 'rtl',
          }}
        >
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
                    padding: '24px',
                  }}
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={index}
                  style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                >
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
  )
}

function QuickAction({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: string
  title: string
  subtitle: string
  onClick: () => void
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
  )
}

function Toast({ children }: { children: ReactNode }) {
  return <div style={toastStyle}>{children}</div>
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '26px',
        textAlign: 'center',
        color: '#94a3b8',
        fontWeight: 800,
      }}
    >
      {text}
    </div>
  )
}

function money(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`
}

function formatShiftTime(value?: string | null) {
  if (!value) {
    return '—'
  }

  try {
    const raw = String(value)

    const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(raw)

    const normalized = hasTimezone ? raw : `${raw.replace(' ', 'T')}Z`

    const date = new Date(normalized)

    if (Number.isNaN(date.getTime())) {
      return raw
    }

    return date.toLocaleTimeString('ar-EG', {
      hour: '2-digit',

      minute: '2-digit',
    })
  } catch {
    return String(value)
  }
}

function formatDateOnly(value?: string) {
  if (!value) return '—'

  try {
    const raw = String(value)
    const normalized = raw.includes('T') ? raw : `${raw}T00:00:00`

    return new Date(normalized).toLocaleDateString('ar-EG', {
      month: 'short',
      day: '2-digit',
    })
  } catch {
    return value
  }
}

function getLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getMonthStartKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')

  return `${year}-${month}-01`
}

const toneStyles = {
  blue: { background: 'rgba(59,130,246,0.16)', color: '#93c5fd' },
  violet: { background: 'rgba(139,92,246,0.16)', color: '#c4b5fd' },
  green: { background: 'rgba(16,185,129,0.16)', color: '#6ee7b7' },
  red: { background: 'rgba(239,68,68,0.16)', color: '#fca5a5' },
  amber: { background: 'rgba(245,158,11,0.16)', color: '#fcd34d' },
  slate: { background: 'rgba(148,163,184,0.12)', color: '#cbd5e1' },
}

const heroStyle: CSSProperties = {
  padding: '22px',
  borderRadius: '24px',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '18px',
  alignItems: 'center',
  background:
    'linear-gradient(135deg, rgba(37,99,235,0.22), rgba(139,92,246,0.12)), rgba(17,24,39,0.78)',
}

const heroActionsStyle: CSSProperties = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
}

const statsGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px',
}

const mainGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: '18px',
}

const bottomGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: '18px',
}

const cardStyle: CSSProperties = {
  padding: '18px',
  borderRadius: '20px',
  display: 'grid',
  gap: '16px',
}

const statCardStyle: CSSProperties = {
  padding: '18px',
  borderRadius: '20px',
  display: 'grid',
  gap: '9px',
  minHeight: '154px',
}

const iconBoxStyle: CSSProperties = {
  width: '42px',
  height: '42px',
  borderRadius: '14px',
  display: 'grid',
  placeItems: 'center',
  fontSize: '20px',
}

const smallIconStyle: CSSProperties = {
  width: '42px',
  height: '42px',
  borderRadius: '14px',
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  flexShrink: 0,
}

const primaryButtonStyle: CSSProperties = {
  border: 'none',
  minHeight: '44px',
  borderRadius: '12px',
  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 18px',
  cursor: 'pointer',
}

const secondaryButtonStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  minHeight: '44px',
  borderRadius: '12px',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 18px',
  cursor: 'pointer',
}

const ghostButtonStyle: CSSProperties = {
  border: '1px solid rgba(96,165,250,0.28)',
  minHeight: '38px',
  borderRadius: '10px',
  background: 'rgba(37,99,235,0.12)',
  color: '#93c5fd',
  fontWeight: 900,
  padding: '0 14px',
  cursor: 'pointer',
}

const insightStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '42px minmax(0, 1fr)',
  gap: '12px',
  alignItems: 'center',
  padding: '14px',
  borderRadius: '16px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.06)',
}

const paymentRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 46px',
  gap: '10px',
  alignItems: 'center',
  padding: '12px',
  borderRadius: '14px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.06)',
  fontWeight: 800,
}

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
  cursor: 'pointer',
}

const barTrackStyle: CSSProperties = {
  height: '12px',
  borderRadius: '999px',
  background: 'rgba(255,255,255,0.06)',
  overflow: 'hidden',
}

const barFillStyle: CSSProperties = {
  height: '100%',
  borderRadius: '999px',
  background: 'linear-gradient(90deg, #2563eb, #8b5cf6)',
  transition: 'width 0.25s ease',
}

const thStyle: CSSProperties = {
  padding: '12px',
  fontWeight: 900,
  whiteSpace: 'nowrap',
}

const tdStyle: CSSProperties = {
  padding: '12px',
  color: '#e5e7eb',
  whiteSpace: 'nowrap',
}

const toastStyle: CSSProperties = {
  position: 'fixed',
  top: '24px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 1000001,
  padding: '12px 18px',
  borderRadius: '14px',
  background: 'rgba(239,68,68,0.95)',
  color: '#fff',
  fontWeight: 900,
  boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
  pointerEvents: 'none',
}

function CashierRevenueView({
  cashierName,
  summary,
  lastUpdated,
  loading,
  onNewSale,
  onInvoices,
  onCustomers,
  onExpenses,
  onStockCount,
}: {
  cashierName: string

  summary: CashierDashboardSummary

  lastUpdated: string
  loading: boolean

  onNewSale: () => void
  onInvoices: () => void
  onCustomers: () => void
  onExpenses: () => void
  onStockCount: () => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: '18px',
      }}
    >
      <section
        className="glass-card"
        style={{
          padding: '22px',
          borderRadius: '22px',
          display: 'grid',
          gap: '18px',
          direction: 'rtl',
        }}
      >
        <div
          style={{
            display: 'flex',

            justifyContent: 'space-between',

            gap: '14px',

            alignItems: 'center',

            flexWrap: 'wrap',
          }}
        >
          <div>
            <div
              style={{
                color: '#93c5fd',

                fontWeight: 900,

                marginBottom: '6px',
              }}
            >
              ملخص عمل الكاشير
            </div>

            <h2
              style={{
                margin: 0,

                fontSize: '28px',
              }}
            >
              {cashierName}
            </h2>

            <div
              style={{
                display: 'flex',

                alignItems: 'center',

                gap: '8px',

                marginTop: '10px',

                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',

                  alignItems: 'center',

                  gap: '7px',

                  padding: '7px 12px',

                  borderRadius: '999px',

                  background: summary.shift
                    ? 'rgba(34,197,94,0.10)'
                    : 'rgba(239,68,68,0.10)',

                  border: summary.shift
                    ? '1px solid rgba(34,197,94,0.28)'
                    : '1px solid rgba(239,68,68,0.28)',

                  color: summary.shift ? '#86efac' : '#fca5a5',

                  fontWeight: 900,

                  fontSize: '13px',
                }}
              >
                <span>{summary.shift ? '●' : '○'}</span>

                {summary.shift
                  ? `الشفت المفتوح #${summary.shift.id}`
                  : 'لا يوجد شفت مفتوح'}
              </span>

              {summary.shift && (
                <span
                  style={{
                    color: '#94a3b8',

                    fontWeight: 800,

                    fontSize: '13px',
                  }}
                >
                  بدأ الساعة {formatShiftTime(summary.shift.opened_at)}
                </span>
              )}
            </div>

            <p
              style={{
                margin: '6px 0 0',

                color: '#64748b',

                fontWeight: 700,
              }}
            >
              {lastUpdated
                ? `آخر تحديث: ${lastUpdated}`
                : 'يتم تحميل البيانات...'}
            </p>
          </div>

          <div
            style={{
              display: 'flex',

              gap: '10px',

              flexWrap: 'wrap',

              alignItems: 'flex-end',
            }}
          >
            <button
              type="button"
              onClick={onNewSale}
              style={primaryButtonStyle}
            >
              فاتورة جديدة
            </button>
          </div>
        </div>

        <div
          style={{
            padding: '22px',

            borderRadius: '22px',

            background:
              'linear-gradient(135deg, rgba(34,197,94,0.20), rgba(37,99,235,0.12))',

            border: '1px solid rgba(34,197,94,0.24)',

            display: 'grid',

            gap: '18px',
          }}
        >
          <div
            style={{
              textAlign: 'center',
            }}
          >
            <div
              style={{
                color: '#bbf7d0',

                fontWeight: 900,

                marginBottom: '8px',
              }}
            >
              صافي المبيعات
            </div>

            <strong
              style={{
                display: 'block',

                fontSize: '42px',

                color: '#fff',
              }}
            >
              {money(summary.sales.net_sales)}
            </strong>
          </div>

          <div
            style={{
              display: 'grid',

              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',

              gap: '10px',
            }}
          >
            <ReconciliationCard
              title="مبيعات الفواتير"
              value={money(summary.sales.invoice_sales)}
            />

            <ReconciliationCard
              title="تعديل قيمة المبيعات بالاستبدال"
              value={signedMoney(summary.sales.exchange_adjustment)}
            />

            <ReconciliationCard
              title="المرتجعات"
              value={money(-summary.sales.returns_total)}
            />

            <ReconciliationCard
              title="الناتج"
              value={money(summary.sales.net_sales)}
              strong
            />
          </div>

          <div
            style={{
              color: '#94a3b8',

              fontWeight: 800,

              textAlign: 'center',

              fontSize: '13px',
            }}
          >
            مبيعات الفواتير
            {' + '}
            تعديل قيمة المبيعات بالاستبدال
            {' - '}
            المرتجعات
            {' = '}
            صافي المبيعات
          </div>
        </div>
      </section>

      <section>
        <SectionHeader
          title="ملخص الحركة"
          subtitle="الأرقام المالية بعد الإلغاء والمرتجعات والاستبدالات"
        />

        <CashierMiniCard
          title="رصيد بداية الشفت"
          value={
            summary.shift ? money(summary.shift.opening_counted_amount) : '—'
          }
          subtitle={
            summary.shift
              ? `شفت #${summary.shift.id} • ${
                  summary.shift.status === 'open' ? 'مفتوح حاليًا' : 'مغلق'
                }`
              : 'لا يوجد شفت مسجل في هذا اليوم'
          }
          tone="blue"
        />

        <div
          style={{
            ...statsGridStyle,
            marginTop: '12px',
          }}
        >
          <CashierMiniCard
            title="فواتير البيع"
            value={String(summary.sales.invoices_count)}
            subtitle={`ملغاة: ${summary.sales.cancelled_invoices_count}`}
            tone="blue"
          />

          <CashierMiniCard
            title="مبيعات الفواتير"
            value={money(summary.sales.invoice_sales)}
            subtitle="قيمة الفواتير بعد الخصومات وقبل المرتجعات والاستبدالات"
            tone="green"
          />

          <CashierMiniCard
            title="المرتجعات"
            value={money(summary.sales.returns_total)}
            subtitle={`${summary.sales.returns_count} عملية • ملغاة: ${
              summary.sales.cancelled_returns_count
            }`}
            tone="red"
          />

          <CashierMiniCard
            title="الاستبدالات"
            value={signedMoney(summary.sales.exchange_adjustment)}
            subtitle={`${summary.sales.exchanges_count} عملية • ملغاة: ${
              summary.sales.cancelled_exchanges_count
            }`}
            tone="violet"
          />

          <CashierMiniCard
            title="فرق الاستبدال النقدي"
            value={signedMoney(summary.sales.exchange_cash_difference)}
            subtitle={
              `${summary.sales.exchanges_count} عملية` +
              ` • تخفيض مديونية: ${money(
                summary.sales.exchange_debt_reduction,
              )}` +
              ` • تعديل قيمة البيع: ${signedMoney(
                summary.sales.exchange_adjustment,
              )}` +
              ` • ملغاة: ${summary.sales.cancelled_exchanges_count}`
            }
          />

          <CashierMiniCard
            title="المصروفات المسجلة"
            value={money(summary.operations.expenses_total)}
            subtitle={`${summary.operations.expenses_count} عملية • ملغاة: ${
              summary.operations.cancelled_expenses_count
            }`}
            tone="blue"
          />

          <CashierMiniCard
            title="دفعات العملاء"
            value={money(summary.operations.customer_payments_total)}
            subtitle={`${
              summary.operations.customer_payments_count
            } دفعة • ملغاة: ${
              summary.operations.cancelled_customer_payments_count
            }`}
            tone="blue"
          />

          <CashierMiniCard
            title="جلسات الجرد"
            value={String(summary.operations.stock_count_sessions_count)}
            subtitle="جلسات الجرد التي عملت عليها خلال الشفت"
            tone="blue"
          />
        </div>
      </section>

      <section className="glass-card" style={cardStyle}>
        <SectionHeader
          title="اختصارات الكاشير"
          subtitle="كل العمليات المتاحة لك من مكان واحد"
        />

        <div
          style={{
            display: 'grid',

            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',

            gap: '10px',
          }}
        >
          <QuickAction
            icon="🧾"
            title="فاتورة جديدة"
            subtitle="إنشاء فاتورة بيع"
            onClick={onNewSale}
          />

          <QuickAction
            icon="📄"
            title="سجل الفواتير"
            subtitle="مرتجع أو استبدال أو إلغاء"
            onClick={onInvoices}
          />

          <QuickAction
            icon="👤"
            title="العملاء"
            subtitle="دفعة عميل وكشف الحساب"
            onClick={onCustomers}
          />

          <QuickAction
            icon="💳"
            title="المصروفات"
            subtitle="إضافة ومراجعة مصروفاتك"
            onClick={onExpenses}
          />

          <QuickAction
            icon="🧮"
            title="الجرد"
            subtitle="بدء أو استكمال جلسة جرد"
            onClick={onStockCount}
          />
        </div>
      </section>
    </div>
  )
}

function ReconciliationCard({
  title,
  value,
  strong,
}: {
  title: string
  value: string
  strong?: boolean
}) {
  return (
    <div
      style={{
        padding: '14px',

        borderRadius: '14px',

        background: strong ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.045)',

        border: strong
          ? '1px solid rgba(34,197,94,0.28)'
          : '1px solid rgba(255,255,255,0.07)',

        display: 'grid',

        gap: '6px',

        textAlign: 'center',
      }}
    >
      <span
        style={{
          color: '#94a3b8',

          fontWeight: 800,

          fontSize: '12px',
        }}
      >
        {title}
      </span>

      <strong
        style={{
          color: strong ? '#86efac' : '#f8fafc',

          fontSize: '18px',
        }}
      >
        {value}
      </strong>
    </div>
  )
}

function signedMoney(value: unknown) {
  const amount = Number(value || 0)

  return `${amount > 0 ? '+' : ''}${amount.toFixed(2)} ج.م`
}

function CashierMiniCard({
  title,
  value,
  subtitle,
  tone = 'blue',
}: {
  title: string
  value: string
  subtitle: string
  tone?: 'green' | 'red' | 'violet' | 'amber' | 'blue'
}) {
  const tones = {
    green: {
      background: 'rgba(34,197,94,0.08)',
      border: 'rgba(34,197,94,0.25)',
      value: '#86efac',
    },

    red: {
      background: 'rgba(239,68,68,0.08)',
      border: 'rgba(239,68,68,0.25)',
      value: '#fca5a5',
    },

    violet: {
      background: 'rgba(139,92,246,0.09)',
      border: 'rgba(139,92,246,0.28)',
      value: '#c4b5fd',
    },

    amber: {
      background: 'rgba(245,158,11,0.08)',
      border: 'rgba(245,158,11,0.28)',
      value: '#fcd34d',
    },

    blue: {
      background: 'rgba(59,130,246,0.08)',
      border: 'rgba(59,130,246,0.25)',
      value: '#93c5fd',
    },
  }

  const selected = tones[tone]

  return (
    <div
      className="glass-card"
      style={{
        padding: '16px',

        borderRadius: '16px',

        display: 'grid',

        gap: '8px',

        textAlign: 'right',

        background: selected.background,

        border: `1px solid ${selected.border}`,
      }}
    >
      <div
        style={{
          color: '#94a3b8',
          fontWeight: 800,
        }}
      >
        {title}
      </div>

      <strong
        style={{
          color: selected.value,

          fontSize: '22px',
        }}
      >
        {value}
      </strong>

      <div
        style={{
          color: '#64748b',

          fontSize: '13px',

          fontWeight: 700,

          lineHeight: 1.6,
        }}
      >
        {subtitle}
      </div>
    </div>
  )
}
