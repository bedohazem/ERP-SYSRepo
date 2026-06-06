import { useEffect, useState } from 'react';
import { getPaymentMethodLabel } from '../../utils/payment-method';

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
  payment_status: 'paid' | 'partial' | 'unpaid';
  payment_method?: string | null;
  notes?: string | null;
  created_at: string;
  items_count: number;
};

export default function PurchaseHistoryPage() {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [selectedPurchase, setSelectedPurchase] = useState<any | null>(null);

  const [paymentPurchase, setPaymentPurchase] = useState<PurchaseRow | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  function showMessage(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(''), 1800);
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

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadPurchases();
    }, 250);

    return () => clearTimeout(handle);
  }, [search]);

  async function openDetails(purchaseId: number) {
    try {
      const data = await window.api.getPurchaseInvoice(purchaseId);
      setSelectedPurchase(data);
    } catch (error) {
      console.error('Failed to open purchase invoice:', error);
      showMessage('حدث خطأ أثناء فتح تفاصيل الفاتورة');
    }
  }

  function openPayment(row: PurchaseRow) {
    setPaymentPurchase(row);
    setPaymentAmount(String(Number(row.remaining_amount || 0)));
    setPaymentMethod(row.payment_method || 'cash');
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
        notes: paymentNotes.trim() || null
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
      showMessage('حدث خطأ أثناء تسجيل الدفعة');
    } finally {
      setSavingPayment(false);
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
            <h2 style={{ margin: '0 0 6px' }}>سجل فواتير الشراء</h2>
            <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
              متابعة فواتير الموردين والمدفوع والمتبقي
            </p>
          </div>

          <div style={{ color: '#cbd5e1', fontWeight: 900 }}>
            عدد النتائج: {total}
          </div>
        </div>

        <input
          placeholder="بحث برقم الفاتورة / اسم المورد / الهاتف"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={inputStyle}
        />
      </div>

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
            <th style={thStyle}>المورد</th>
            <th style={thStyle}>الأصناف</th>
            <th style={thStyle}>المبلغ</th>
            <th style={thStyle}>الدفع</th>
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
              rows.map((row) => (
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
                    <strong>{row.items_count || 0}</strong>
                  </td>

                  <td style={tdStyle}>
                    <div style={{ display: 'grid', gap: '4px', minWidth: '130px' }}>
                      <strong style={{ color: '#6ee7b7' }}>
                        الاجمالي:{money(row.total_amount)}
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
                    <PaymentStatusBadge status={row.payment_status} />
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'nowrap' }}>
                      <button
                        type="button"
                        onClick={() => openDetails(row.id)}
                        style={smallButtonStyle}
                      >
                        عرض
                      </button>

                      {Number(row.remaining_amount || 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => openPayment(row)}
                          style={{
                            ...smallButtonStyle,
                            borderColor: '#22c55e',
                            color: '#86efac',
                            background: 'rgba(34,197,94,0.10)'
                          }}
                        >
                          تسجيل دفعة
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

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

      {selectedPurchase && (
        <div className="theme-modal-overlay" style={modalOverlayStyle}>
          <div
            className="theme-modal-card purchase-details-modal"
            style={{ ...modalStyle, width: '850px' }}
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
                    : Number(selectedPurchase.purchase.total_amount || 0) + Number(selectedPurchase.purchase.discount_value || 0)
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
              <InfoCard title="المدفوع" value={money(selectedPurchase.purchase.paid_amount)} />
              <InfoCard title="المتبقي" value={money(selectedPurchase.purchase.remaining_amount)} />
              <InfoCard title="طريقة الدفع" value={getPaymentMethodLabel(selectedPurchase.purchase.payment_method)}/>
              <InfoCard title="الحالة" value={paymentStatusName(selectedPurchase.purchase.payment_status)} />
            </div>

            <h4 style={{ margin: '0 0 12px' }}>الأصناف</h4>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
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
                    <th style={thStyle}>الطريقة</th>
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
                      <td style={tdStyle}>{paymentMethodName(payment.payment_method)}</td>
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

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-start',
                gap: '10px',
                marginTop: '22px'
              }}
            >
              {Number(selectedPurchase.purchase.remaining_amount || 0) > 0 && (
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
                <label style={labelStyle}>طريقة الدفع</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  style={inputStyle}
                >
                  <option value="cash">كاش</option>
                  <option value="card">كارت</option>
                  <option value="wallet">محفظة</option>
                  <option value="bank_transfer">تحويل بنكي</option>
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
  padding: '18px',
  borderRadius: '18px',
  display: 'grid',
  gap: '14px'
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
  padding: '10px 8px',
  fontWeight: 900,
  whiteSpace: 'nowrap',
  fontSize: '13px',
  borderBottom: '1px solid rgba(255,255,255,0.08)'
};

const tdStyle: React.CSSProperties = {
  padding: '10px 8px',
  color: '#e5e7eb',
  whiteSpace: 'nowrap',
  fontSize: '13px',
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