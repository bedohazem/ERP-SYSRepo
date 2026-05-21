import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth.store';

type SaleRow = {
  id: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  cashier_name?: string | null;
  sub_total: number;
  discount_value: number;
  loyalty_discount_value: number;
  grand_total: number;
  paid: number;
  change_amount: number;
  payment_method: string;
  loyalty_points_earned: number;
  loyalty_points_redeemed: number;
  created_at: string;
  items_count: number;
  total_quantity: number;
  returned_quantity: number;
  return_count: number;
  total_return_amount: number;
};

type InvoicesTab = 'sales' | 'returns';

type ReturnRow = {
  id: number;
  code: string;
  original_sale_id: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  cashier_name?: string | null;
  sub_total: number;
  loyalty_discount_value: number;
  refund_amount: number;
  payment_method: string;
  reason?: string | null;
  loyalty_points_reversed: number;
  created_at: string;
  items_count: number;
  total_quantity: number;
};

type ReceiptData = {
  sale: any;
  items: any[];
  loyalty: any[];
};

type ReturnDraftItem = {
  sale_item_id: number;
  variant_id: number;
  product_name: string;
  size?: string | null;
  color?: string | null;
  sold_quantity: number;
  returned_quantity: number;
  returnable_quantity: number;
  return_quantity: number;
  unit_price: number;
};

export default function InvoicesPage() {
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [activeTab, setActiveTab] = useState<InvoicesTab>('sales');
  const [returnRows, setReturnRows] = useState<ReturnRow[]>([]);
  const [returnsTotal, setReturnsTotal] = useState(0);
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptData | null>(null);
  const [selectedReturnHistory, setSelectedReturnHistory] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const user = useAuthStore((s) => s.user);
  

  const [returnReceipt, setReturnReceipt] = useState<ReceiptData | null>(null);
  const [returnItems, setReturnItems] = useState<ReturnDraftItem[]>([]);
  const [returnReason, setReturnReason] = useState('');
  const [savingReturn, setSavingReturn] = useState(false);

  async function loadInvoices() {
    setLoading(true);

    try {
      const result = await window.api.listSales({
        search,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: 100,
        offset: 0
      });

      setRows(Array.isArray(result.rows) ? result.rows : []);
      setTotal(Number(result.total || 0));
    } catch (error) {
      console.error('Failed to load invoices:', error);
      setMessage('حدث خطأ أثناء تحميل الفواتير');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function loadReturns() {
    setReturnsLoading(true);

    try {
      const result = await window.api.listSaleReturns({
        search,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: 100,
        offset: 0
      });

      setReturnRows(Array.isArray(result.rows) ? result.rows : []);
      setReturnsTotal(Number(result.total || 0));
    } catch (error) {
      console.error('Failed to load returns:', error);
      setMessage('حدث خطأ أثناء تحميل سجل المرتجعات');
      setReturnRows([]);
      setReturnsTotal(0);
    } finally {
      setReturnsLoading(false);
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      if (activeTab === 'sales') {
        void loadInvoices();
      } else {
        void loadReturns();
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [search, dateFrom, dateTo, activeTab]);

  async function openReceipt(saleId: number) {
    try {
      const [receipt, history] = await Promise.all([
        window.api.getSaleReceipt(saleId),
        window.api.getSaleReturnHistory(saleId)
      ]);

      setSelectedReceipt(receipt);
      setSelectedReturnHistory(Array.isArray(history) ? history : []);
    } catch (error) {
      console.error('Failed to open receipt:', error);
      setMessage('حدث خطأ أثناء فتح الفاتورة');
    }
  }

  function printReceipt(receipt: ReceiptData) {
    const html = buildReceiptHtml(receipt);
    const printWindow = window.open('', '_blank', 'width=420,height=700');

    if (!printWindow) {
      setMessage('لم يتم فتح نافذة الطباعة');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 350);
  }

  async function openReturnPopup(saleId: number) {
    try {
        const receipt = await window.api.getSaleReceipt(saleId);

        setReturnReceipt(receipt);
        setReturnReason('');

        setReturnItems(
        (receipt.items ?? []).map((item: any) => {
            const soldQty = Number(item.quantity || 0);
            const returnedQty = Number(item.returned_quantity || 0);
            const returnableQty = Math.max(0, soldQty - returnedQty);

            return {
            sale_item_id: Number(item.id),
            variant_id: Number(item.variant_id),
            product_name: item.product_name,
            size: item.size,
            color: item.color,
            sold_quantity: soldQty,
            returned_quantity: returnedQty,
            returnable_quantity: returnableQty,
            return_quantity: 0,
            unit_price: Number(item.unit_price || 0)
            };
        })
        );
    } catch (error) {
        console.error('Failed to open return popup:', error);
        setMessage('حدث خطأ أثناء فتح المرتجع');
    }
    }

  function updateReturnQty(saleItemId: number, qty: number) {
    setReturnItems((prev) =>
        prev.map((item) =>
        item.sale_item_id === saleItemId
            ? {
                ...item,
                return_quantity: Math.max(
                0,
                Math.min(Number(qty || 0), item.returnable_quantity)
                )
            }
            : item
        )
    );
    }

  async function submitReturn() {
    if (savingReturn) return;

    if (!user?.id) {
        setMessage('المستخدم غير مسجل');
        return;
    }

    if (!returnReceipt?.sale?.id) {
        setMessage('الفاتورة الأصلية غير موجودة');
        return;
    }

    const selectedItems = returnItems
        .filter((item) => item.return_quantity > 0)
        .map((item) => ({
        sale_item_id: item.sale_item_id,
        variant_id: item.variant_id,
        quantity: item.return_quantity
        }));

    if (selectedItems.length === 0) {
        setMessage('اختار كمية مرتجع أولا');
        return;
    }

    setSavingReturn(true);

    try {
        const result = await window.api.createSaleReturn({
        original_sale_id: Number(returnReceipt.sale.id),
        user_id: Number(user.id),
        reason: returnReason.trim() || null,
        items: selectedItems
        });

        setMessage(`تم عمل مرتجع ${result.returnCode || `RET-${String(result.returnSaleId).padStart(5, '0')}`}`);
        setReturnReceipt(null);
        setReturnItems([]);
        setReturnReason('');

        await loadInvoices();
        await loadReturns();

        if (returnReceipt?.sale?.id) {
          const [receipt, history] = await Promise.all([
            window.api.getSaleReceipt(Number(returnReceipt.sale.id)),
            window.api.getSaleReturnHistory(Number(returnReceipt.sale.id))
          ]);

          setSelectedReceipt(receipt);
          setSelectedReturnHistory(Array.isArray(history) ? history : []);
        }
        
    } catch (error) {
        console.error('Failed to create return:', error);
        setMessage('حدث خطأ أثناء حفظ المرتجع');
    } finally {
        setSavingReturn(false);
    }
    }

  const returnTotal = returnItems.reduce(
    (sum, item) => sum + item.return_quantity * item.unit_price,
    0
    );

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

      <div
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '18px',
          display: 'grid',
          gap: '14px'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '14px',
            flexWrap: 'wrap',
            direction: 'rtl'
          }}
        >
          <div>
            <h2 style={{ margin: '0 0 6px' }}>سجل الفواتير</h2>
            <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
              عرض الفواتير القديمة وإعادة الطباعة
            </p>
          </div>

          <div style={{ color: '#cbd5e1', fontWeight: 800 }}>
            عدد النتائج: {total}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(260px, 1fr) 180px 180px 120px',
            gap: '12px',
            direction: 'rtl'
          }}
        >
          <input
            placeholder="بحث برقم الفاتورة / العميل / الهاتف / الكاشير"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={inputStyle}
          />

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

          <button
            type="button"
            onClick={() => {
              if (activeTab === 'sales') {
                void loadInvoices();
              } else {
                void loadReturns();
              }
            }}
            style={primaryButtonStyle}
          >
            تحديث
          </button>
        </div>
      </div>

      <div
        className="glass-card"
        style={{
          borderRadius: '18px',
          padding: '10px',
          display: 'flex',
          gap: '10px',
          flexWrap: 'wrap',
          direction: 'rtl'
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('sales')}
          style={tabButtonStyle(activeTab === 'sales')}
        >
          سجل المبيعات
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('returns')}
          style={tabButtonStyle(activeTab === 'returns')}
        >
          سجل المرتجعات
        </button>
      </div>
      {activeTab === 'sales' && (
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
                <th style={thStyle}>رقم</th>
                <th style={thStyle}>التاريخ</th>
                <th style={thStyle}>العميل</th>
                <th style={thStyle}>الكاشير</th>
                <th style={thStyle}>الأصناف</th>
                <th style={thStyle}>المرتجع</th>
                <th style={thStyle}>قبل الخصم</th>
                <th style={thStyle}>خصم النقاط</th>
                <th style={thStyle}>الإجمالي</th>
                <th style={thStyle}>النقاط</th>
                <th style={thStyle}>إجراءات</th>
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td colSpan={11} style={{ ...tdStyle, textAlign: 'center' }}>
                    جاري التحميل...
                  </td>
                </tr>
              )}

              {!loading &&
                rows.map((sale) => (
                  <tr
                    key={sale.id}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <td style={tdStyle}>#{sale.id}</td>
                    <td style={tdStyle}>{formatDate(sale.created_at)}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'grid', gap: '4px' }}>
                        <strong>{sale.customer_name || 'عميل نقدي'}</strong>
                        {sale.customer_phone && (
                          <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                            {sale.customer_phone}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={tdStyle}>{sale.cashier_name || '—'}</td>
                    <td style={tdStyle}>{sale.items_count || 0}</td>
                    <td style={tdStyle}>
                      {Number(sale.returned_quantity || 0) > 0 ? (
                        <div style={{ display: 'grid', gap: '4px' }}>
                          <strong style={{ color: '#fdba74' }}>
                            مرتجع {Number(sale.returned_quantity || 0)} من أصل {Number(sale.total_quantity || 0)}
                          </strong>
                          <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                            عدد المرتجعات: {Number(sale.return_count || 0)}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: '#64748b' }}>—</span>
                      )}
                    </td>
                    <td style={tdStyle}>{money(sale.sub_total)}</td>
                    <td style={tdStyle}>{money(sale.loyalty_discount_value || 0)}</td>
                    <td style={{ ...tdStyle, fontWeight: 900, color: '#6ee7b7' }}>
                      {money(sale.grand_total)}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: '#22c55e' }}>
                        +{sale.loyalty_points_earned || 0}
                      </span>
                      {' / '}
                      <span style={{ color: '#f87171' }}>
                        -{sale.loyalty_points_redeemed || 0}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => openReceipt(sale.id)}
                          style={smallButtonStyle}
                        >
                          عرض
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            const receipt = await window.api.getSaleReceipt(sale.id);
                            printReceipt(receipt);
                          }}
                          style={smallButtonStyle}
                        >
                          طباعة
                        </button>

                      <button
                        type="button"
                        onClick={() => openReturnPopup(sale.id)}
                        style={{
                            ...smallButtonStyle,
                            borderColor: '#f97316',
                            color: '#fdba74',
                            background: 'rgba(249,115,22,0.10)'
                        }}
                        >
                        مرتجع
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
                    لا توجد فواتير
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}  

      {activeTab === 'returns' && (
        <div
          className="glass-card"
          style={{
            padding: '18px',
            borderRadius: '18px',
            overflowX: 'auto'
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              marginBottom: '14px',
              direction: 'rtl'
            }}
          >
            <h3 style={{ margin: 0 }}>سجل المرتجعات</h3>

            <div style={{ color: '#cbd5e1', fontWeight: 800 }}>
              عدد المرتجعات: {returnsTotal}
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
            <thead>
              <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                <th style={thStyle}>رقم المرتجع</th>
                <th style={thStyle}>الفاتورة الأصلية</th>
                <th style={thStyle}>التاريخ</th>
                <th style={thStyle}>العميل</th>
                <th style={thStyle}>المستخدم</th>
                <th style={thStyle}>الأصناف</th>
                <th style={thStyle}>الكمية</th>
                <th style={thStyle}>قيمة المرتجع</th>
                <th style={thStyle}>السبب</th>
                <th style={thStyle}>إجراءات</th>
              </tr>
            </thead>

            <tbody>
              {returnsLoading && (
                <tr>
                  <td colSpan={10} style={{ ...tdStyle, textAlign: 'center' }}>
                    جاري التحميل...
                  </td>
                </tr>
              )}

              {!returnsLoading &&
                returnRows.map((ret) => (
                  <tr
                    key={ret.id}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 900, color: '#fdba74' }}>
                      {ret.code}
                    </td>

                    <td style={tdStyle}>#{ret.original_sale_id}</td>

                    <td style={tdStyle}>{formatDate(ret.created_at)}</td>

                    <td style={tdStyle}>
                      <div style={{ display: 'grid', gap: '4px' }}>
                        <strong>{ret.customer_name || 'عميل نقدي'}</strong>
                        {ret.customer_phone && (
                          <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                            {ret.customer_phone}
                          </span>
                        )}
                      </div>
                    </td>

                    <td style={tdStyle}>{ret.cashier_name || '—'}</td>

                    <td style={tdStyle}>{ret.items_count || 0}</td>

                    <td style={tdStyle}>{Number(ret.total_quantity || 0)}</td>

                    <td style={{ ...tdStyle, color: '#fca5a5', fontWeight: 900 }}>
                      {money(ret.refund_amount)}
                    </td>

                    <td style={tdStyle}>{ret.reason || '—'}</td>

                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => openReceipt(ret.original_sale_id)}
                          style={smallButtonStyle}
                        >
                          عرض الفاتورة
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

              {!returnsLoading && returnRows.length === 0 && (
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
                    لا توجد مرتجعات
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedReceipt && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.60)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            style={{
              width: '760px',
              maxWidth: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              borderRadius: '18px',
              border: '1px solid rgba(255,255,255,0.10)',
              background: '#111827',
              padding: '22px',
              direction: 'rtl',
              boxShadow: '0 24px 70px rgba(0,0,0,0.55)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '14px',
                alignItems: 'center',
                marginBottom: '18px'
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 6px' }}>
                  فاتورة #{selectedReceipt.sale.id}
                </h3>
                <div style={{ color: '#94a3b8', fontWeight: 700 }}>
                  {formatDate(selectedReceipt.sale.created_at)}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px',
                marginBottom: '18px'
              }}
            >
              <div style={statCardStyle}>
                العميل
                <strong>{selectedReceipt.sale.customer_name || 'عميل نقدي'}</strong>
              </div>
              <div style={statCardStyle}>
                الكاشير
                <strong>{selectedReceipt.sale.cashier_name || '—'}</strong>
              </div>
              <div style={statCardStyle}>
                الإجمالي
                <strong>{money(selectedReceipt.sale.grand_total)}</strong>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                  <th style={thStyle}>الصنف</th>
                  <th style={thStyle}>المقاس</th>
                  <th style={thStyle}>اللون</th>
                  <th style={thStyle}>الكمية</th>
                  <th style={thStyle}>المرتجع</th>
                  <th style={thStyle}>السعر</th>
                  <th style={thStyle}>الإجمالي</th>
                </tr>
              </thead>

              <tbody>
                {(selectedReceipt.items ?? []).map((item) => (
                  <tr
                    key={item.id}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <td style={tdStyle}>{item.product_name}</td>
                    <td style={tdStyle}>{item.size || '—'}</td>
                    <td style={tdStyle}>{item.color || '—'}</td>
                    <td style={tdStyle}>{item.quantity}</td>
                    <td style={tdStyle}>
                      {Number(item.returned_quantity || 0) > 0 ? (
                        <span style={{ color: '#fdba74', fontWeight: 900 }}>
                          {Number(item.returned_quantity || 0)} من أصل {Number(item.quantity || 0)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={tdStyle}>{money(item.unit_price)}</td>
                    <td style={tdStyle}>{money(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {selectedReturnHistory.length > 0 && (
              <div
                style={{
                  marginTop: '18px',
                  padding: '14px',
                  borderRadius: '14px',
                  background: 'rgba(249,115,22,0.10)',
                  border: '1px solid rgba(249,115,22,0.25)',
                  display: 'grid',
                  gap: '12px'
                }}
              >
                <div style={{ color: '#fed7aa', fontWeight: 900 }}>
                  سجل المرتجعات على هذه الفاتورة
                </div>

                {selectedReturnHistory.map((ret) => (
                  <div
                    key={ret.id}
                    style={{
                      padding: '12px',
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      display: 'grid',
                      gap: '8px'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '12px',
                        flexWrap: 'wrap',
                        color: '#fff',
                        fontWeight: 800
                      }}
                    >
                      <span>مرتجع #{ret.id}</span>
                      <span>{formatDate(ret.created_at)}</span>
                      <span>{money(ret.grand_total)}</span>
                    </div>

                    <div style={{ color: '#94a3b8', fontWeight: 700 }}>
                      السبب: {ret.return_reason || '—'} | المستخدم: {ret.cashier_name || '—'}
                    </div>

                    <div style={{ display: 'grid', gap: '6px' }}>
                      {(ret.items || []).map((item: any) => (
                        <div
                          key={item.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '10px',
                            color: '#e5e7eb',
                            fontSize: '13px'
                          }}
                        >
                          <span>
                            {item.product_name} {item.size || ''} {item.color || ''}
                          </span>
                          <strong>
                            كمية: {Number(item.quantity || 0)} | {money(item.line_total)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gap: '8px',
                marginTop: '18px',
                maxWidth: '360px',
                marginRight: 'auto'
              }}
            >
              <SummaryLine label="الإجمالي قبل الخصم" value={money(selectedReceipt.sale.sub_total)} />
              <SummaryLine label="خصم عادي" value={money(selectedReceipt.sale.discount_value || 0)} />
              <SummaryLine label="خصم النقاط" value={money(selectedReceipt.sale.loyalty_discount_value || 0)} />
              <SummaryLine label="الإجمالي النهائي" value={money(selectedReceipt.sale.grand_total)} strong />
              <SummaryLine label="النقاط المكتسبة" value={`${selectedReceipt.sale.loyalty_points_earned || 0}`} />
              <SummaryLine label="النقاط المستخدمة" value={`${selectedReceipt.sale.loyalty_points_redeemed || 0}`} />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-start',
                gap: '10px',
                marginTop: '22px'
              }}
            >
              <button
                type="button"
                onClick={() => printReceipt(selectedReceipt)}
                style={primaryButtonStyle}
              >
                طباعة الفاتورة
              </button>

              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                style={secondaryButtonStyle}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {returnReceipt && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.60)',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            style={{
              width: '860px',
              maxWidth: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              borderRadius: '18px',
              border: '1px solid rgba(255,255,255,0.10)',
              background: '#111827',
              padding: '22px',
              direction: 'rtl',
              boxShadow: '0 24px 70px rgba(0,0,0,0.55)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '14px',
                alignItems: 'center',
                marginBottom: '18px'
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 6px' }}>
                  مرتجع فاتورة #{returnReceipt.sale.id}
                </h3>
                <div style={{ color: '#94a3b8', fontWeight: 700 }}>
                  العميل: {returnReceipt.sale.customer_name || 'عميل نقدي'}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setReturnReceipt(null);
                  setReturnItems([]);
                  setReturnReason('');
                  setSelectedReceipt(null);
                  setSelectedReturnHistory([]);
                }}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <div
              style={{
                padding: '14px',
                borderRadius: '14px',
                background: 'rgba(249,115,22,0.10)',
                border: '1px solid rgba(249,115,22,0.25)',
                color: '#fed7aa',
                fontWeight: 700,
                marginBottom: '16px'
              }}
            >
              اختار الكمية المطلوب إرجاعها لكل صنف. الكمية المتاحة للمرتجع بتقل لو الصنف
              اتعمله مرتجع قبل كده.
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                  <th style={thStyle}>الصنف</th>
                  <th style={thStyle}>المقاس</th>
                  <th style={thStyle}>اللون</th>
                  <th style={thStyle}>المباع</th>
                  <th style={thStyle}>اترجع</th>
                  <th style={thStyle}>المتاح</th>
                  <th style={thStyle}>كمية المرتجع</th>
                  <th style={thStyle}>قيمة المرتجع</th>
                </tr>
              </thead>

              <tbody>
                {returnItems.map((item) => (
                  <tr
                    key={item.sale_item_id}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <td style={tdStyle}>{item.product_name}</td>
                    <td style={tdStyle}>{item.size || '—'}</td>
                    <td style={tdStyle}>{item.color || '—'}</td>
                    <td style={tdStyle}>{item.sold_quantity}</td>
                    <td style={tdStyle}>{item.returned_quantity}</td>
                    <td style={tdStyle}>{item.returnable_quantity}</td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        min={0}
                        max={item.returnable_quantity}
                        disabled={item.returnable_quantity <= 0}
                        value={item.return_quantity}
                        onChange={(e) =>
                          updateReturnQty(item.sale_item_id, Number(e.target.value))
                        }
                        style={{
                          ...inputStyle,
                          width: '110px',
                          textAlign: 'center',
                          opacity: item.returnable_quantity <= 0 ? 0.5 : 1
                        }}
                      />
                    </td>
                    <td style={tdStyle}>
                      {money(item.return_quantity * item.unit_price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'grid', gap: '10px', marginTop: '18px' }}>
              <label style={{ color: '#cbd5e1', fontWeight: 800 }}>
                سبب المرتجع
              </label>

              <input
                placeholder="مثال: مقاس غير مناسب / عيب في المنتج"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '14px',
                marginTop: '22px',
                flexWrap: 'wrap'
              }}
            >
              <div
                style={{
                  padding: '14px 18px',
                  borderRadius: '14px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#fff',
                  fontWeight: 900
                }}
              >
                إجمالي المرتجع: {money(returnTotal)}
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={submitReturn}
                  disabled={savingReturn || returnTotal <= 0}
                  style={{
                    ...primaryButtonStyle,
                    opacity: savingReturn || returnTotal <= 0 ? 0.6 : 1,
                    cursor:
                      savingReturn || returnTotal <= 0
                        ? 'not-allowed'
                        : 'pointer'
                  }}
                >
                  {savingReturn ? 'جاري الحفظ...' : 'حفظ المرتجع'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setReturnReceipt(null);
                    setReturnItems([]);
                    setReturnReason('');
                  }}
                  style={secondaryButtonStyle}
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryLine({
  label,
  value,
  strong
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        color: strong ? '#fff' : '#cbd5e1',
        fontWeight: strong ? 900 : 700,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        paddingTop: '8px'
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function money(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`;
}

function formatDate(value?: string) {
  if (!value) return '—';

  try {
    const raw = String(value);

    // SQLite CURRENT_TIMESTAMP بيرجع UTC بالشكل ده:
    // 2026-04-27 10:30:00
    // فلازم نعلّمه إنه UTC بإضافة Z
    const normalized = raw.includes('T')
      ? raw
      : raw.replace(' ', 'T') + 'Z';

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

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

  function buildReceiptHtml(receipt: ReceiptData) {
    const rows = (receipt.items ?? [])
      .map(
        (item) => `
          <tr>
            <td>
              ${escapeHtml(item.product_name)}
              ${item.size ? `<div class="muted">المقاس: ${escapeHtml(item.size)}</div>` : ''}
              ${item.color ? `<div class="muted">اللون: ${escapeHtml(item.color)}</div>` : ''}
            </td>
            <td>${escapeHtml(item.quantity)}</td>
            <td>${Number(item.unit_price || 0).toFixed(2)}</td>
            <td>${Number(item.line_total || 0).toFixed(2)}</td>
          </tr>
        `
      )
      .join('');

    const sale = receipt.sale;

    return `
      <!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />
          <title>فاتورة #${escapeHtml(sale.id)}</title>

          <style>
            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              padding: 14px;
              font-family: Arial, Tahoma, sans-serif;
              color: #111;
              background: #fff;
              font-size: 12px;
            }

            .receipt {
              width: 280px;
              margin: 0 auto;
            }

            h2,
            p {
              margin: 0;
            }

            .center {
              text-align: center;
            }

            .muted {
              color: #555;
              font-size: 11px;
              line-height: 1.5;
            }

            .line {
              border-top: 1px dashed #777;
              margin: 10px 0;
            }

            .row {
              display: flex;
              justify-content: space-between;
              gap: 8px;
              margin: 5px 0;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 8px;
            }

            th,
            td {
              padding: 5px 0;
              border-bottom: 1px dashed #ddd;
              text-align: right;
              vertical-align: top;
            }

            th {
              font-size: 11px;
              color: #333;
            }

            .total {
              font-weight: 800;
              font-size: 14px;
            }

            @media print {
              body {
                padding: 0;
              }

              .receipt {
                width: 100%;
              }
            }
          </style>
        </head>

        <body>
          <div class="receipt">
            <div class="center">
              <h2>فاتورة بيع</h2>
              <p class="muted">رقم الفاتورة: #${escapeHtml(sale.id)}</p>
              <p class="muted">${escapeHtml(formatDate(sale.created_at))}</p>
            </div>

            <div class="line"></div>

            <div class="row">
              <span>العميل</span>
              <strong>${escapeHtml(sale.customer_name || 'عميل نقدي')}</strong>
            </div>

            <div class="row">
              <span>الكاشير</span>
              <strong>${escapeHtml(sale.cashier_name || '-')}</strong>
            </div>

            <table>
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>كمية</th>
                  <th>سعر</th>
                  <th>إجمالي</th>
                </tr>
              </thead>

              <tbody>
                ${rows}
              </tbody>
            </table>

            <div class="line"></div>

            <div class="row">
              <span>الإجمالي قبل الخصم</span>
              <strong>${Number(sale.sub_total || 0).toFixed(2)} ج.م</strong>
            </div>

            <div class="row">
              <span>خصم النقاط</span>
              <strong>${Number(sale.loyalty_discount_value || 0).toFixed(2)} ج.م</strong>
            </div>

            <div class="row total">
              <span>الإجمالي النهائي</span>
              <strong>${Number(sale.grand_total || 0).toFixed(2)} ج.م</strong>
            </div>

            <div class="line"></div>

            <div class="row">
              <span>نقاط مستخدمة</span>
              <strong>${escapeHtml(sale.loyalty_points_redeemed || 0)}</strong>
            </div>

            <div class="row">
              <span>نقاط مكتسبة</span>
              <strong>${escapeHtml(sale.loyalty_points_earned || 0)}</strong>
            </div>

            <div class="line"></div>

            <p class="center muted">شكرًا لتعاملكم معنا</p>
          </div>
        </body>
      </html>
    `;
  }

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

const statCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: '8px',
  padding: '14px',
  borderRadius: '14px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#94a3b8'
};

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: active
      ? '1px solid rgba(96,165,250,0.55)'
      : '1px solid rgba(255,255,255,0.10)',
    minHeight: '44px',
    borderRadius: '14px',
    background: active
      ? 'linear-gradient(135deg, rgba(37,99,235,0.95), rgba(124,58,237,0.95))'
      : 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontWeight: 900,
    padding: '0 18px',
    cursor: 'pointer',
    boxShadow: active ? '0 12px 26px rgba(37,99,235,0.22)' : 'none'
  };
}