import { useEffect, useRef, useState } from 'react';
import PaginationBar, {
  SYSTEM_PAGE_SIZE,
} from '../../components/PaginationBar';
import { useAuthStore } from '../../store/auth.store';
import { hasUserPermission } from '../../utils/permissions';
import { formatMoney } from '../../../shared/money';

type InventoryRow = {
  variant_id: number;
  product_id: number;
  product_name: string;
  category_id?: number | null;
  category_name?: string | null;
  barcode?: string | null;
  size?: string | null;
  color?: string | null;
  buy_price: number;
  sell_price: number;
  min_stock: number;
  is_active: number;
  product_is_active: number;
  stock: number;
};

type MovementRow = {
  id: number;
  variant_id: number;
  type: 'in' | 'out';
  quantity: number;
  signed_quantity: number;
  reference_id?: number | null;
  reference_type?: string | null;
  notes?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
  created_at: string;
  product_name: string;
  barcode?: string | null;
  size?: string | null;
  color?: string | null;
};

type Category = {
  id: number;
  name: string;
  description?: string | null;
};

type InventoryStatusFilter = 'available' | 'low' | 'out' | 'inactive';

type InventoryAnalytics = {
  stock_units: number;

  sold_units_30d: number;

  dead_stock_variants_90d: number;

  dead_stock_units_90d: number;

  dead_stock_value_90d: number;

  potential_gross_profit: number;

  top_mover: {
    variant_id: number;

    product_name: string;

    barcode?: string | null;

    size?: string | null;

    color?: string | null;

    current_stock: number;

    sold_units_30d: number;
  } | null;
};

const emptyInventoryAnalytics: InventoryAnalytics = {
  stock_units: 0,

  sold_units_30d: 0,

  dead_stock_variants_90d: 0,

  dead_stock_units_90d: 0,

  dead_stock_value_90d: 0,

  potential_gross_profit: 0,

  top_mover: null,
};

export default function InventoryPage() {
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role === 'admin';
  const canViewCosts = hasUserPermission(currentUser, 'costs.view');
  const canAdjustInventory = hasUserPermission(currentUser, 'inventory.adjust');
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [inventoryTotal, setInventoryTotal] = useState(0);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [movementsTotal, setMovementsTotal] = useState(0);
  const [movementsPage, setMovementsPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilters, setStatusFilters] = useState<InventoryStatusFilter[]>(
    [],
  );

  const [statusFilterOpen, setStatusFilterOpen] = useState(false);

  const statusFilterRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [adjustItem, setAdjustItem] = useState<InventoryRow | null>(null);
  const [targetStock, setTargetStock] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [savingAdjust, setSavingAdjust] = useState(false);

  const [historyItem, setHistoryItem] = useState<InventoryRow | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [stats, setStats] = useState({
    total: 0,
    available: 0,
    low: 0,
    out: 0,
    totalBuyValue: 0,
    totalSellValue: 0,
    inactive: 0,
  });

  const [analytics, setAnalytics] = useState<InventoryAnalytics>(
    emptyInventoryAnalytics,
  );

  useEffect(() => {
    let mounted = true;

    window.api
      .getCategories()
      .then((data) => {
        if (!mounted) return;
        setCategories(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        console.error('Failed to load categories:', error);
        setCategories([]);
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function loadAnalytics() {
    try {
      const result = await window.api.getInventoryAnalytics({
        categoryId: categoryFilter,
      });

      setAnalytics({
        stock_units: Number(result?.stock_units || 0),

        sold_units_30d: Number(result?.sold_units_30d || 0),

        dead_stock_variants_90d: Number(result?.dead_stock_variants_90d || 0),

        dead_stock_units_90d: Number(result?.dead_stock_units_90d || 0),

        dead_stock_value_90d: Number(result?.dead_stock_value_90d || 0),

        potential_gross_profit: Number(result?.potential_gross_profit || 0),

        top_mover: result?.top_mover || null,
      });
    } catch (error) {
      console.error('Failed to load inventory analytics:', error);

      setAnalytics(emptyInventoryAnalytics);
    }
  }

  async function loadInventory(page = inventoryPage) {
    setLoading(true);

    try {
      const safePage = Math.max(1, Number(page || 1));

      const result = await window.api.getInventoryPage({
        search,
        statuses: statusFilters,
        categoryId: categoryFilter,
        limit: SYSTEM_PAGE_SIZE,
        offset: (safePage - 1) * SYSTEM_PAGE_SIZE,
      });

      const total = Number(result.total || 0);

      const totalPages = Math.max(1, Math.ceil(total / SYSTEM_PAGE_SIZE));

      if (safePage > totalPages) {
        setInventoryPage(totalPages);
        await loadInventory(totalPages);
        return;
      }

      setRows(Array.isArray(result.rows) ? result.rows : []);

      setInventoryTotal(total);
      setInventoryPage(safePage);

      setStats({
        total: Number(result.summary?.total || 0),
        available: Number(result.summary?.available || 0),
        low: Number(result.summary?.low || 0),
        out: Number(result.summary?.out || 0),
        totalBuyValue: Number(result.summary?.totalBuyValue || 0),
        totalSellValue: Number(result.summary?.totalSellValue || 0),
        inactive: Number(result.summary?.inactive || 0),
      });
    } catch (error) {
      console.error('Failed to load inventory:', error);

      showMessage('حدث خطأ أثناء تحميل المخزون');

      setRows([]);
      setInventoryTotal(0);

      setStats({
        total: 0,
        available: 0,
        low: 0,
        out: 0,
        totalBuyValue: 0,
        totalSellValue: 0,
        inactive: 0,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      setInventoryPage(1);
      void loadInventory(1);
    }, 250);

    return () => clearTimeout(handle);
  }, [search, statusFilters, categoryFilter]);

  useEffect(() => {
    void loadAnalytics();
  }, [categoryFilter]);

  function toggleStatusFilter(filter: InventoryStatusFilter) {
    setStatusFilters((current) =>
      current.includes(filter)
        ? current.filter((item) => item !== filter)
        : [...current, filter],
    );
  }

  function getStatusFilterLabel() {
    if (statusFilters.length === 0) {
      return 'كل الحالات';
    }

    const labels: Record<InventoryStatusFilter, string> = {
      available: 'متاح',
      low: 'منخفض',
      out: 'نافد',
      inactive: 'متعطل',
    };

    if (statusFilters.length === 1) {
      return labels[statusFilters[0]];
    }

    return statusFilters.map((status) => labels[status]).join(' + ');
  }

  function showMessage(text: string, duration = 1800) {
    setMessage(text);

    setTimeout(() => {
      setMessage('');
    }, duration);
  }

  function openAdjust(item: InventoryRow) {
    if (!canAdjustInventory) {
      return;
    }
    setAdjustItem(item);
    setTargetStock(String(Number(item.stock || 0)));
    setAdjustNotes('');
  }

  async function saveAdjustment() {
    if (!adjustItem) return;
    if (savingAdjust) return;

    const nextStock = Number(targetStock);

    if (!Number.isFinite(nextStock) || nextStock < 0) {
      showMessage('اكتب مخزون صحيح');
      return;
    }

    setSavingAdjust(true);

    try {
      const result = await window.api.adjustVariantStock({
        variant_id: adjustItem.variant_id,
        target_stock: nextStock,
        notes: adjustNotes.trim() || null,
      });

      showMessage(
        result.diff === 0
          ? 'لا يوجد تغيير في المخزون'
          : `تم تعديل المخزون من ${result.old_stock} إلى ${result.new_stock}`,
      );

      setAdjustItem(null);
      await Promise.all([loadInventory(inventoryPage), loadAnalytics()]);
    } catch (error) {
      console.error('Failed to adjust stock:', error);

      showMessage(
        'حدث خطأ أثناء تسوية المخزون. لم يتم تطبيق أي تغييرات.',
        4500,
      );
    } finally {
      setSavingAdjust(false);
    }
  }

  async function openHistory(item: InventoryRow, page = 1) {
    setHistoryItem(item);
    setHistoryLoading(true);

    try {
      const safePage = Math.max(1, Number(page || 1));

      const result = await window.api.getStockMovements({
        variant_id: item.variant_id,
        limit: SYSTEM_PAGE_SIZE,
        offset: (safePage - 1) * SYSTEM_PAGE_SIZE,
      });

      setMovements(Array.isArray(result.rows) ? result.rows : []);

      setMovementsTotal(Number(result.total || 0));

      setMovementsPage(safePage);
    } catch (error) {
      console.error('Failed to load stock movements:', error);

      showMessage('حدث خطأ أثناء تحميل سجل الحركات');

      setMovements([]);
      setMovementsTotal(0);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function downloadInventoryEmployeesPdf() {
    try {
      const inventoryRows = await window.api.getInventoryList({
        search: '',
        status: 'all',
      });

      const printRows: InventoryRow[] = Array.isArray(inventoryRows)
        ? inventoryRows
        : [];
      const html = buildInventoryEmployeesPdfHtml(printRows);

      const result = await window.api.savePdfFromHtml({
        html,
        defaultFileName: `inventory-employees-${new Date().toISOString().slice(0, 10)}.pdf`,
        landscape: true,
      });

      if (result?.canceled) return;

      showMessage('تم حفظ PDF المخزون بنجاح');
    } catch (error) {
      console.error('Failed to save inventory PDF:', error);
      showMessage('حدث خطأ أثناء حفظ PDF المخزون');
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: '18px',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        gridTemplateRows: 'auto auto auto minmax(0, 1fr)',
      }}
    >
      {message && (
        <div
          style={{
            position: 'fixed',
            top: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000001,
            padding: '12px 18px',
            borderRadius: '14px',
            background: 'rgba(37,99,235,0.96)',
            color: '#fff',
            fontWeight: 800,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        >
          {message}
        </div>
      )}

      <div
        className="glass-card"
        style={{
          ...cardStyle,
          position: 'relative',
          zIndex: 100,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '14px',
            alignItems: 'center',
            flexWrap: 'wrap',
            direction: 'rtl',
          }}
        >
          <div>
            <h2 style={{ margin: '0 0 6px' }}>إدارة المخزون</h2>
            <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
              عرض المخزون الحالي، التسويات، وسجل حركات الأصناف
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {isAdmin && (
              <button
                type="button"
                onClick={downloadInventoryEmployeesPdf}
                style={secondaryButtonStyle}
              >
                PDF المخزون
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                void Promise.all([
                  loadInventory(inventoryPage),

                  loadAnalytics(),
                ]);
              }}
              style={primaryButtonStyle}
            >
              {loading ? 'جاري التحميل...' : 'تحديث'}
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(260px, 1fr) 180px 220px',
            gap: '12px',
            direction: 'rtl',
          }}
        >
          <input
            placeholder="بحث بالمنتج / الباركود / المقاس / اللون"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={inputStyle}
          />

          <div
            ref={statusFilterRef}
            style={{
              position: 'relative',
              width: '100%',
              zIndex: 50,
            }}
          >
            <button
              type="button"
              onClick={() => setStatusFilterOpen((current) => !current)}
              style={{
                ...inputStyle,
                width: '100%',
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                fontWeight: 800,
              }}
            >
              <span>{getStatusFilterLabel()}</span>

              <span
                style={{
                  fontSize: '12px',
                  color: '#94a3b8',
                  transform: statusFilterOpen
                    ? 'rotate(180deg)'
                    : 'rotate(0deg)',
                  transition: '0.2s',
                }}
              >
                ▼
              </span>
            </button>

            {statusFilterOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 7px)',
                  right: 0,
                  width: '100%',
                  minWidth: '190px',
                  padding: '10px',
                  borderRadius: '14px',
                  background: '#10192c',
                  border: '1px solid rgba(148,163,184,0.22)',
                  boxShadow: '0 18px 45px rgba(0,0,0,0.45)',
                  display: 'grid',
                  gap: '5px',
                  zIndex: 9999,
                }}
              >
                <button
                  type="button"
                  onClick={() => setStatusFilters([])}
                  style={{
                    width: '100%',
                    minHeight: '40px',
                    borderRadius: '9px',
                    border:
                      statusFilters.length === 0
                        ? '1px solid rgba(148,163,184,0.28)'
                        : '1px solid transparent',
                    background:
                      statusFilters.length === 0
                        ? 'rgba(255,255,255,0.06)'
                        : 'transparent',
                    color: '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 10px',
                    fontWeight: 900,
                    cursor: 'pointer',
                    direction: 'rtl',
                  }}
                >
                  <span>كل الحالات</span>

                  <span
                    style={{
                      width: '20px',
                      textAlign: 'center',
                    }}
                  >
                    {statusFilters.length === 0 ? '✓' : ''}
                  </span>
                </button>

                {(
                  [
                    ['available', 'متاح'],
                    ['low', 'منخفض'],
                    ['out', 'نافد'],
                    ['inactive', 'متعطل'],
                  ] as Array<[InventoryStatusFilter, string]>
                ).map(([value, label]) => (
                  <label
                    key={value}
                    style={{
                      minHeight: '38px',
                      padding: '0 10px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      cursor: 'pointer',
                      color: '#e2e8f0',
                      fontWeight: 800,
                      direction: 'rtl',
                    }}
                  >
                    <span>{label}</span>

                    <input
                      type="checkbox"
                      checked={statusFilters.includes(value)}
                      onChange={() => toggleStatusFilter(value)}
                      style={{
                        width: '16px',
                        height: '16px',
                        cursor: 'pointer',
                        accentColor: '#6366f1',
                      }}
                    />
                  </label>
                ))}

                <button
                  type="button"
                  onClick={() => setStatusFilterOpen(false)}
                  style={{
                    marginTop: '6px',
                    width: '100%',
                    minHeight: '40px',
                    border: 0,
                    borderRadius: '9px',
                    background:
                      'linear-gradient(90deg, #315cf5 0%, #7c3aed 100%)',
                    color: '#fff',
                    fontWeight: 900,
                    fontSize: '15px',
                    cursor: 'pointer',
                  }}
                >
                  تم
                </button>
              </div>
            )}
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={inputStyle}
          >
            <option value="all">كل التصنيفات</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '14px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <StatCard title="كل الأصناف" value={String(stats.total)} />
        <StatCard title="متاح" value={String(stats.available)} success />
        <StatCard title="منخفض" value={String(stats.low)} warning />
        <StatCard title="نافد" value={String(stats.out)} danger />
        <StatCard title="متعطل" value={String(stats.inactive)} />
        {canViewCosts && (
          <StatCard title="إجمالي الشراء" value={money(stats.totalBuyValue)} />
        )}
        <StatCard
          title="إجمالي البيع"
          value={money(stats.totalSellValue)}
          success
        />
      </div>

      <div
        className="glass-card"
        style={{
          padding: '14px',

          borderRadius: '18px',

          display: 'grid',

          gap: '12px',
        }}
      >
        <div>
          <strong
            style={{
              fontSize: '15px',
            }}
          >
            تحليلات حركة المخزون
          </strong>

          <div
            style={{
              color: '#94a3b8',

              fontSize: '12px',

              fontWeight: 700,

              marginTop: '4px',
            }}
          >
            حركة 30 يوم ومخزون راكد لأكثر من 90 يوم
          </div>
        </div>

        <div
          style={{
            display: 'grid',

            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',

            gap: '10px',
          }}
        >
          <StatCard
            title="إجمالي وحدات المخزون"
            value={String(analytics.stock_units)}
          />

          <StatCard
            title="صافي المباع 30 يوم"
            value={String(analytics.sold_units_30d)}
            success={analytics.sold_units_30d > 0}
          />

          <StatCard
            title="أصناف راكدة +90 يوم"
            value={String(analytics.dead_stock_variants_90d)}
            warning={analytics.dead_stock_variants_90d > 0}
          />

          <StatCard
            title="وحدات راكدة +90 يوم"
            value={String(analytics.dead_stock_units_90d)}
            warning={analytics.dead_stock_units_90d > 0}
          />

          <StatCard
            title={
              analytics.top_mover
                ? `الأسرع: ${analytics.top_mover.product_name}`
                : 'أسرع صنف 30 يوم'
            }
            value={
              analytics.top_mover
                ? `${analytics.top_mover.sold_units_30d} وحدة`
                : '—'
            }
            success={Boolean(analytics.top_mover)}
          />

          {canViewCosts && (
            <StatCard
              title="قيمة المخزون الراكد"
              value={money(analytics.dead_stock_value_90d)}
              warning={analytics.dead_stock_value_90d > 0}
            />
          )}

          {canViewCosts && (
            <StatCard
              title="هامش الربح المتوقع للمخزون"
              value={money(analytics.potential_gross_profit)}
              success
            />
          )}
        </div>
      </div>

      <div
        className="glass-card table-scroll"
        style={{
          padding: '18px',
          borderRadius: '18px',
          overflow: 'auto',
          height: '100%',
          minHeight: 0,
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        <PaginationBar
          page={inventoryPage}
          totalItems={inventoryTotal}
          loading={loading}
          onPageChange={(page) => {
            void loadInventory(page);
          }}
        />

        <table
          style={{
            width: '100%',
            minWidth: '980px',
            borderCollapse: 'collapse',
            direction: 'rtl',
          }}
        >
          <colgroup>
            <col style={{ width: '34%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>

          <thead>
            <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
              <th style={thStyle}>المنتج</th>
              <th style={thStyle}>المخزون</th>
              <th style={thStyle}>الحالة</th>
              <th style={thStyle}>الأسعار</th>
              <th style={thStyle}>إجراءات</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, textAlign: 'center' }}>
                  جاري التحميل...
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((item) => (
                <tr
                  key={item.variant_id}
                  style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <td style={tdStyle} title={item.product_name}>
                    <div
                      style={{ display: 'grid', gap: '4px', minWidth: '180px' }}
                    >
                      <strong>{item.product_name}</strong>

                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                        {item.barcode || '—'}
                      </span>

                      <span style={{ color: '#64748b', fontSize: '12px' }}>
                        {item.size || '—'} / {item.color || '—'}
                      </span>

                      <span
                        style={{
                          color: '#38bdf8',
                          fontSize: '12px',
                          fontWeight: 800,
                        }}
                      >
                        التصنيف: {item.category_name || 'بدون تصنيف'}
                      </span>
                    </div>
                  </td>

                  <td
                    style={{
                      ...tdStyle,
                      fontWeight: 900,
                      color: stockColor(item),
                    }}
                  >
                    <div style={{ display: 'grid', gap: '3px' }}>
                      <strong>{Number(item.stock || 0)}</strong>

                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                        حد أدنى: {item.min_stock}
                      </span>
                    </div>
                  </td>

                  <td style={tdStyle}>
                    <StatusBadge item={item} />
                  </td>

                  <td style={tdStyle}>
                    <div
                      style={{ display: 'grid', gap: '4px', minWidth: '120px' }}
                    >
                      {canViewCosts && (
                        <span>شراء: {money(item.buy_price)}</span>
                      )}

                      <span
                        style={{
                          color: '#6ee7b7',
                        }}
                      >
                        بيع: {money(item.sell_price)}
                      </span>
                    </div>
                  </td>

                  <td style={tdStyle}>
                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        flexWrap: 'nowrap',
                        alignItems: 'center',
                      }}
                    >
                      {canAdjustInventory && (
                        <button
                          type="button"
                          onClick={() => openAdjust(item)}
                          style={smallButtonStyle}
                        >
                          تسوية
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => openHistory(item)}
                        style={smallButtonStyle}
                      >
                        الحركات
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    ...tdStyle,
                    textAlign: 'center',
                    color: '#94a3b8',
                    padding: '28px',
                  }}
                >
                  لا توجد أصناف
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adjustItem && canAdjustInventory && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div className="theme-modal-card" style={modalStyle}>
            <h3 style={{ margin: '0 0 8px' }}>تسوية مخزون</h3>

            <p
              style={{ margin: '0 0 18px', color: '#94a3b8', fontWeight: 700 }}
            >
              {adjustItem.product_name} | {adjustItem.size || '—'} |{' '}
              {adjustItem.color || '—'}
            </p>

            <div style={{ display: 'grid', gap: '14px' }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>المخزون الحالي</label>
                <input
                  value={Number(adjustItem.stock || 0)}
                  readOnly
                  style={{
                    ...inputStyle,
                    opacity: 0.7,
                  }}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>المخزون الجديد المطلوب</label>
                <input
                  type="number"
                  min={0}
                  value={targetStock}
                  onChange={(e) => setTargetStock(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>ملاحظات</label>
                <input
                  placeholder="مثال: جرد شهري / تصحيح إدخال"
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div
                className="theme-info-panel"
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  background: 'rgba(37,99,235,0.10)',
                  border: '1px solid rgba(37,99,235,0.25)',
                  color: '#bfdbfe',
                  fontWeight: 800,
                }}
              >
                الفرق:{' '}
                {Number(targetStock || 0) - Number(adjustItem.stock || 0)}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-start',
                marginTop: '22px',
              }}
            >
              <button
                type="button"
                onClick={saveAdjustment}
                disabled={savingAdjust}
                style={{
                  ...primaryButtonStyle,
                  opacity: savingAdjust ? 0.6 : 1,
                }}
              >
                {savingAdjust ? 'جاري الحفظ...' : 'حفظ التسوية'}
              </button>

              <button
                type="button"
                onClick={() => setAdjustItem(null)}
                style={secondaryButtonStyle}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {historyItem && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div
            className="theme-modal-card"
            style={{
              ...modalStyle,
              width: '1000px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                alignItems: 'center',
                marginBottom: '14px',
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 6px' }}>سجل حركات المخزون</h3>
                <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
                  {historyItem.product_name} | {historyItem.size || '—'} |{' '}
                  {historyItem.color || '—'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setHistoryItem(null);
                  setMovements([]);
                }}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <PaginationBar
              page={movementsPage}
              totalItems={movementsTotal}
              loading={historyLoading}
              onPageChange={(page) => {
                void openHistory(historyItem, page);
              }}
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
                    <th style={thStyle}>التاريخ</th>
                    <th style={thStyle}>النوع</th>
                    <th style={thStyle}>الكمية</th>
                    <th style={thStyle}>بواسطة</th>
                    <th style={thStyle}>ملاحظات</th>
                  </tr>
                </thead>

                <tbody>
                  {historyLoading && (
                    <tr>
                      <td
                        colSpan={5}
                        style={{ ...tdStyle, textAlign: 'center' }}
                      >
                        جاري التحميل...
                      </td>
                    </tr>
                  )}

                  {!historyLoading &&
                    movements.map((movement) => (
                      <tr
                        key={movement.id}
                        style={{
                          borderTop: '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        <td style={tdStyle}>
                          {formatDate(movement.created_at)}
                        </td>
                        <td style={tdStyle}>{movementTypeName(movement)}</td>
                        <td
                          style={{
                            ...tdStyle,
                            fontWeight: 900,
                            color:
                              Number(movement.signed_quantity || 0) >= 0
                                ? '#6ee7b7'
                                : '#fca5a5',
                          }}
                        >
                          {Number(movement.signed_quantity || 0) > 0 ? '+' : ''}
                          {Number(movement.signed_quantity || 0)}
                        </td>
                        <td style={tdStyle}>
                          {movement.created_by_name ||
                            (movement.created_by
                              ? `مستخدم #${movement.created_by}`
                              : '—')}
                        </td>
                        <td style={tdStyle}>{movement.notes || '—'}</td>
                      </tr>
                    ))}

                  {!historyLoading && movements.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          ...tdStyle,
                          textAlign: 'center',
                          color: '#94a3b8',
                          padding: '24px',
                        }}
                      >
                        لا توجد حركات مخزون
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={() => {
                setHistoryItem(null);
                setMovements([]);
                setMovementsTotal(0);
                setMovementsPage(1);
              }}
              style={{
                ...secondaryButtonStyle,
                marginTop: '18px',
              }}
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function buildInventoryEmployeesPdfHtml(printRows: InventoryRow[]) {
  const activeRows = printRows.filter(
    (item) =>
      Number(item.product_is_active) === 1 && Number(item.is_active) === 1,
  );

  const inactiveCount = printRows.length - activeRows.length;

  const availableCount = activeRows.filter(
    (item) => Number(item.stock || 0) > Number(item.min_stock || 0),
  ).length;

  const lowCount = activeRows.filter(
    (item) =>
      Number(item.stock || 0) > 0 &&
      Number(item.stock || 0) <= Number(item.min_stock || 0),
  ).length;

  const outCount = activeRows.filter(
    (item) => Number(item.stock || 0) === 0,
  ).length;

  const rowsHtml = printRows
    .map((item, index) => {
      const stock = Number(item.stock || 0);
      const minStock = Number(item.min_stock || 0);
      const statusText = getInventoryStatusText(item);

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.product_name)}</td>
          <td>${escapeHtml(item.barcode || '—')}</td>
          <td>${escapeHtml(item.size || '—')}</td>
          <td>${escapeHtml(item.color || '—')}</td>
          <td class="${stock <= 0 ? 'danger' : stock <= minStock ? 'warning' : ''}">
            ${stock}
          </td>
          <td>${minStock}</td>
          <td>${money(item.sell_price)}</td>
          <td>${statusText}</td>
          <td class="notes-cell">&nbsp;</td>
        </tr>
      `;
    })
    .join('');

  return `
    <!doctype html>
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <title>تقرير مخزون الموظفين</title>
        <style>
          @page {
            size: A4 landscape;
            margin: 10mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            font-family: "Segoe UI", Tahoma, Arial, sans-serif;
            color: #111827;
            background: #ffffff;
            direction: rtl;
          }

          .header {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            align-items: flex-start;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 10px;
            margin-bottom: 10px;
          }

          h1 {
            margin: 0 0 6px;
            font-size: 22px;
          }

          .muted {
            color: #6b7280;
            font-size: 11px;
            line-height: 1.6;
            font-weight: 700;
          }

          .summary {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 8px;
            margin: 10px 0;
          }

          .card {
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            padding: 8px;
            background: #f9fafb;
          }

          .card-title {
            color: #6b7280;
            font-size: 10px;
            margin-bottom: 4px;
            font-weight: 800;
          }

          .card-value {
            font-size: 15px;
            font-weight: 900;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          th,
          td {
            border: 1px solid #d1d5db;
            padding: 5px;
            text-align: right;
            font-size: 9.5px;
            vertical-align: middle;
            word-break: break-word;
          }

          th {
            background: #f3f4f6;
            font-weight: 900;
          }

          .danger {
            color: #b91c1c;
            font-weight: 900;
          }

          .warning {
            color: #b45309;
            font-weight: 900;
          }

          .footer {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #e5e7eb;
            display: flex;
            justify-content: space-between;
            color: #6b7280;
            font-size: 10px;
            font-weight: 700;
          }
          .notes-cell {
            height: 24px;
            background: #ffffff;
          }
        </style>
      </head>

      <body>
        <div class="header">
          <div>
            <h1>تقرير مخزون الموظفين</h1>
            <div class="muted">
              تقرير كامل للمخزون بدون سعر الشراء<br />
              تاريخ التصدير: ${new Date().toLocaleString('ar-EG')}
            </div>
          </div>

          <div class="muted">
            عدد الأصناف: ${printRows.length}<br />
            مقاس: A4 أفقي
          </div>
        </div>

        <div class="summary">
          <div class="card">
            <div class="card-title">كل الأصناف</div>
            <div class="card-value">${printRows.length}</div>
          </div>

          <div class="card">
            <div class="card-title">متاح</div>
            <div class="card-value">${availableCount}</div>
          </div>

          <div class="card">
            <div class="card-title">منخفض</div>
            <div class="card-value">${lowCount}</div>
          </div>

          <div class="card">
            <div class="card-title">نافد</div>
            <div class="card-value">${outCount}</div>
          </div>

          <div class="card">
            <div class="card-title">متعطل</div>
            <div class="card-value">${inactiveCount}</div>
          </div>

        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 32px;">#</th>
              <th style="width: 190px;">المنتج</th>
              <th style="width: 95px;">الباركود</th>
              <th style="width: 70px;">المقاس</th>
              <th style="width: 70px;">اللون</th>
              <th style="width: 60px;">المخزون</th>
              <th style="width: 60px;">حد أدنى</th>
              <th style="width: 85px;">سعر البيع</th>
              <th style="width: 75px;">الحالة</th>
              <th style="width: 130px;">ملاحظات</th>
            </tr>
          </thead>

          <tbody>
            ${
              rowsHtml ||
              '<tr><td colspan="10" style="text-align:center;padding:22px;">لا توجد أصناف</td></tr>'
            }
          </tbody>
        </table>

        <div class="footer">
          <div>تم إنشاء التقرير من نظام ERP Store</div>
          <div>صفحة المخزون - نسخة الموظفين</div>
        </div>
      </body>
    </html>
  `;
}

function StatCard({
  title,
  value,
  success,
  warning,
  danger,
}: {
  title: string;
  value: string;
  success?: boolean;
  warning?: boolean;
  danger?: boolean;
}) {
  const color = danger
    ? '#fca5a5'
    : warning
      ? '#fdba74'
      : success
        ? '#6ee7b7'
        : '#e5e7eb';

  return (
    <div className="glass-card" style={statCardStyle}>
      <div style={{ color: '#94a3b8', fontWeight: 800 }}>{title}</div>
      <strong style={{ color, fontSize: '21px' }}>{value}</strong>
    </div>
  );
}

function StatusBadge({ item }: { item: InventoryRow }) {
  const stock = Number(item.stock || 0);
  const minStock = Number(item.min_stock || 0);

  const isInactive =
    Number(item.product_is_active) !== 1 || Number(item.is_active) !== 1;

  if (isInactive) {
    return (
      <span
        style={{
          display: 'inline-flex',
          padding: '6px 10px',
          borderRadius: '999px',
          color: '#cbd5e1',
          background: 'rgba(148,163,184,0.10)',
          border: '1px solid rgba(148,163,184,0.25)',
          fontWeight: 900,
        }}
      >
        متعطل
      </span>
    );
  }

  let text = 'متاح';
  let color = '#6ee7b7';
  let background = 'rgba(16,185,129,0.10)';
  let border = 'rgba(16,185,129,0.25)';

  if (stock < 0) {
    text = 'سالب';
    color = '#fca5a5';
    background = 'rgba(239,68,68,0.10)';
    border = 'rgba(239,68,68,0.25)';
  } else if (stock === 0) {
    text = 'نافد';
    color = '#fca5a5';
    background = 'rgba(239,68,68,0.10)';
    border = 'rgba(239,68,68,0.25)';
  } else if (stock <= minStock) {
    text = 'منخفض';
    color = '#fdba74';
    background = 'rgba(249,115,22,0.10)';
    border = 'rgba(249,115,22,0.25)';
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        padding: '6px 10px',
        borderRadius: '999px',
        color,
        background,
        border: `1px solid ${border}`,
        fontWeight: 900,
      }}
    >
      {text}
    </span>
  );
}

function stockColor(item: InventoryRow) {
  const stock = Number(item.stock || 0);
  const minStock = Number(item.min_stock || 0);

  if (Number(item.product_is_active) !== 1 || Number(item.is_active) !== 1) {
    return '#94a3b8';
  }

  if (stock < 0) return '#fca5a5';
  if (stock === 0) return '#fca5a5';
  if (stock <= minStock) return '#fdba74';
  return '#6ee7b7';
}

function getInventoryStatusText(item: InventoryRow) {
  const stock = Number(item.stock || 0);
  const minStock = Number(item.min_stock || 0);

  if (Number(item.product_is_active) !== 1 || Number(item.is_active) !== 1) {
    return 'متعطل';
  }

  if (stock < 0) return 'سالب';
  if (stock === 0) return 'نافد';
  if (stock <= minStock) return 'منخفض';
  return 'متاح';
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function movementTypeName(movement: MovementRow) {
  if (movement.reference_type === 'sale') return 'بيع';
  if (movement.reference_type === 'return') return 'مرتجع';
  if (movement.reference_type === 'opening_stock') return 'رصيد افتتاحي';
  if (movement.reference_type === 'manual_adjust') return 'تسوية يدوية';

  if (movement.type === 'in') return 'دخول';
  if (movement.type === 'out') return 'خروج';

  return movement.type;
}

function money(value: unknown) {
  return formatMoney(value);
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
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

const cardStyle: React.CSSProperties = {
  padding: '18px',
  borderRadius: '18px',
  display: 'grid',
  gap: '14px',
};

const statCardStyle: React.CSSProperties = {
  padding: '14px',
  borderRadius: '18px',
  display: 'grid',
  gap: '10px',
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
  boxSizing: 'border-box',
};

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  height: '44px',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, #6d5dfc, #7c3aed)',
  color: '#fff',
  fontWeight: 800,
  padding: '0 18px',
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid #7c3aed',
  height: '44px',
  borderRadius: '10px',
  background: 'transparent',
  color: '#c4b5fd',
  fontWeight: 800,
  padding: '0 18px',
  cursor: 'pointer',
};

const smallButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(124,58,237,0.7)',
  height: '34px',
  borderRadius: '9px',
  background: 'rgba(124,58,237,0.12)',
  color: '#ddd6fe',
  fontWeight: 900,
  padding: '0 10px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontSize: '12px',
};

const thStyle: React.CSSProperties = {
  padding: '10px 8px',
  fontWeight: 900,
  whiteSpace: 'nowrap',
  fontSize: '13px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 8px',
  color: '#e5e7eb',
  whiteSpace: 'nowrap',
  fontSize: '13px',
  verticalAlign: 'middle',
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.60)',
  zIndex: 99999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
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
  boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
};

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: '8px',
};

const labelStyle: React.CSSProperties = {
  color: '#cbd5e1',
  fontWeight: 800,
};

const closeButtonStyle: React.CSSProperties = {
  width: '34px',
  height: '34px',
  borderRadius: '50%',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '20px',
};
