import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth.store';
import {
  CASH_ACCOUNT_OPTIONS,
  getPaymentMethodLabel
} from '../../utils/payment-method';

type PurchaseRow = {
  id: number;
  supplier_id: number;
  supplier_name: string;
  supplier_phone?: string | null;
  total_amount: number;
  sub_total?: number;
  discount_type?: 'amount' | 'percent' | string;
  discount_input?: number;
  discount_value?: number;
  paid_amount: number;
  remaining_amount: number;
  payment_status: 'paid' | 'partial' | 'unpaid' | 'cancelled' | string;
  payment_method?: string | null;
  notes?: string | null;
  created_at: string;
  items_count: number;
  status?: 'active' | 'cancelled' | string;
  returned_amount?: number;
};

type PurchaseReturnRow = {
  id: number;
  purchase_id: number;
  supplier_id: number;
  supplier_name: string;
  supplier_phone?: string | null;
  total_amount: number;
  notes?: string | null;
  created_at: string;
  items_count: number;
};

type ActiveTab = 'purchases' | 'returns';

export default function PurchaseHistoryPage() {
  const currentUser = useAuthStore((s) => s.user);

  const [activeTab, setActiveTab] = useState<ActiveTab>('purchases');

  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [total, setTotal] = useState(0);

  const [returnRows, setReturnRows] = useState<PurchaseReturnRow[]>([]);
  const [returnTotal, setReturnTotal] = useState(0);

  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [selectedPurchase, setSelectedPurchase] = useState<any | null>(null);
  const [selectedReturn, setSelectedReturn] = useState<any | null>(null);

  const [paymentPurchase, setPaymentPurchase] = useState<PurchaseRow | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('store_cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  const [returnPurchase, setReturnPurchase] = useState<any | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<number, string>>({});
  const [returnNotes, setReturnNotes] = useState('');
  const [savingReturn, setSavingReturn] = useState(false);

  const [cancelPurchaseTarget, setCancelPurchaseTarget] = useState<PurchaseRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancellingPurchase, setCancellingPurchase] = useState(false);

  const currentTotal = activeTab === 'purchases' ? total : returnTotal;

  function showMessage(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(''), 2200);
  }

  function getErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }

  async function loadPurchases() {
    setLoading(true);

    try {
      const result = await window.api.listPurchaseInvoices({
        search,
        limit: 100,
        offset: 0
      });

      setRows(Array.isArray(result.rows) ? result.rows : []);
      setTotal(Number(result.total || 0));
    } catch (error) {
      console.error('Failed to load purchase invoices:', error);
      showMessage('حدث خطأ أثناء تحميل فواتير الشراء');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function loadReturns() {
    setLoading(true);

    try {
      const result = await window.api.listPurchaseReturns({
        search,
        limit: 100,
        offset: 0
      });

      setReturnRows(Array.isArray(result.rows) ? result.rows : []);
      setReturnTotal(Number(result.total || 0));
    } catch (error) {
      console.error('Failed to load purchase returns:', error);
      showMessage('حدث خطأ أثناء تحميل مرتجعات الشراء');
      setReturnRows([]);
      setReturnTotal(0);
    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    const handle = setTimeout(() => {
      if (activeTab === 'returns') {
        void loadReturns();
      } else {
        void loadPurchases();
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [search, activeTab]);

  async function openDetails(purchaseId: number) {
    try {
      const data = await window.api.getPurchaseInvoice(purchaseId);
      setSelectedPurchase(data);
    } catch (error) {
      console.error('Failed to open purchase invoice:', error);
      showMessage('حدث خطأ أثناء فتح تفاصيل الفاتورة');
    }
  }

  async function openReturnDetails(returnId: number) {
    try {
      const data = await window.api.getPurchaseReturn(returnId);
      setSelectedReturn(data);
    } catch (error) {
      console.error('Failed to open purchase return:', error);
      showMessage('حدث خطأ أثناء فتح تفاصيل المرتجع');
    }
  }

  function openPayment(row: PurchaseRow) {
    if (row.status === 'cancelled' || row.payment_status === 'cancelled') {
      showMessage('لا يمكن تسجيل دفعة على فاتورة ملغاة');
      return;
    }

    setPaymentPurchase(row);
    setPaymentAmount(String(Number(row.remaining_amount || 0)));
    setPaymentMethod(row.payment_method || 'store_cash');
    setPaymentNotes('');
  }

  async function savePayment() {
    if (!paymentPurchase || savingPayment) return;

    const amount = Number(paymentAmount || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      showMessage('اكتب مبلغ صحيح');
      return;
    }

    setSavingPayment(true);

    try {
      const result = await window.api.recordSupplierPayment({
        supplier_id: paymentPurchase.supplier_id,
        purchase_id: paymentPurchase.id,
        amount,
        payment_method: paymentMethod,
        notes: paymentNotes.trim() || null,
        actor_id: currentUser?.id
      });

      showMessage(`تم تسجيل دفعة ${money(result.paid_amount)}`);

      setPaymentPurchase(null);
      setPaymentAmount('');
      setPaymentNotes('');

      await loadPurchases();

      if (selectedPurchase?.purchase?.id === paymentPurchase.id) {
        const data = await window.api.getPurchaseInvoice(paymentPurchase.id);
        setSelectedPurchase(data);
      }
    } catch (error) {
      console.error('Failed to record supplier payment:', error);
      showMessage(getErrorMessage(error, 'حدث خطأ أثناء تسجيل الدفعة'));
    } finally {
      setSavingPayment(false);
    }
  }

  function openCancelPurchaseModal(row: PurchaseRow) {
    if (row.status === 'cancelled' || row.payment_status === 'cancelled') {
      showMessage('فاتورة الشراء ملغاة بالفعل');
      return;
    }

    const hasReturns = Number(row.returned_amount || 0) > 0;

    if (hasReturns) {
      showMessage('لا يمكن إلغاء فاتورة تم عمل مرتجع عليها');
      return;
    }

    setCancelPurchaseTarget(row);
    setCancelReason('إلغاء فاتورة شراء');
  }

  async function saveCancelPurchase() {
    if (!cancelPurchaseTarget || cancellingPurchase) return;

    setCancellingPurchase(true);

    try {
      const result = await window.api.cancelPurchaseInvoice({
        purchase_id: cancelPurchaseTarget.id,
        reason: cancelReason.trim() || 'إلغاء فاتورة شراء',
        actor_id: currentUser?.id
      });

      showMessage(`تم إلغاء الفاتورة وخصم ${result.items_count} صنف من المخزون`);

      const cancelledId = cancelPurchaseTarget.id;
      setCancelPurchaseTarget(null);
      setCancelReason('');

      await loadPurchases();

      if (selectedPurchase?.purchase?.id === cancelledId) {
        setSelectedPurchase(null);
      }
    } catch (error) {
      console.error('Failed to cancel purchase invoice:', error);
      showMessage(getErrorMessage(error, 'حدث خطأ أثناء إلغاء فاتورة الشراء'));
    } finally {
      setCancellingPurchase(false);
    }
  }

  async function openReturnModal(row: PurchaseRow) {
    if (row.status === 'cancelled' || row.payment_status === 'cancelled') {
      showMessage('لا يمكن عمل مرتجع على فاتورة ملغاة');
      return;
    }

    try {
      const data = await window.api.getPurchaseInvoice(row.id);
      setReturnPurchase(data);
      setReturnNotes('');
      setReturnQuantities({});
    } catch (error) {
      console.error('Failed to open purchase return modal:', error);
      showMessage('حدث خطأ أثناء تجهيز مرتجع الشراء');
    }
  }

  function updateReturnQuantity(itemId: number, value: string) {
    setReturnQuantities((prev) => ({
      ...prev,
      [itemId]: value
    }));
  }

  async function savePurchaseReturn() {
    if (!returnPurchase || savingReturn) return;

    const items = (returnPurchase.items ?? [])
      .map((item: any) => {
        const quantity = Number(returnQuantities[item.id] || 0);

        return {
          purchase_item_id: Number(item.id),
          variant_id: Number(item.variant_id),
          quantity
        };
      })
      .filter((item: { quantity: number }) => Number.isFinite(item.quantity) && item.quantity > 0);

    if (items.length === 0) {
      showMessage('حدد كمية مرتجع لصنف واحد على الأقل');
      return;
    }

    const invalidItem = (returnPurchase.items ?? []).find((item: any) => {
      const quantity = Number(returnQuantities[item.id] || 0);
      const maxQuantity = Number(item.returnable_quantity ?? item.quantity ?? 0);

      return quantity > maxQuantity;
    });

    if (invalidItem) {
      showMessage(`كمية المرتجع للصنف ${invalidItem.product_name} أكبر من المتاح`);
      return;
    }

    setSavingReturn(true);

    try {
      const result = await window.api.createPurchaseReturn({
        purchase_id: Number(returnPurchase.purchase.id),
        notes: returnNotes.trim() || null,
        actor_id: currentUser?.id,
        items
      });

      showMessage(`تم إنشاء مرتجع شراء بقيمة ${money(result.total_amount)}`);

      setReturnPurchase(null);
      setReturnQuantities({});
      setReturnNotes('');

      await loadPurchases();

      if (activeTab === 'returns') {
        await loadReturns();
      }

      if (selectedPurchase?.purchase?.id === returnPurchase.purchase.id) {
        const data = await window.api.getPurchaseInvoice(returnPurchase.purchase.id);
        setSelectedPurchase(data);
      }
    } catch (error) {
      console.error('Failed to create purchase return:', error);
      showMessage(getErrorMessage(error, 'حدث خطأ أثناء إنشاء مرتجع الشراء'));
    } finally {
      setSavingReturn(false);
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: '10px',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        gridTemplateRows: 'auto minmax(0, 1fr)'
      }}
    >
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

      <div
        className="glass-card"
        style={{
          padding: '12px 14px',
          borderRadius: '16px',
          display: 'grid',
          gap: '10px'
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            gap: '12px',
            alignItems: 'center',
            direction: 'rtl'
          }}
        >
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', lineHeight: 1.2 }}>
              سجل فواتير الشراء
            </h2>

            <p
              style={{
                margin: '4px 0 0',
                color: '#94a3b8',
                fontWeight: 700,
                fontSize: '12px'
              }}
            >
              متابعة فواتير الموردين ومرتجعات الشراء
            </p>
          </div>

          <div
            style={{
              color: '#cbd5e1',
              fontWeight: 900,
              fontSize: '13px',
              whiteSpace: 'nowrap'
            }}
          >
            عدد النتائج: {currentTotal}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(260px, 1fr)',
            gap: '10px',
            alignItems: 'center',
            direction: 'rtl'
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'nowrap'
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('purchases')}
              style={activeTab === 'purchases' ? activeTabButtonStyle : tabButtonStyle}
            >
              فواتير الشراء
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('returns')}
              style={activeTab === 'returns' ? activeTabButtonStyle : tabButtonStyle}
            >
              مرتجعات الشراء
            </button>
          </div>

          <input
            placeholder={
              activeTab === 'returns'
                ? 'بحث برقم المرتجع / رقم الفاتورة / اسم المورد / الهاتف'
                : 'بحث برقم الفاتورة / اسم المورد / الهاتف'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              ...inputStyle,
              height: '38px'
            }}
          />
        </div>
      </div>

      {activeTab === 'purchases' && (
        <div
          className="glass-card table-scroll"
          style={{
            padding: '10px 12px',
            borderRadius: '16px',
            overflow: 'auto',
            height: '100%',
            minHeight: 0,
            maxWidth: '100%',
            boxSizing: 'border-box'
          }}
        >
          <table
            style={{
              width: '100%',
              minWidth: '900px',
              borderCollapse: 'collapse',
              direction: 'rtl'
            }}
          >
            <thead>
              <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                <th style={thStyle}>رقم</th>
                <th style={thStyle}>المورد</th>
                <th style={thStyle}>الأصناف</th>
                <th style={thStyle}>المبلغ</th>
                <th style={thStyle}>الدفع / الحساب</th>
                <th style={thStyle}>الحالة</th>
                <th style={thStyle}>إجراءات</th>
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
                rows.map((row) => {
                  const isCancelled = row.status === 'cancelled' || row.payment_status === 'cancelled';
                  const hasReturns = Number(row.returned_amount || 0) > 0;

                  return (
                    <tr
                      key={row.id}
                      style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <td style={tdStyle}>#{row.id}</td>

                      <td style={tdStyle}>
                        <div style={{ display: 'grid', gap: '4px', minWidth: '150px' }}>
                          <strong>{row.supplier_name}</strong>
                          {row.supplier_phone && (
                            <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                              {row.supplier_phone}
                            </span>
                          )}
                        </div>
                      </td>

                      <td style={tdStyle}>
                        <div style={{ display: 'grid', gap: '4px' }}>
                          <strong>{row.items_count || 0}</strong>
                          {hasReturns && (
                            <span style={{ color: '#fbbf24', fontSize: '12px', fontWeight: 900 }}>
                              مرتجع: {money(row.returned_amount || 0)}
                            </span>
                          )}
                        </div>
                      </td>

                      <td style={tdStyle}>
                        <div style={{ display: 'grid', gap: '4px', minWidth: '130px' }}>
                          <strong style={{ color: isCancelled ? '#94a3b8' : '#6ee7b7' }}>
                            الإجمالي: {money(row.total_amount)}
                          </strong>

                          <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                            قبل الخصم: {money(
                              Number(row.sub_total || 0) > 0
                                ? row.sub_total
                                : Number(row.total_amount || 0) + Number(row.discount_value || 0)
                            )}
                          </span>

                          {Number(row.discount_value || 0) > 0 && (
                            <span style={{ color: '#fbbf24', fontSize: '12px' }}>
                              خصم: {money(row.discount_value || 0)}
                              {row.discount_type === 'percent' && Number(row.discount_input || 0) > 0
                                ? ` (${Number(row.discount_input || 0)}%)`
                                : ''}
                            </span>
                          )}
                        </div>
                      </td>

                      <td style={tdStyle}>
                        <div style={{ display: 'grid', gap: '4px', minWidth: '130px' }}>
                          <span style={{ color: '#6ee7b7', fontWeight: 900 }}>
                            مدفوع: {money(row.paid_amount)}
                          </span>

                          <span
                            style={{
                              color: Number(row.remaining_amount || 0) > 0 ? '#fca5a5' : '#94a3b8',
                              fontSize: '12px',
                              fontWeight: 800
                            }}
                          >
                            متبقي: {money(row.remaining_amount)}
                          </span>

                          <span style={{ color: '#bfdbfe', fontSize: '12px' }}>
                            {getPaymentMethodLabel(row.payment_method)}
                          </span>
                        </div>
                      </td>

                      <td style={tdStyle}>
                        <PaymentStatusBadge status={isCancelled ? 'cancelled' : row.payment_status} />
                      </td>

                      <td style={tdStyle}>
                        <div
                          style={{
                            display: 'flex',
                            gap: '6px',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            minWidth: '150px',
                            maxWidth: '175px'
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => openDetails(row.id)}
                            style={smallButtonStyle}
                          >
                            عرض
                          </button>

                          {!isCancelled && Number(row.remaining_amount || 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => openPayment(row)}
                              style={{
                                ...smallButtonStyle,
                                borderColor: 'rgba(148,163,184,0.35)',
                                color: '#dbeafe',
                                background: 'rgba(148,163,184,0.08)'
                              }}
                            >
                              دفعة
                            </button>
                          )}

                          {!isCancelled && (
                            <button
                              type="button"
                              onClick={() => openReturnModal(row)}
                              style={{
                                ...smallButtonStyle,
                                borderColor: 'rgba(245,158,11,0.45)',
                                color: '#fcd34d',
                                background: 'rgba(245,158,11,0.08)'
                              }}
                            >
                              مرتجع
                            </button>
                          )}

                          {!isCancelled && !hasReturns && (
                            <button
                              type="button"
                              onClick={() => openCancelPurchaseModal(row)}
                              style={{
                                ...smallButtonStyle,
                                borderColor: 'rgba(239,68,68,0.45)',
                                color: '#fca5a5',
                                background: 'rgba(239,68,68,0.08)'
                              }}
                            >
                              إلغاء
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

              {!loading && rows.length === 0 && (
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
                    لا توجد فواتير شراء
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'returns' && (
        <div
          className="glass-card table-scroll"
          style={{
            padding: '10px 12px',
            borderRadius: '16px',
            overflow: 'auto',
            height: '100%',
            minHeight: 0,
            maxWidth: '100%',
            boxSizing: 'border-box'
          }}
        >
          <table
            style={{
              width: '100%',
              minWidth: '860px',
              borderCollapse: 'collapse',
              direction: 'rtl',
            }}
          >
            <thead>
              <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                <th style={thStyle}>رقم المرتجع</th>
                <th style={thStyle}>فاتورة الشراء</th>
                <th style={thStyle}>المورد</th>
                <th style={thStyle}>الأصناف</th>
                <th style={thStyle}>قيمة المرتجع</th>
                <th style={thStyle}>التاريخ</th>
                <th style={thStyle}>إجراءات</th>
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
                returnRows.map((row) => (
                  <tr
                    key={row.id}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <td style={tdStyle}>#{row.id}</td>
                    <td style={tdStyle}>#{row.purchase_id}</td>

                    <td style={tdStyle}>
                      <div style={{ display: 'grid', gap: '4px', minWidth: '150px' }}>
                        <strong>{row.supplier_name}</strong>
                        {row.supplier_phone && (
                          <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                            {row.supplier_phone}
                          </span>
                        )}
                      </div>
                    </td>

                    <td style={tdStyle}>{row.items_count || 0}</td>
                    <td style={{ ...tdStyle, color: '#fbbf24', fontWeight: 900 }}>
                      {money(row.total_amount)}
                    </td>
                    <td style={tdStyle}>{formatDate(row.created_at)}</td>

                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => openReturnDetails(row.id)}
                          style={smallButtonStyle}
                        >
                          عرض
                        </button>

                        <button
                          type="button"
                          onClick={() => openDetails(row.purchase_id)}
                          style={smallButtonStyle}
                        >
                          الفاتورة
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

              {!loading && returnRows.length === 0 && (
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
                    لا توجد مرتجعات شراء
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedPurchase && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div
            className="theme-modal-card purchase-details-modal"
            style={{ ...modalStyle, width: '900px' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                alignItems: 'center',
                marginBottom: '18px'
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 6px' }}>
                  فاتورة شراء #{selectedPurchase.purchase.id}
                </h3>
                <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
                  المورد: {selectedPurchase.purchase.supplier_name}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedPurchase(null)}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
                marginBottom: '18px'
              }}
            >
              <InfoCard
                title="قبل الخصم"
                value={money(
                  Number(selectedPurchase.purchase.sub_total || 0) > 0
                    ? selectedPurchase.purchase.sub_total
                    : Number(selectedPurchase.purchase.total_amount || 0) +
                        Number(selectedPurchase.purchase.discount_value || 0)
                )}
              />

              <InfoCard
                title="الخصم"
                value={
                  selectedPurchase.purchase.discount_type === 'percent'
                    ? `${money(selectedPurchase.purchase.discount_value || 0)} (${Number(selectedPurchase.purchase.discount_input || 0)}%)`
                    : money(selectedPurchase.purchase.discount_value || 0)
                }
              />
              <InfoCard title="بعد الخصم" value={money(selectedPurchase.purchase.total_amount)} />
              <InfoCard title="المرتجع" value={money(selectedPurchase.purchase.returned_amount || 0)} />
              <InfoCard title="المدفوع" value={money(selectedPurchase.purchase.paid_amount)} />
              <InfoCard title="المتبقي" value={money(selectedPurchase.purchase.remaining_amount)} />
              <InfoCard title="الحساب المالي" value={getPaymentMethodLabel(selectedPurchase.purchase.payment_method)} />
              <InfoCard title="الحالة" value={paymentStatusName(selectedPurchase.purchase.payment_status)} />
            </div>

            <h4 style={{ margin: '0 0 12px' }}>الأصناف</h4>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: '760px', borderCollapse: 'collapse', direction: 'rtl' }}>
                <thead>
                  <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                    <th style={thStyle}>الصنف</th>
                    <th style={thStyle}>باركود</th>
                    <th style={thStyle}>المقاس</th>
                    <th style={thStyle}>اللون</th>
                    <th style={thStyle}>الكمية</th>
                    <th style={thStyle}>مرتجع</th>
                    <th style={thStyle}>متاح</th>
                    <th style={thStyle}>سعر الشراء</th>
                    <th style={thStyle}>الإجمالي</th>
                  </tr>
                </thead>

                <tbody>
                  {(selectedPurchase.items ?? []).map((item: any) => (
                    <tr
                      key={item.id}
                      style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <td style={tdStyle}>{item.product_name}</td>
                      <td style={tdStyle}>{item.barcode || '—'}</td>
                      <td style={tdStyle}>{item.size || '—'}</td>
                      <td style={tdStyle}>{item.color || '—'}</td>
                      <td style={tdStyle}>{item.quantity}</td>
                      <td style={tdStyle}>{item.returned_quantity || 0}</td>
                      <td style={tdStyle}>{item.returnable_quantity ?? item.quantity}</td>
                      <td style={tdStyle}>{money(item.unit_cost)}</td>
                      <td style={tdStyle}>{money(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 style={{ margin: '22px 0 12px' }}>المدفوعات</h4>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
                <thead>
                  <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                    <th style={thStyle}>التاريخ</th>
                    <th style={thStyle}>المبلغ</th>
                    <th style={thStyle}>الحساب المالي</th>
                    <th style={thStyle}>ملاحظات</th>
                  </tr>
                </thead>

                <tbody>
                  {(selectedPurchase.payments ?? []).map((payment: any) => (
                    <tr
                      key={payment.id}
                      style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <td style={tdStyle}>{formatDate(payment.created_at)}</td>
                      <td style={tdStyle}>{money(payment.amount)}</td>
                      <td style={tdStyle}>{getPaymentMethodLabel(payment.payment_method)}</td>
                      <td style={tdStyle}>{payment.notes || '—'}</td>
                    </tr>
                  ))}

                  {(selectedPurchase.payments ?? []).length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          ...tdStyle,
                          textAlign: 'center',
                          color: '#94a3b8',
                          padding: '20px'
                        }}
                      >
                        لا توجد مدفوعات
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {(selectedPurchase.returns ?? []).length > 0 && (
              <>
                <h4 style={{ margin: '22px 0 12px' }}>مرتجعات هذه الفاتورة</h4>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
                    <thead>
                      <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                        <th style={thStyle}>رقم المرتجع</th>
                        <th style={thStyle}>القيمة</th>
                        <th style={thStyle}>التاريخ</th>
                        <th style={thStyle}>ملاحظات</th>
                      </tr>
                    </thead>

                    <tbody>
                      {(selectedPurchase.returns ?? []).map((purchaseReturn: any) => (
                        <tr
                          key={purchaseReturn.id}
                          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                        >
                          <td style={tdStyle}>#{purchaseReturn.id}</td>
                          <td style={tdStyle}>{money(purchaseReturn.total_amount)}</td>
                          <td style={tdStyle}>{formatDate(purchaseReturn.created_at)}</td>
                          <td style={tdStyle}>{purchaseReturn.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-start',
                gap: '10px',
                marginTop: '22px',
                flexWrap: 'wrap'
              }}
            >
              {selectedPurchase.purchase.payment_status !== 'cancelled' &&
                Number(selectedPurchase.purchase.remaining_amount || 0) > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      openPayment({
                        id: selectedPurchase.purchase.id,
                        supplier_id: selectedPurchase.purchase.supplier_id,
                        supplier_name: selectedPurchase.purchase.supplier_name,
                        supplier_phone: selectedPurchase.purchase.supplier_phone,
                        total_amount: selectedPurchase.purchase.total_amount,
                        paid_amount: selectedPurchase.purchase.paid_amount,
                        remaining_amount: selectedPurchase.purchase.remaining_amount,
                        payment_status: selectedPurchase.purchase.payment_status,
                        payment_method: selectedPurchase.purchase.payment_method,
                        notes: selectedPurchase.purchase.notes,
                        created_at: selectedPurchase.purchase.created_at,
                        items_count: selectedPurchase.items?.length || 0
                      })
                    }
                    style={primaryButtonStyle}
                  >
                    تسجيل دفعة
                  </button>
                )}

              {selectedPurchase.purchase.payment_status !== 'cancelled' && (
                <button
                  type="button"
                  onClick={() =>
                    openReturnModal({
                      id: selectedPurchase.purchase.id,
                      supplier_id: selectedPurchase.purchase.supplier_id,
                      supplier_name: selectedPurchase.purchase.supplier_name,
                      supplier_phone: selectedPurchase.purchase.supplier_phone,
                      total_amount: selectedPurchase.purchase.total_amount,
                      paid_amount: selectedPurchase.purchase.paid_amount,
                      remaining_amount: selectedPurchase.purchase.remaining_amount,
                      payment_status: selectedPurchase.purchase.payment_status,
                      payment_method: selectedPurchase.purchase.payment_method,
                      notes: selectedPurchase.purchase.notes,
                      created_at: selectedPurchase.purchase.created_at,
                      items_count: selectedPurchase.items?.length || 0,
                      returned_amount: selectedPurchase.purchase.returned_amount || 0
                    })
                  }
                  style={{
                    ...secondaryButtonStyle,
                    borderColor: '#f59e0b',
                    color: '#fde68a'
                  }}
                >
                  إنشاء مرتجع
                </button>
              )}

              <button
                type="button"
                onClick={() => setSelectedPurchase(null)}
                style={secondaryButtonStyle}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedReturn && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div
            className="theme-modal-card purchase-return-details-modal"
            style={{ ...modalStyle, width: '820px' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                alignItems: 'center',
                marginBottom: '18px'
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 6px' }}>
                  مرتجع شراء #{selectedReturn.return.id}
                </h3>
                <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
                  فاتورة شراء #{selectedReturn.return.purchase_id} | المورد:{' '}
                  {selectedReturn.return.supplier_name}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedReturn(null)}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
                marginBottom: '18px'
              }}
            >
              <InfoCard title="قيمة المرتجع" value={money(selectedReturn.return.total_amount)} />
              <InfoCard title="التاريخ" value={formatDate(selectedReturn.return.created_at)} />
              <InfoCard title="ملاحظات" value={selectedReturn.return.notes || '—'} />
            </div>

            <h4 style={{ margin: '0 0 12px' }}>أصناف المرتجع</h4>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: '720px', borderCollapse: 'collapse', direction: 'rtl' }}>
                <thead>
                  <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                    <th style={thStyle}>الصنف</th>
                    <th style={thStyle}>باركود</th>
                    <th style={thStyle}>المقاس</th>
                    <th style={thStyle}>اللون</th>
                    <th style={thStyle}>الكمية</th>
                    <th style={thStyle}>سعر الشراء</th>
                    <th style={thStyle}>الإجمالي</th>
                  </tr>
                </thead>

                <tbody>
                  {(selectedReturn.items ?? []).map((item: any) => (
                    <tr
                      key={item.id}
                      style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <td style={tdStyle}>{item.product_name}</td>
                      <td style={tdStyle}>{item.barcode || '—'}</td>
                      <td style={tdStyle}>{item.size || '—'}</td>
                      <td style={tdStyle}>{item.color || '—'}</td>
                      <td style={tdStyle}>{item.quantity}</td>
                      <td style={tdStyle}>{money(item.unit_cost)}</td>
                      <td style={tdStyle}>{money(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                onClick={() => openDetails(selectedReturn.return.purchase_id)}
                style={primaryButtonStyle}
              >
                عرض الفاتورة الأصلية
              </button>

              <button
                type="button"
                onClick={() => setSelectedReturn(null)}
                style={secondaryButtonStyle}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelPurchaseTarget && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div className="theme-modal-card purchase-cancel-modal" style={modalStyle}>
            <h3 style={{ margin: '0 0 8px' }}>إلغاء فاتورة شراء #{cancelPurchaseTarget.id}</h3>

            <p style={{ margin: '0 0 16px', color: '#94a3b8', fontWeight: 700 }}>
              سيتم خصم كميات الفاتورة من المخزون وعكس حساب المورد. لن يتم حذف الفاتورة من السجل.
            </p>

            <div style={{ display: 'grid', gap: '12px' }}>
              <InfoCard title="المورد" value={cancelPurchaseTarget.supplier_name || '—'} />
              <InfoCard title="إجمالي الفاتورة" value={money(cancelPurchaseTarget.total_amount)} />
              <InfoCard title="الأصناف" value={String(cancelPurchaseTarget.items_count || 0)} />

              <div style={fieldStyle}>
                <label style={labelStyle}>سبب الإلغاء</label>
                <input
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="سبب إلغاء فاتورة الشراء"
                  style={inputStyle}
                  autoFocus
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-start',
                flexWrap: 'wrap',
                marginTop: '22px'
              }}
            >
              <button
                type="button"
                onClick={saveCancelPurchase}
                disabled={cancellingPurchase}
                style={{
                  ...dangerSolidButtonStyle,
                  opacity: cancellingPurchase ? 0.6 : 1,
                  cursor: cancellingPurchase ? 'not-allowed' : 'pointer'
                }}
              >
                {cancellingPurchase ? 'جاري الإلغاء...' : 'تأكيد الإلغاء'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setCancelPurchaseTarget(null);
                  setCancelReason('');
                }}
                style={secondaryButtonStyle}
              >
                رجوع
              </button>
            </div>
          </div>
        </div>
      )}

      {returnPurchase && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div
            className="theme-modal-card purchase-return-modal"
            style={{ ...modalStyle, width: '900px' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                alignItems: 'center',
                marginBottom: '18px'
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 6px' }}>
                  إنشاء مرتجع شراء من فاتورة #{returnPurchase.purchase.id}
                </h3>
                <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
                  المورد: {returnPurchase.purchase.supplier_name}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setReturnPurchase(null)}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>ملاحظات المرتجع</label>
                <input
                  placeholder="مثال: قطعة تالفة / رجوع للمورد"
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    minWidth: '820px',
                    borderCollapse: 'collapse',
                    direction: 'rtl'
                  }}
                >
                  <thead>
                    <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                      <th style={thStyle}>الصنف</th>
                      <th style={thStyle}>الكمية الأصلية</th>
                      <th style={thStyle}>مرتجع سابق</th>
                      <th style={thStyle}>المتاح للمرتجع</th>
                      <th style={thStyle}>كمية المرتجع</th>
                      <th style={thStyle}>سعر الشراء</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(returnPurchase.items ?? []).map((item: any) => {
                      const maxQuantity = Number(item.returnable_quantity ?? item.quantity ?? 0);

                      return (
                        <tr
                          key={item.id}
                          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                        >
                          <td style={tdStyle}>
                            <div style={{ display: 'grid', gap: '4px', minWidth: '160px' }}>
                              <strong>{item.product_name}</strong>
                              <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                                {item.barcode || '—'} / {item.size || '—'} / {item.color || '—'}
                              </span>
                            </div>
                          </td>
                          <td style={tdStyle}>{item.quantity}</td>
                          <td style={tdStyle}>{item.returned_quantity || 0}</td>
                          <td style={tdStyle}>{maxQuantity}</td>
                          <td style={tdStyle}>
                            <input
                              type="number"
                              min={0}
                              max={maxQuantity}
                              disabled={maxQuantity <= 0}
                              value={returnQuantities[item.id] || ''}
                              onChange={(e) => updateReturnQuantity(Number(item.id), e.target.value)}
                              style={{
                                ...inputStyle,
                                width: '120px',
                                textAlign: 'center',
                                opacity: maxQuantity <= 0 ? 0.5 : 1
                              }}
                            />
                          </td>
                          <td style={tdStyle}>{money(item.unit_cost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  gap: '10px',
                  marginTop: '10px'
                }}
              >
                <button
                  type="button"
                  onClick={savePurchaseReturn}
                  disabled={savingReturn}
                  style={{
                    ...primaryButtonStyle,
                    opacity: savingReturn ? 0.6 : 1,
                    cursor: savingReturn ? 'not-allowed' : 'pointer'
                  }}
                >
                  {savingReturn ? 'جاري الحفظ...' : 'حفظ المرتجع'}
                </button>

                <button
                  type="button"
                  onClick={() => setReturnPurchase(null)}
                  style={secondaryButtonStyle}
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {paymentPurchase && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div className="theme-modal-card purchase-payment-modal" style={modalStyle}>
            <h3 style={{ margin: '0 0 8px' }}>تسجيل دفعة للمورد</h3>

            <p style={{ margin: '0 0 18px', color: '#94a3b8', fontWeight: 700 }}>
              {paymentPurchase.supplier_name} | فاتورة #{paymentPurchase.id}
            </p>

            <div style={{ display: 'grid', gap: '14px' }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>المتبقي</label>
                <input
                  value={money(paymentPurchase.remaining_amount)}
                  readOnly
                  style={{ ...inputStyle, opacity: 0.7 }}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>مبلغ الدفعة</label>
                <input
                  type="number"
                  min={0}
                  max={paymentPurchase.remaining_amount}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>الحساب المالي</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  style={inputStyle}
                >
                  {CASH_ACCOUNT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>ملاحظات</label>
                <input
                  placeholder="مثال: دفعة من حساب فاتورة الشراء"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  style={inputStyle}
                />
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
                onClick={savePayment}
                disabled={savingPayment}
                style={{
                  ...primaryButtonStyle,
                  opacity: savingPayment ? 0.6 : 1,
                  cursor: savingPayment ? 'not-allowed' : 'pointer'
                }}
              >
                {savingPayment ? 'جاري الحفظ...' : 'حفظ الدفعة'}
              </button>

              <button
                type="button"
                onClick={() => setPaymentPurchase(null)}
                style={secondaryButtonStyle}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div
      className="purchase-info-card"
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

function PaymentStatusBadge({ status }: { status: string }) {
  let text = 'غير مدفوعة';
  let color = '#fca5a5';
  let background = 'rgba(239,68,68,0.10)';
  let border = 'rgba(239,68,68,0.25)';

  if (status === 'paid') {
    text = 'مدفوعة';
    color = '#6ee7b7';
    background = 'rgba(16,185,129,0.10)';
    border = 'rgba(16,185,129,0.25)';
  }

  if (status === 'partial') {
    text = 'جزئي';
    color = '#fdba74';
    background = 'rgba(249,115,22,0.10)';
    border = 'rgba(249,115,22,0.25)';
  }

  if (status === 'cancelled') {
    text = 'ملغاة';
    color = '#cbd5e1';
    background = 'rgba(148,163,184,0.12)';
    border = 'rgba(148,163,184,0.28)';
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

function paymentStatusName(status: string) {
  if (status === 'paid') return 'مدفوعة';
  if (status === 'partial') return 'مدفوعة جزئيًا';
  if (status === 'cancelled') return 'ملغاة';
  return 'غير مدفوعة';
}

function paymentMethodName(value?: string | null) {
  return getPaymentMethodLabel(value);
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
  padding: '12px 14px',
  borderRadius: '16px',
  display: 'grid',
  gap: '10px'
};

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: '8px'
};

const labelStyle: React.CSSProperties = {
  color: '#cbd5e1',
  fontWeight: 800
};

const inputStyle: React.CSSProperties = {
  height: '40px',
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
  border: '1px solid rgba(59,130,246,0.45)',
  height: '44px',
  borderRadius: '10px',
  background: 'rgba(59,130,246,0.18)',
  color: '#dbeafe',
  fontWeight: 800,
  padding: '0 18px',
  cursor: 'pointer'
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148,163,184,0.28)',
  height: '44px',
  borderRadius: '10px',
  background: 'rgba(148,163,184,0.08)',
  color: '#e5e7eb',
  fontWeight: 800,
  padding: '0 18px',
  cursor: 'pointer'
};

const dangerSolidButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(239,68,68,0.55)',
  height: '44px',
  borderRadius: '10px',
  background: 'rgba(239,68,68,0.14)',
  color: '#fecaca',
  fontWeight: 900,
  padding: '0 18px',
  cursor: 'pointer'
};

const tabButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  minWidth: '108px',
  height: '34px',
  padding: '0 10px',
  fontSize: '12px'
};

const activeTabButtonStyle: React.CSSProperties = {
  ...tabButtonStyle,
  background: 'rgba(59,130,246,0.18)',
  color: '#dbeafe',
  borderColor: 'rgba(59,130,246,0.45)'
};

const smallButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148,163,184,0.30)',
  height: '30px',
  borderRadius: '8px',
  background: 'rgba(148,163,184,0.08)',
  color: '#e5e7eb',
  padding: '0 7px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  minWidth: '50px',
  textAlign: 'center',
  fontWeight: 700,
  fontSize: '12px'
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
  padding: '7px 6px',
  fontWeight: 900,
  whiteSpace: 'nowrap',
  fontSize: '12px',
  borderBottom: '1px solid rgba(255,255,255,0.08)'
};

const tdStyle: React.CSSProperties = {
  padding: '7px 6px',
  color: '#e5e7eb',
  whiteSpace: 'nowrap',
  fontSize: '12px',
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
