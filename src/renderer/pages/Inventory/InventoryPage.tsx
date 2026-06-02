import { useEffect, useMemo, useState } from 'react';

type InventoryRow = {
  variant_id: number;
  product_id: number;
  product_name: string;
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
  created_at: string;
  product_name: string;
  barcode?: string | null;
  size?: string | null;
  color?: string | null;
};

export default function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'available' | 'low' | 'out'>('all');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [adjustItem, setAdjustItem] = useState<InventoryRow | null>(null);
  const [targetStock, setTargetStock] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [savingAdjust, setSavingAdjust] = useState(false);

  const [historyItem, setHistoryItem] = useState<InventoryRow | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const stats = useMemo(() => {
    const positiveRows = rows.filter((x) => Number(x.stock || 0) > 0);

    return {
      total: rows.length,
      available: rows.filter((x) => Number(x.stock || 0) > Number(x.min_stock || 0)).length,
      low: rows.filter((x) => Number(x.stock || 0) > 0 && Number(x.stock || 0) <= Number(x.min_stock || 0)).length,
      out: rows.filter((x) => Number(x.stock || 0) === 0).length,

      totalBuyValue: positiveRows.reduce((sum, item) => {
        return sum + Number(item.stock || 0) * Number(item.buy_price || 0);
      }, 0),

      totalSellValue: positiveRows.reduce((sum, item) => {
        return sum + Number(item.stock || 0) * Number(item.sell_price || 0);
      }, 0)
    };
  }, [rows]);

  async function loadInventory() {
    setLoading(true);

    try {
      const data = await window.api.getInventoryList({
        search,
        status
      });

      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load inventory:', error);
      showMessage('حدث خطأ أثناء تحميل المخزون');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadInventory();
    }, 250);

    return () => clearTimeout(handle);
  }, [search, status]);

  function showMessage(text: string) {
    setMessage(text);

    setTimeout(() => {
      setMessage('');
    }, 1800);
  }

  function openAdjust(item: InventoryRow) {
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
        notes: adjustNotes.trim() || null
      });

      showMessage(
        result.diff === 0
          ? 'لا يوجد تغيير في المخزون'
          : `تم تعديل المخزون من ${result.old_stock} إلى ${result.new_stock}`
      );

      setAdjustItem(null);
      await loadInventory();
    } catch (error) {
      console.error('Failed to adjust stock:', error);
      showMessage('حدث خطأ أثناء تسوية المخزون');
    } finally {
      setSavingAdjust(false);
    }
  }

  async function openHistory(item: InventoryRow) {
    setHistoryItem(item);
    setHistoryLoading(true);

    try {
      const data = await window.api.getStockMovements({
        variant_id: item.variant_id,
        limit: 200
      });

      setMovements(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load stock movements:', error);
      showMessage('حدث خطأ أثناء تحميل سجل الحركات');
      setMovements([]);
    } finally {
      setHistoryLoading(false);
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
            <h2 style={{ margin: '0 0 6px' }}>إدارة المخزون</h2>
            <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
              عرض المخزون الحالي، التسويات، وسجل حركات الأصناف
            </p>
          </div>

          <button type="button" onClick={loadInventory} style={primaryButtonStyle}>
            {loading ? 'جاري التحميل...' : 'تحديث'}
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(260px, 1fr) 180px',
            gap: '12px',
            direction: 'rtl'
          }}
        >
          <input
            placeholder="بحث بالمنتج / الباركود / المقاس / اللون"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={inputStyle}
          />

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            style={inputStyle}
          >
            <option value="all">كل الحالات</option>
            <option value="available">متاح</option>
            <option value="low">مخزون منخفض</option>
            <option value="out">نافد</option>
          </select>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: '14px'
        }}
      >
        <StatCard title="كل الأصناف" value={String(stats.total)} />
        <StatCard title="متاح" value={String(stats.available)} success />
        <StatCard title="منخفض" value={String(stats.low)} warning />
        <StatCard title="نافد" value={String(stats.out)} danger />
        <StatCard title="إجمالي الشراء" value={money(stats.totalBuyValue)} />
        <StatCard title="إجمالي البيع" value={money(stats.totalSellValue)} success />
      </div>

      <div
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '18px',
          overflowX: 'auto',
          maxWidth: '100%'
        }}
      >
        <table
          style={{
            width: '100%',
            minWidth: '1120px',
            borderCollapse: 'collapse',
            direction: 'rtl'
          }}
        >
          <colgroup>
            <col style={{ width: '18%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>

          <thead>
            <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
              <th style={thStyle}>المنتج</th>
              <th style={thStyle}>باركود</th>
              <th style={thStyle}>المقاس</th>
              <th style={thStyle}>اللون</th>
              <th style={thStyle}>المخزون</th>
              <th style={thStyle}>الحد الأدنى</th>
              <th style={thStyle}>الحالة</th>
              <th style={thStyle}>سعر الشراء</th>
              <th style={thStyle}>سعر البيع</th>
              <th style={thStyle}>إجراءات</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} style={{ ...tdStyle, textAlign: 'center' }}>
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
                    {item.product_name}
                  </td>
                  <td style={tdStyle}>{item.barcode || '—'}</td>
                  <td style={tdStyle}>{item.size || '—'}</td>
                  <td style={tdStyle}>{item.color || '—'}</td>
                  <td
                    style={{
                      ...tdStyle,
                      fontWeight: 900,
                      color: stockColor(item)
                    }}
                  >
                    {Number(item.stock || 0)}
                  </td>
                  <td style={tdStyle}>{item.min_stock}</td>
                  <td style={tdStyle}>
                    <StatusBadge item={item} />
                  </td>
                  <td style={tdStyle}>{money(item.buy_price)}</td>
                  <td style={tdStyle}>{money(item.sell_price)}</td>
                  <td style={tdStyle}>
                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        flexWrap: 'nowrap',
                        alignItems: 'center'
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => openAdjust(item)}
                        style={smallButtonStyle}
                      >
                        تسوية
                      </button>

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
                  colSpan={10}
                  style={{
                    ...tdStyle,
                    textAlign: 'center',
                    color: '#94a3b8',
                    padding: '28px'
                  }}
                >
                  لا توجد أصناف
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adjustItem && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div className="theme-modal-card" style={modalStyle}>
            <h3 style={{ margin: '0 0 8px' }}>تسوية مخزون</h3>

            <p style={{ margin: '0 0 18px', color: '#94a3b8', fontWeight: 700 }}>
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
                    opacity: 0.7
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
                  fontWeight: 800
                }}
              >
                الفرق: {Number(targetStock || 0) - Number(adjustItem.stock || 0)}
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
                onClick={saveAdjustment}
                disabled={savingAdjust}
                style={{
                  ...primaryButtonStyle,
                  opacity: savingAdjust ? 0.6 : 1
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
              width: '900px'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                alignItems: 'center',
                marginBottom: '14px'
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

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
                <thead>
                  <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                    <th style={thStyle}>التاريخ</th>
                    <th style={thStyle}>النوع</th>
                    <th style={thStyle}>الكمية</th>
                    {/* <th style={thStyle}>المرجع</th> */}
                    <th style={thStyle}>ملاحظات</th>
                  </tr>
                </thead>

                <tbody>
                  {historyLoading && (
                    <tr>
                      <td colSpan={5} style={{ ...tdStyle, textAlign: 'center' }}>
                        جاري التحميل...
                      </td>
                    </tr>
                  )}

                  {!historyLoading &&
                    movements.map((movement) => (
                      <tr
                        key={movement.id}
                        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                      >
                        <td style={tdStyle}>{formatDate(movement.created_at)}</td>
                        <td style={tdStyle}>{movementTypeName(movement)}</td>
                        <td
                          style={{
                            ...tdStyle,
                            fontWeight: 900,
                            color:
                              Number(movement.signed_quantity || 0) >= 0
                                ? '#6ee7b7'
                                : '#fca5a5'
                          }}
                        >
                          {Number(movement.signed_quantity || 0) > 0 ? '+' : ''}
                          {Number(movement.signed_quantity || 0)}
                        </td>
                        {/* <td style={tdStyle}>
                          {movement.reference_type || '—'}
                          {movement.reference_id ? ` #${movement.reference_id}` : ''}
                        </td> */}
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
                          padding: '24px'
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
              }}
              style={{
                ...secondaryButtonStyle,
                marginTop: '18px'
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

function StatCard({
  title,
  value,
  success,
  warning,
  danger
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
      <strong style={{ color, fontSize: '24px' }}>{value}</strong>
    </div>
  );
}

function StatusBadge({ item }: { item: InventoryRow }) {
  const stock = Number(item.stock || 0);
  const minStock = Number(item.min_stock || 0);

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
        fontWeight: 900
      }}
    >
      {text}
    </span>
  );
}

function stockColor(item: InventoryRow) {
  const stock = Number(item.stock || 0);
  const minStock = Number(item.min_stock || 0);

  if (stock < 0) return '#fca5a5';
  if (stock === 0) return '#fca5a5';
  if (stock <= minStock) return '#fdba74';
  return '#6ee7b7';
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
  return `${Number(value || 0).toFixed(2)} ج.م`;
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

const cardStyle: React.CSSProperties = {
  padding: '18px',
  borderRadius: '18px',
  display: 'grid',
  gap: '14px'
};

const statCardStyle: React.CSSProperties = {
  padding: '18px',
  borderRadius: '18px',
  display: 'grid',
  gap: '10px'
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
  whiteSpace: 'nowrap',
  verticalAlign: 'middle'
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