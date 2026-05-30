import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../store/auth.store';

type StockCountSession = {
  id: number;
  title: string;
  notes?: string | null;
  status: 'open' | 'approved' | 'canceled';
  created_by?: number | null;
  approved_by?: number | null;
  created_at: string;
  approved_at?: string | null;
  canceled_at?: string | null;
  created_by_name?: string | null;
  approved_by_name?: string | null;
  items_count: number;
  counted_count: number;
  matched_count: number;
  shortage_count: number;
  surplus_count: number;
  buy_difference_value: number;
  sell_difference_value: number;
};

type StockCountItem = {
  id: number;
  session_id: number;
  variant_id: number;
  system_stock: number;
  actual_stock?: number | null;
  notes?: string | null;
  product_name: string;
  barcode?: string | null;
  size?: string | null;
  color?: string | null;
  buy_price: number;
  sell_price: number;
  difference: number;
  buy_difference_value: number;
  sell_difference_value: number;
};

type StockCountDetails = {
  session: StockCountSession;
  items: StockCountItem[];
};

export default function StockCountPage() {
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role === 'admin';

  const [sessions, setSessions] = useState<StockCountSession[]>([]);
  const [selected, setSelected] = useState<StockCountDetails | null>(null);

  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [creating, setCreating] = useState(false);

  const [barcode, setBarcode] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const [savingItemId, setSavingItemId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'uncounted' | 'matched' | 'shortage' | 'surplus'>('all');

  const [message, setMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<null | 'approve' | 'cancel'>(null);

  const summary = useMemo(() => {
    const items = selected?.items || [];

    const counted = items.filter((x) => x.actual_stock !== null && x.actual_stock !== undefined);
    const matched = counted.filter((x) => Number(x.actual_stock) === Number(x.system_stock));
    const shortage = counted.filter((x) => Number(x.actual_stock) < Number(x.system_stock));
    const surplus = counted.filter((x) => Number(x.actual_stock) > Number(x.system_stock));
    const uncounted = items.filter((x) => x.actual_stock === null || x.actual_stock === undefined);

    const buyDiff = counted.reduce((sum, item) => {
      return sum + (Number(item.actual_stock || 0) - Number(item.system_stock || 0)) * Number(item.buy_price || 0);
    }, 0);

    const sellDiff = counted.reduce((sum, item) => {
      return sum + (Number(item.actual_stock || 0) - Number(item.system_stock || 0)) * Number(item.sell_price || 0);
    }, 0);

    return {
      total: items.length,
      counted: counted.length,
      uncounted: uncounted.length,
      matched: matched.length,
      shortage: shortage.length,
      surplus: surplus.length,
      buyDiff,
      sellDiff
    };
  }, [selected]);

  const visibleItems = useMemo(() => {
    const items = selected?.items || [];
    const q = search.trim().toLowerCase();

    return items.filter((item) => {
      const actual = item.actual_stock;
      const diff = actual === null || actual === undefined
        ? null
        : Number(actual) - Number(item.system_stock);

      if (filter === 'uncounted' && actual !== null && actual !== undefined) return false;
      if (filter === 'matched' && diff !== 0) return false;
      if (filter === 'shortage' && !(diff !== null && diff < 0)) return false;
      if (filter === 'surplus' && !(diff !== null && diff > 0)) return false;

      if (!q) return true;

      return [
        item.product_name,
        item.barcode,
        item.size,
        item.color
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [selected, search, filter]);

  useEffect(() => {
    void loadSessions();
  }, []);

  function showMessage(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(''), 1800);
  }

  async function loadSessions() {
    setLoadingSessions(true);

    try {
      const data = await window.api.getStockCountSessions();
      setSessions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load stock count sessions:', error);
      showMessage('حدث خطأ أثناء تحميل جلسات الجرد');
    } finally {
      setLoadingSessions(false);
    }
  }

  async function openSession(sessionId: number) {
    setLoadingDetails(true);

    try {
      const data = await window.api.getStockCountSession(sessionId);
      setSelected(data);
      setSearch('');
      setFilter('all');
      setBarcode('');
      setScanMessage('');
    } catch (error) {
      console.error('Failed to load stock count session:', error);
      showMessage('حدث خطأ أثناء فتح جلسة الجرد');
    } finally {
      setLoadingDetails(false);
    }
  }

  async function createSession() {
    if (!isAdmin) {
      showMessage('إنشاء الجرد متاح للمدير فقط');
      return;
    }

    if (!newTitle.trim()) {
      showMessage('اكتب اسم جلسة الجرد');
      return;
    }

    if (creating) return;

    setCreating(true);

    try {
      const result = await window.api.createStockCountSession({
        title: newTitle.trim(),
        notes: newNotes.trim() || null,
        actor_id: currentUser?.id
      });

      if (result?.success === false) {
        showMessage(result.message || 'فشل إنشاء جلسة الجرد');
        return;
      }

      setNewTitle('');
      setNewNotes('');
      showMessage('تم إنشاء جلسة الجرد');
      await loadSessions();

      if (result?.id) {
        await openSession(result.id);
      }
    } catch (error) {
      console.error('Failed to create stock count session:', error);
      showMessage('حدث خطأ أثناء إنشاء جلسة الجرد');
    } finally {
      setCreating(false);
    }
  }

  function updateLocalActual(itemId: number, value: string) {
    setSelected((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        items: prev.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                actual_stock: value === '' ? null : Number(value)
              }
            : item
        )
      };
    });
  }

  async function saveItem(item: StockCountItem) {
    if (!selected) return;

    const actualStock = Number(item.actual_stock);

    if (!Number.isFinite(actualStock) || actualStock < 0) {
      showMessage('اكتب كمية فعلية صحيحة');
      return;
    }

    setSavingItemId(item.id);

    try {
      const result = await window.api.updateStockCountItem({
        session_id: selected.session.id,
        item_id: item.id,
        actual_stock: actualStock,
        notes: item.notes || null
      });

      if (result?.success === false) {
        showMessage(result.message || 'فشل حفظ الكمية');
        return;
      }

      showMessage('تم حفظ الكمية');
      await openSession(selected.session.id);
    } catch (error) {
      console.error('Failed to save stock count item:', error);
      showMessage('حدث خطأ أثناء حفظ الكمية');
    } finally {
      setSavingItemId(null);
    }
  }

  async function scanBarcode() {
    if (!selected) return;

    const cleanBarcode = barcode.trim();

    if (!cleanBarcode) {
      setScanMessage('امسح أو اكتب الباركود');
      return;
    }

    try {
      const result = await window.api.scanStockCountBarcode({
        session_id: selected.session.id,
        barcode: cleanBarcode,
        quantity: 1
      });

      if (result?.success === false) {
        setScanMessage(result.message || 'فشل قراءة الباركود');
        return;
      }

      setScanMessage(
        `تم عد ${result.product_name || ''} - الكمية الحالية: ${result.actual_stock}`
      );

      setBarcode('');
      await openSession(selected.session.id);
    } catch (error) {
      console.error('Failed to scan stock count barcode:', error);
      setScanMessage('حدث خطأ أثناء قراءة الباركود');
    }
  }

  async function approveSession() {
    if (!selected || !isAdmin || actionLoading) return;

    setActionLoading(true);

    try {
      const result = await window.api.approveStockCountSession({
        session_id: selected.session.id,
        actor_id: currentUser?.id
      });

      if (result?.success === false) {
        showMessage(result.message || 'فشل اعتماد الجرد');
        return;
      }

      setConfirmAction(null);
      showMessage('تم اعتماد الجرد وتحديث المخزون');
      await loadSessions();
      await openSession(selected.session.id);
    } catch (error) {
      console.error('Failed to approve stock count session:', error);
      showMessage('حدث خطأ أثناء اعتماد الجرد');
    } finally {
      setActionLoading(false);
    }
  }

  async function cancelSession() {
    if (!selected || !isAdmin || actionLoading) return;

    setActionLoading(true);

    try {
      const result = await window.api.cancelStockCountSession({
        session_id: selected.session.id,
        actor_id: currentUser?.id
      });

      if (result?.success === false) {
        showMessage(result.message || 'فشل إلغاء الجرد');
        return;
      }

      setConfirmAction(null);
      showMessage('تم إلغاء جلسة الجرد');
      setSelected(null);
      await loadSessions();
    } catch (error) {
      console.error('Failed to cancel stock count session:', error);
      showMessage('حدث خطأ أثناء إلغاء الجرد');
    } finally {
      setActionLoading(false);
    }
  }

  const isOpen = selected?.session?.status === 'open';

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      {message && (
        <div style={toastStyle}>
          {message}
        </div>
      )}

      <section className="glass-card" style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: '0 0 6px' }}>الجرد</h2>
            <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
              إنشاء جلسات جرد، عد الأصناف بالباركود، واعتماد التسويات على المخزون.
            </p>
          </div>

          <button type="button" onClick={loadSessions} style={primaryButtonStyle}>
            {loadingSessions ? 'جاري التحميل...' : 'تحديث'}
          </button>
        </div>

        {isAdmin && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(220px, 1fr) auto', gap: '10px', alignItems: 'end' }}>
            <Field label="اسم جلسة الجرد">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="مثال: جرد آخر الشهر"
                style={inputStyle}
              />
            </Field>

            <Field label="ملاحظات">
              <input
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="اختياري"
                style={inputStyle}
              />
            </Field>

            <button
              type="button"
              onClick={createSession}
              disabled={creating}
              style={{
                ...primaryButtonStyle,
                opacity: creating ? 0.6 : 1
              }}
            >
              {creating ? 'جاري الإنشاء...' : 'إنشاء جرد'}
            </button>
          </div>
        )}
      </section>

      <section className="glass-card" style={cardStyle}>
        <h3 style={{ margin: 0 }}>جلسات الجرد</h3>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: '980px', borderCollapse: 'collapse', direction: 'rtl' }}>
            <thead>
              <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                <th style={thStyle}>#</th>
                <th style={thStyle}>الاسم</th>
                <th style={thStyle}>الحالة</th>
                <th style={thStyle}>الأصناف</th>
                <th style={thStyle}>تم جرده</th>
                <th style={thStyle}>عجز</th>
                <th style={thStyle}>زيادة</th>
                <th style={thStyle}>فرق الشراء</th>
                <th style={thStyle}>المنشئ</th>
                <th style={thStyle}>التاريخ</th>
                <th style={thStyle}>إجراء</th>
              </tr>
            </thead>

            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <td style={tdStyle}>{session.id}</td>
                  <td style={tdStyle}>{session.title}</td>
                  <td style={tdStyle}>
                    <StatusBadge status={session.status} />
                  </td>
                  <td style={tdStyle}>{session.items_count || 0}</td>
                  <td style={tdStyle}>{session.counted_count || 0}</td>
                  <td style={tdStyle}>{session.shortage_count || 0}</td>
                  <td style={tdStyle}>{session.surplus_count || 0}</td>
                  <td style={tdStyle}>{money(session.buy_difference_value || 0)}</td>
                  <td style={tdStyle}>{session.created_by_name || '—'}</td>
                  <td style={tdStyle}>{formatDate(session.created_at)}</td>
                  <td style={tdStyle}>
                    <button
                      type="button"
                      onClick={() => openSession(session.id)}
                      style={smallButtonStyle}
                    >
                      فتح
                    </button>
                  </td>
                </tr>
              ))}

              {sessions.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '26px' }}>
                    لا توجد جلسات جرد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <section className="glass-card" style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: '0 0 6px' }}>
                جلسة #{selected.session.id}: {selected.session.title}
              </h3>
              <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
                الحالة: {statusName(selected.session.status)}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {isAdmin && isOpen && (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmAction('approve')}
                    disabled={actionLoading}
                    style={successButtonStyle}
                  >
                    اعتماد الجرد
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfirmAction('cancel')}
                    disabled={actionLoading}
                    style={dangerButtonStyle}
                  >
                    إلغاء الجرد
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setSelected(null)}
                style={secondaryButtonStyle}
              >
                إغلاق الجلسة
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
            <InfoCard title="إجمالي الأصناف" value={String(summary.total)} />
            <InfoCard title="تم جرده" value={String(summary.counted)} />
            <InfoCard title="غير مجرود" value={String(summary.uncounted)} />
            <InfoCard title="مطابق" value={String(summary.matched)} />
            <InfoCard title="عجز" value={String(summary.shortage)} />
            <InfoCard title="زيادة" value={String(summary.surplus)} />
            <InfoCard title="فرق الشراء" value={money(summary.buyDiff)} />
            <InfoCard title="فرق البيع" value={money(summary.sellDiff)} />
          </div>

          {isOpen && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) auto', gap: '10px', alignItems: 'end' }}>
              <Field label="باركود أو اسم المنتج">
                <input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void scanBarcode();
                    }
                  }}
                  placeholder="امسح الباركود أو اكتب اسم المنتج"
                  style={{ ...inputStyle, direction: 'ltr', textAlign: 'center' }}
                  autoFocus
                />
              </Field>

              <button type="button" onClick={scanBarcode} style={primaryButtonStyle}>
                إضافة للجرد
              </button>

              {scanMessage && (
                <div style={{ gridColumn: '1 / -1', color: '#bfdbfe', fontWeight: 800 }}>
                  {scanMessage}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) 180px', gap: '10px' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالمنتج / الباركود / المقاس / اللون"
              style={inputStyle}
            />

            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              style={inputStyle}
            >
              <option value="all">كل الأصناف</option>
              <option value="uncounted">غير مجرود</option>
              <option value="matched">مطابق</option>
              <option value="shortage">عجز</option>
              <option value="surplus">زيادة</option>
            </select>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '1180px', borderCollapse: 'collapse', direction: 'rtl' }}>
              <thead>
                <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                  <th style={thStyle}>المنتج</th>
                  <th style={thStyle}>باركود</th>
                  <th style={thStyle}>المقاس</th>
                  <th style={thStyle}>اللون</th>
                  <th style={thStyle}>النظام</th>
                  <th style={thStyle}>الفعلي</th>
                  <th style={thStyle}>الفرق</th>
                  <th style={thStyle}>فرق الشراء</th>
                  <th style={thStyle}>ملاحظات</th>
                  <th style={thStyle}>إجراء</th>
                </tr>
              </thead>

              <tbody>
                {loadingDetails && (
                  <tr>
                    <td colSpan={10} style={{ ...tdStyle, textAlign: 'center' }}>
                      جاري التحميل...
                    </td>
                  </tr>
                )}

                {!loadingDetails && visibleItems.map((item) => {
                  const actual = item.actual_stock;
                  const counted = actual !== null && actual !== undefined;
                  const diff = counted ? Number(actual) - Number(item.system_stock) : null;

                  return (
                    <tr key={item.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <td style={tdStyle}>{item.product_name}</td>
                      <td style={tdStyle}>{item.barcode || '—'}</td>
                      <td style={tdStyle}>{item.size || '—'}</td>
                      <td style={tdStyle}>{item.color || '—'}</td>
                      <td style={tdStyle}>{Number(item.system_stock || 0)}</td>

                      <td style={tdStyle}>
                        {isOpen ? (
                          <input
                            type="number"
                            min={0}
                            value={item.actual_stock ?? ''}
                            onChange={(e) => updateLocalActual(item.id, e.target.value)}
                            style={{ ...inputStyle, width: '120px', padding: '8px 10px' }}
                          />
                        ) : (
                          Number(item.actual_stock || 0)
                        )}
                      </td>

                      <td
                        style={{
                          ...tdStyle,
                          fontWeight: 900,
                          color:
                            diff === null
                              ? '#94a3b8'
                              : diff > 0
                                ? '#6ee7b7'
                                : diff < 0
                                  ? '#fca5a5'
                                  : '#cbd5e1'
                        }}
                      >
                        {diff === null ? '—' : diff}
                      </td>

                      <td style={tdStyle}>
                        {diff === null ? '—' : money(diff * Number(item.buy_price || 0))}
                      </td>

                      <td style={tdStyle}>
                        {isOpen ? (
                          <input
                            value={item.notes || ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              setSelected((prev) => {
                                if (!prev) return prev;

                                return {
                                  ...prev,
                                  items: prev.items.map((row) =>
                                    row.id === item.id ? { ...row, notes: value } : row
                                  )
                                };
                              });
                            }}
                            placeholder="ملاحظة"
                            style={{ ...inputStyle, minWidth: '160px', padding: '8px 10px' }}
                          />
                        ) : (
                          item.notes || '—'
                        )}
                      </td>

                      <td style={tdStyle}>
                        {isOpen ? (
                          <button
                            type="button"
                            onClick={() => saveItem(item)}
                            disabled={savingItemId === item.id}
                            style={smallButtonStyle}
                          >
                            {savingItemId === item.id ? 'حفظ...' : 'حفظ'}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}

                {!loadingDetails && visibleItems.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '26px' }}>
                      لا توجد أصناف مطابقة
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {confirmAction && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <h3 style={{ margin: 0, color: confirmAction === 'approve' ? '#86efac' : '#fca5a5' }}>
              {confirmAction === 'approve' ? 'تأكيد اعتماد الجرد' : 'تأكيد إلغاء الجرد'}
            </h3>

            <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.8, fontWeight: 700 }}>
              {confirmAction === 'approve'
                ? 'اعتماد الجرد سيقوم بإنشاء تسويات مخزون تلقائيًا بناءً على الفرق بين الكمية المسجلة والكمية الفعلية.'
                : 'إلغاء جلسة الجرد سيمنع تعديلها أو اعتمادها لاحقًا.'}
            </p>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start' }}>
              <button
                type="button"
                onClick={() => {
                  if (confirmAction === 'approve') {
                    void approveSession();
                  } else {
                    void cancelSession();
                  }
                }}
                disabled={actionLoading}
                style={confirmAction === 'approve' ? successButtonStyle : dangerButtonStyle}
              >
                {actionLoading
                  ? 'جاري التنفيذ...'
                  : confirmAction === 'approve'
                    ? 'تأكيد الاعتماد'
                    : 'تأكيد الإلغاء'}
              </button>

              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                disabled={actionLoading}
                style={secondaryButtonStyle}
              >
                رجوع
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

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div
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

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'approved'
      ? '#6ee7b7'
      : status === 'canceled'
        ? '#fca5a5'
        : '#fdba74';

  return (
    <span
      style={{
        display: 'inline-flex',
        padding: '5px 10px',
        borderRadius: '999px',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        color,
        fontWeight: 900
      }}
    >
      {statusName(status)}
    </span>
  );
}

function statusName(status: string) {
  if (status === 'open') return 'مفتوح';
  if (status === 'approved') return 'معتمد';
  if (status === 'canceled') return 'ملغي';
  return status;
}

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

const cardStyle: React.CSSProperties = {
  padding: '18px',
  borderRadius: '18px',
  display: 'grid',
  gap: '16px',
  direction: 'rtl'
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  borderRadius: '12px',
  padding: '11px 12px',
  outline: 'none',
  boxSizing: 'border-box'
};

const thStyle: React.CSSProperties = {
  padding: '12px',
  borderBottom: '1px solid rgba(255,255,255,0.10)',
  whiteSpace: 'nowrap'
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: '#e5e7eb',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap'
};

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: '12px',
  padding: '11px 16px',
  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
  color: '#fff',
  fontWeight: 900,
  cursor: 'pointer'
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '12px',
  padding: '11px 16px',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  fontWeight: 900,
  cursor: 'pointer'
};

const successButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(34,197,94,0.35)',
  borderRadius: '12px',
  padding: '11px 16px',
  background: 'rgba(34,197,94,0.14)',
  color: '#86efac',
  fontWeight: 900,
  cursor: 'pointer'
};

const dangerButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(239,68,68,0.35)',
  borderRadius: '12px',
  padding: '11px 16px',
  background: 'rgba(239,68,68,0.12)',
  color: '#fca5a5',
  fontWeight: 900,
  cursor: 'pointer'
};

const smallButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '10px',
  padding: '7px 10px',
  background: 'rgba(255,255,255,0.06)',
  color: '#bfdbfe',
  fontWeight: 800,
  cursor: 'pointer'
};

const toastStyle: React.CSSProperties = {
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
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 999999,
  background: 'rgba(0,0,0,0.65)',
  display: 'grid',
  placeItems: 'center',
  padding: '20px'
};

const modalStyle: React.CSSProperties = {
  width: 'min(520px, 100%)',
  borderRadius: '22px',
  background: '#111827',
  border: '1px solid rgba(255,255,255,0.12)',
  padding: '22px',
  direction: 'rtl',
  display: 'grid',
  gap: '16px',
  boxShadow: '0 24px 80px rgba(0,0,0,0.45)'
};