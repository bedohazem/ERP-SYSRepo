import { useEffect, useMemo, useState } from 'react';

type CustomerRow = {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  points_balance: number;
  total_spent: number;
  sales_count?: number;
  last_sale_at?: string | null;
};

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: ''
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [pointsAdjust, setPointsAdjust] = useState('');
  const [pointsNotes, setPointsNotes] = useState('');
  const [message, setMessage] = useState('');

  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const editingCustomer = useMemo(
    () => customers.find((c) => c.id === editingId),
    [customers, editingId]
  );

  async function loadCustomers(searchValue = query) {
    setLoadingCustomers(true);

    try {
      const data = searchValue.trim()
        ? await window.api.searchCustomers(searchValue)
        : await window.api.getCustomers();

      setCustomers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load customers:', error);
      setMessage('حدث خطأ أثناء تحميل العملاء');
      setCustomers([]);
    } finally {
      setLoadingCustomers(false);
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadCustomers(query);
    }, 250);

    return () => clearTimeout(handle);
  }, [query]);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function startEdit(customer: CustomerRow) {
    setEditingId(customer.id);
    setForm({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      notes: customer.notes || ''
    });
  }

  async function saveCustomer() {
    if (savingCustomer) return;

    if (!form.name.trim()) {
      setMessage('اسم العميل مطلوب');
      return;
    }

    setSavingCustomer(true);

    try {
      if (editingId) {
        await window.api.updateCustomer({
          id: editingId,
          ...form
        });
        setMessage('تم تعديل العميل');
      } else {
        await window.api.createCustomer(form);
        setMessage('تم إضافة العميل');
      }

      setForm(emptyForm);
      setEditingId(null);
      await loadCustomers();
    } catch (error) {
      console.error('Failed to save customer:', error);
      setMessage('حدث خطأ أثناء حفظ العميل، تأكد أن رقم الهاتف غير مكرر');
    } finally {
      setSavingCustomer(false);
    }
  }

  async function deleteCustomer(id: number) {
    const confirmed = window.confirm('هل أنت متأكد من حذف العميل؟');
    if (!confirmed) return;

    try {
      await window.api.deleteCustomer(id);
      setMessage('تم حذف العميل');
      await loadCustomers();
    } catch (error) {
      console.error('Failed to delete customer:', error);
      setMessage('حدث خطأ أثناء حذف العميل');
    }
  }

  async function openHistory(customerId: number) {
    setHistoryLoading(true);

    try {
      const data = await window.api.getCustomerHistory(customerId);

      setSelectedCustomer({
        customer: data?.customer ?? null,
        sales: Array.isArray(data?.sales) ? data.sales : [],
        loyalty: Array.isArray(data?.loyalty) ? data.loyalty : []
      });

      setPointsAdjust('');
      setPointsNotes('');
    } catch (error) {
      console.error('Failed to load customer history:', error);
      setMessage('حدث خطأ أثناء تحميل هيستوري العميل');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function savePointsAdjust() {
    if (!selectedCustomer?.customer?.id) return;

    const points = Number(pointsAdjust);

    if (!Number.isFinite(points) || points === 0) {
      setMessage('اكتب عدد نقاط صحيح، مثال: 10 أو -5');
      return;
    }

    try {
      await window.api.adjustCustomerPoints({
        customer_id: selectedCustomer.customer.id,
        points,
        notes: pointsNotes.trim() || null
      });

      await openHistory(selectedCustomer.customer.id);
      await loadCustomers();
      setMessage('تم تعديل النقاط');
    } catch (error) {
      console.error('Failed to adjust points:', error);
      setMessage('حدث خطأ أثناء تعديل النقاط');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      {message && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '12px',
            background: 'rgba(16,185,129,0.15)',
            color: '#6ee7b7',
            fontWeight: 800
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
        <h2 style={{ margin: 0, textAlign: 'right' }}>إدارة العملاء</h2>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            flexWrap: 'wrap',
            direction: 'rtl'
          }}
        >
          <input
            placeholder="بحث بالاسم / الهاتف / الإيميل"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      <div
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '18px',
          display: 'grid',
          gap: '12px'
        }}
      >
        <h3 style={{ margin: 0, textAlign: 'right' }}>
          {editingId ? `تعديل: ${editingCustomer?.name}` : 'إضافة عميل'}
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))',
            gap: '12px'
          }}
        >
          <input
            placeholder="اسم العميل"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            style={inputStyle}
          />

          <input
            placeholder="رقم الهاتف"
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            style={inputStyle}
          />

          <input
            placeholder="الإيميل"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            style={inputStyle}
          />

          <input
            placeholder="العنوان"
            value={form.address}
            onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
            style={inputStyle}
          />

          <input
            placeholder="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            style={{ ...inputStyle, gridColumn: '1 / -1' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start' }}>
          <button
            type="button"
            onClick={saveCustomer}
            disabled={savingCustomer}
            style={{
              ...primaryButtonStyle,
              opacity: savingCustomer ? 0.6 : 1,
              cursor: savingCustomer ? 'not-allowed' : 'pointer'
            }}
          >
            {savingCustomer
              ? 'جاري الحفظ...'
              : editingId
                ? 'حفظ التعديل'
                : 'حفظ العميل'}
          </button>

          {editingId && (
            <button
              type="button"
              onClick={startCreate}
              style={secondaryOutlineButtonStyle}
            >
              إلغاء التعديل
            </button>
          )}
        </div>
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
              <th style={thStyle}>العميل</th>
              <th style={thStyle}>الهاتف</th>
              <th style={thStyle}>النقاط</th>
              <th style={thStyle}>إجمالي المشتريات</th>
              <th style={thStyle}>عدد الفواتير</th>
              <th style={thStyle}>آخر شراء</th>
              <th style={thStyle}>إجراءات</th>
            </tr>
          </thead>

          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <td style={tdStyle}>{customer.name}</td>
                <td style={tdStyle}>{customer.phone || '—'}</td>
                <td style={tdStyle}>{customer.points_balance || 0}</td>
                <td style={tdStyle}>{Number(customer.total_spent || 0).toFixed(2)} ج.م</td>
                <td style={tdStyle}>{customer.sales_count || 0}</td>
                <td style={tdStyle}>{customer.last_sale_at || '—'}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={() => startEdit(customer)} style={smallButtonStyle}>
                      تعديل
                    </button>
                    <button onClick={() => openHistory(customer.id)} style={smallButtonStyle}>
                      الهيستوري
                    </button>
                    <button
                      onClick={() => deleteCustomer(customer.id)}
                      style={{
                        ...smallButtonStyle,
                        borderColor: '#ef4444',
                        color: '#fca5a5'
                      }}
                    >
                      حذف
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {customers.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8' }}>
                  لا يوجد عملاء
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedCustomer && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            style={{
              width: '850px',
              maxWidth: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              borderRadius: '18px',
              background: '#111827',
              border: '1px solid rgba(255,255,255,0.10)',
              padding: '22px',
              direction: 'rtl'
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              هيستوري العميل: {selectedCustomer.customer?.name}
            </h3>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px',
                marginBottom: '18px'
              }}
            >
              <div style={statCardStyle}>
                النقاط الحالية
                <strong>{selectedCustomer.customer?.points_balance || 0}</strong>
              </div>
              <div style={statCardStyle}>
                إجمالي المشتريات
                <strong>{Number(selectedCustomer.customer?.total_spent || 0).toFixed(2)}</strong>
              </div>
              <div style={statCardStyle}>
                عدد الفواتير
                <strong>{selectedCustomer.sales?.length || 0}</strong>
              </div>
            </div>

            <h4>تعديل النقاط يدويًا</h4>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <input
                placeholder="مثال: 10 أو -5"
                value={pointsAdjust}
                onChange={(e) => setPointsAdjust(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder="ملاحظة"
                value={pointsNotes}
                onChange={(e) => setPointsNotes(e.target.value)}
                style={inputStyle}
              />
              <button onClick={savePointsAdjust} style={primaryButtonStyle}>
                حفظ
              </button>
            </div>

            <h4>الفواتير</h4>
            <div style={{ display: 'grid', gap: '8px' }}>
              {(selectedCustomer.sales ?? []).map((sale: any) => (
                <div key={sale.id} style={historyRowStyle}>
                  <strong>فاتورة #{sale.id}</strong>
                  <span>{Number(sale.grand_total || 0).toFixed(2)} ج.م</span>
                  <span>+{sale.loyalty_points_earned || 0} نقطة</span>
                  <span>-{sale.loyalty_points_redeemed || 0} نقطة</span>
                  <span>{sale.created_at}</span>
                </div>
              ))}
            </div>

            <h4>حركات النقاط</h4>
            <div style={{ display: 'grid', gap: '8px' }}>
              {(selectedCustomer.loyalty ?? []).map((tx: any) => (
                <div key={tx.id} style={historyRowStyle}>
                  <strong>{tx.type}</strong>
                  <span>{tx.points} نقطة</span>
                  <span>{tx.amount || 0} ج.م</span>
                  <span>{tx.notes || '—'}</span>
                  <span>{tx.created_at}</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setSelectedCustomer(null)}
              style={{ ...secondaryOutlineButtonStyle, marginTop: '20px' }}
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
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
  minWidth: '220px'
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

const secondaryOutlineButtonStyle: React.CSSProperties = {
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
  whiteSpace: 'nowrap'
};

const statCardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  borderRadius: '12px',
  padding: '14px',
  display: 'grid',
  gap: '8px',
  color: '#cbd5e1'
};

const historyRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: '8px',
  padding: '10px',
  borderRadius: '10px',
  background: 'rgba(255,255,255,0.04)',
  color: '#e5e7eb'
};