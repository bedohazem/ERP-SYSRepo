import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../store/auth.store';
import { getPaymentMethodLabel } from '../../utils/payment-method';

type Expense = {
  id: number;
  title: string;
  category?: string;
  amount: number;
  payment_method: string;
  notes?: string;
  created_by_name?: string;
  created_at: string;
};

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const currentUser = useAuthStore((s) => s.user);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [notes, setNotes] = useState('');

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 1800);
  }

  async function loadExpenses() {
    setLoading(true);
    try {
      const data = await window.api.getExpenses();
      setExpenses(data || []);
    } catch (error) {
      console.error(error);
      showMessage('error', 'حدث خطأ أثناء تحميل المصروفات');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadExpenses();
  }, []);

  async function handleSubmit() {
    if (!title.trim()) {
      showMessage('error', 'اسم المصروف مطلوب');
      return;
    }

    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      showMessage('error', 'اكتب مبلغ صحيح');
      return;
    }

    setSaving(true);
    try {
      await window.api.createExpense({
        title: title.trim(),
        category: category.trim() || null,
        amount: parsedAmount,
        payment_method: paymentMethod,
        notes: notes.trim() || null,
        created_by: currentUser?.id ?? null
      });

      setTitle('');
      setCategory('');
      setAmount('');
      setPaymentMethod('cash');
      setNotes('');

      showMessage('success', 'تم حفظ المصروف');
      await loadExpenses();
    } catch (error: any) {
      showMessage('error', error.message || 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  }

  const totalExpenses = useMemo(() => {
    return expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }, [expenses]);

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

  function printExpensesReport() {
    const printWindow = window.open('', '_blank', 'width=1100,height=800');

    if (!printWindow) {
      showMessage('error', 'تعذر فتح نافذة الطباعة');
      return;
    }

    const rowsHtml = expenses
      .map(
        (expense) => `
          <tr>
            <td>${escapeHtml(expense.title || '—')}</td>
            <td>${escapeHtml(expense.category || '—')}</td>
            <td class="money">${money(expense.amount)}</td>
            <td>${escapeHtml(getPaymentMethodLabel(expense.payment_method))}</td>
            <td>${escapeHtml(expense.notes || '—')}</td>
            <td>${escapeHtml(expense.created_by_name || '—')}</td>
            <td>${escapeHtml(formatDate(expense.created_at))}</td>
          </tr>
        `
      )
      .join('');

    const html = `
      <!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />
          <title>كشف المصروفات</title>
          <style>
            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              padding: 28px;
              font-family: "Segoe UI", Tahoma, Arial, sans-serif;
              color: #111827;
              background: #ffffff;
              direction: rtl;
            }

            .header {
              display: flex;
              justify-content: space-between;
              gap: 16px;
              align-items: flex-start;
              border-bottom: 2px solid #e5e7eb;
              padding-bottom: 18px;
              margin-bottom: 18px;
            }

            h1 {
              margin: 0 0 8px;
              font-size: 28px;
            }

            .muted {
              color: #6b7280;
              font-size: 13px;
              line-height: 1.8;
            }

            .summary {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12px;
              margin: 18px 0;
            }

            .card {
              border: 1px solid #e5e7eb;
              border-radius: 14px;
              padding: 14px;
              background: #f9fafb;
            }

            .card-title {
              color: #6b7280;
              font-size: 13px;
              margin-bottom: 8px;
              font-weight: 700;
            }

            .card-value {
              font-size: 22px;
              font-weight: 900;
            }

            .money {
              color: #b91c1c;
              font-weight: 900;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 12px;
            }

            th,
            td {
              border: 1px solid #e5e7eb;
              padding: 9px;
              text-align: right;
              font-size: 12px;
              vertical-align: top;
            }

            th {
              background: #f3f4f6;
              font-weight: 900;
            }

            td:nth-child(5) {
              max-width: 360px;
              white-space: normal;
              line-height: 1.6;
            }

            .empty {
              text-align: center;
              color: #6b7280;
              padding: 28px;
              border: 1px solid #e5e7eb;
              border-radius: 12px;
              background: #f9fafb;
            }

            .footer {
              margin-top: 18px;
              padding-top: 12px;
              border-top: 1px solid #e5e7eb;
              color: #6b7280;
              font-size: 12px;
              display: flex;
              justify-content: space-between;
              gap: 12px;
            }

            @media print {
              body {
                padding: 16px;
              }
            }
          </style>
        </head>

        <body>
          <div class="header">
            <div>
              <h1>كشف المصروفات</h1>
              <div class="muted">
                ERP Store<br />
                تاريخ الطباعة: ${escapeHtml(new Date().toLocaleString('ar-EG'))}
              </div>
            </div>

            <div class="muted">
              المستخدم: ${escapeHtml(currentUser?.name || '—')}<br />
              عدد المصروفات: ${expenses.length}
            </div>
          </div>

          <div class="summary">
            <div class="card">
              <div class="card-title">إجمالي المصروفات</div>
              <div class="card-value money">${money(totalExpenses)}</div>
            </div>

            <div class="card">
              <div class="card-title">عدد العمليات</div>
              <div class="card-value">${expenses.length}</div>
            </div>
          </div>

          ${
            expenses.length
              ? `
                <table>
                  <thead>
                    <tr>
                      <th>المصروف</th>
                      <th>التصنيف</th>
                      <th>المبلغ</th>
                      <th>طريقة الدفع</th>
                      <th>ملاحظات</th>
                      <th>المستخدم</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHtml}
                  </tbody>
                </table>
              `
              : '<div class="empty">لا توجد مصروفات مسجلة</div>'
          }

          <div class="footer">
            <div>تم إنشاء التقرير من نظام ERP Store</div>
            <div>صفحة المصروفات</div>
          </div>

          <script>
            window.onload = function () {
              window.focus();
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  return (
    <div style={{ display: 'grid', gap: '18px' }}>

      {/* Toast Message */}
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
            background: message.type === 'error'
              ? 'rgba(239,68,68,0.95)'
              : 'rgba(16,185,129,0.95)',
            color: '#fff',
            fontWeight: 800,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            pointerEvents: 'none'
          }}
        >
          {message.text}
        </div>
      )}

      {/* Header + Total */}
      <div
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '14px',
          direction: 'rtl'
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 6px' }}>المصروفات</h2>
          <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
            متابعة وإدارة المصروفات اليومية
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={printExpensesReport}
            style={{
              ...primaryButtonStyle,
              background: 'rgba(16,185,129,0.14)',
              border: '1px solid rgba(16,185,129,0.32)',
              color: '#6ee7b7'
            }}
          >
            طباعة الكشف
          </button>

          <div style={{ textAlign: 'left' }}>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '4px' }}>
              إجمالي المصروفات
            </div>
            <strong style={{ color: '#f87171', fontSize: '24px' }}>
              {money(totalExpenses)}
            </strong>
          </div>
        </div>
      </div>

      {/* Add Expense Form */}
      <div
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '18px',
          display: 'grid',
          gap: '14px'
        }}
      >
        <div>
          <h3 style={{ margin: '0 0 6px', textAlign: 'right' }}>إضافة مصروف</h3>
          <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700, textAlign: 'right' }}>
            تسجيل المصروفات وربطها بالخزنة
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px'
          }}
        >
          <div>
            <label style={labelStyle}>اسم المصروف</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: فاتورة كهرباء"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>التصنيف</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="مثال: فواتير / إيجار"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>المبلغ</label>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>طريقة الدفع</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              style={inputStyle}
            >
              <option value="cash">كاش</option>
              <option value="card">كارت / فيزا</option>
              <option value="wallet">محفظة</option>
              <option value="bank_transfer">تحويل بنكي / انستا باي</option>
            </select>
          </div>
        </div>

        <div>
          <label style={labelStyle}>ملاحظات</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات إضافية..."
            style={{
              ...inputStyle,
              height: '90px',
              paddingTop: '12px',
              resize: 'vertical'
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving}
            style={{
              ...primaryButtonStyle,
              opacity: saving ? 0.6 : 1,
              cursor: saving ? 'not-allowed' : 'pointer'
            }}
          >
            {saving ? 'جاري الحفظ...' : 'حفظ المصروف'}
          </button>
        </div>
      </div>

      {/* Expenses Table */}
      <div
        className="glass-card"
        style={{
          padding: '18px',
          borderRadius: '18px',
          overflowX: 'auto'
        }}
      >
        <h3 style={{ margin: '0 0 16px', textAlign: 'right' }}>سجل المصروفات</h3>

        <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
          <thead>
            <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
              <th style={thStyle}>المصروف</th>
              <th style={thStyle}>التصنيف</th>
              <th style={thStyle}>المبلغ</th>
              <th style={thStyle}>طريقة الدفع</th>
              <th style={thStyle}>المستخدم</th>
              <th style={thStyle}>التاريخ</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, textAlign: 'center' }}>
                  جاري التحميل...
                </td>
              </tr>
            )}

            {!loading && expenses.map((expense) => (
              <tr
                key={expense.id}
                style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
              >
                <td style={{ ...tdStyle, fontWeight: 700 }}>{expense.title}</td>
                <td style={tdStyle}>{expense.category || '—'}</td>
                <td style={{ ...tdStyle, color: '#f87171', fontWeight: 900 }}>
                  {money(expense.amount)}
                </td>
                <td style={tdStyle}>{getPaymentMethodLabel(expense.payment_method)}</td>
                <td style={tdStyle}>{expense.created_by_name || '—'}</td>
                <td style={{ ...tdStyle, color: '#94a3b8' }}>{formatDate(expense.created_at)}</td>
              </tr>
            ))}

            {!loading && expenses.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    ...tdStyle,
                    textAlign: 'center',
                    color: '#94a3b8',
                    padding: '28px'
                  }}
                >
                  لا توجد مصروفات مسجلة
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '8px',
  color: '#cbd5e1',
  fontSize: '14px'
};

const inputStyle: React.CSSProperties = {
  width: '100%',
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
  background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
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