import { useEffect, useMemo, useState } from 'react';

type ActivityFilters = {
  date_from?: string;
  date_to?: string;
  action?: string;
  entity?: string;
  search?: string;
  limit?: number;
};

export default function ActivityLogPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [expandedDetails, setExpandedDetails] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [pageMessage, setPageMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  function showMessage(type: 'success' | 'error', text: string) {
    setPageMessage({ type, text });

    setTimeout(() => {
      setPageMessage(null);
    }, 1800);
  }

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [action, setAction] = useState('all');
  const [entity, setEntity] = useState('all');
  const [search, setSearch] = useState('');

  const logsCount = useMemo(() => logs.length, [logs]);

  function getFilters(): ActivityFilters {
    return {
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      action,
      entity,
      search: search.trim() || undefined,
      limit: 500
    };
  }

  function toggleDetails(id: number) {
    setExpandedDetails((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  }

  async function loadLogs(customFilters?: ActivityFilters) {
    setLoading(true);

    try {
      const data = await window.api.getActivityLogs(customFilters ?? getFilters());
      setLogs(data || []);
      setExpandedDetails({});
    } catch (error) {
      console.error(error);
      showMessage('error', 'حدث خطأ أثناء تحميل سجل العمليات');
    } finally {
      setLoading(false);
    }
  }

  function clearFilters() {
    const emptyFilters: ActivityFilters = {
      action: 'all',
      entity: 'all',
      limit: 500
    };

    setDateFrom('');
    setDateTo('');
    setAction('all');
    setEntity('all');
    setSearch('');

    void loadLogs(emptyFilters);
  }

  function printActivityReport() {
    const printWindow = window.open('', '_blank', 'width=1100,height=800');

    if (!printWindow) {
      showMessage('error', 'تعذر فتح نافذة الطباعة');
      return;
    }

    const filtersText = [
      dateFrom ? `من تاريخ: ${dateFrom}` : null,
      dateTo ? `إلى تاريخ: ${dateTo}` : null,
      action !== 'all' ? `نوع العملية: ${getActionLabel(action)}` : null,
      entity !== 'all' ? `الموديول: ${getEntityLabel(entity)}` : null,
      search.trim() ? `بحث: ${search.trim()}` : null
    ].filter(Boolean);

    const rowsHtml = logs
      .map(
        (item) => `
          <tr>
            <td>${item.id}</td>
            <td>${escapeHtml(getActionLabel(item.action))}</td>
            <td>${escapeHtml(getEntityLabel(item.entity))}</td>
            <td>${item.entity_id || '—'}</td>
            <td>${escapeHtml(formatDetails(item.details))}</td>
            <td>${escapeHtml(formatLogUser(item))}</td>
            <td>${escapeHtml(formatDate(item.created_at))}</td>
          </tr>
        `
      )
      .join('');

    const html = `
      <!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />
          <title>سجل العمليات</title>
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

            .filters {
              border: 1px solid #e5e7eb;
              border-radius: 12px;
              padding: 12px;
              background: #f9fafb;
              margin-bottom: 18px;
              color: #374151;
              font-size: 13px;
              line-height: 1.8;
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
              <h1>سجل العمليات</h1>
              <div class="muted">
                ERP Store<br />
                تاريخ الطباعة: ${escapeHtml(new Date().toLocaleString('ar-EG'))}
              </div>
            </div>

            <div class="muted">
              عدد العمليات: ${logs.length}
            </div>
          </div>

          <div class="summary">
            <div class="card">
              <div class="card-title">عدد النتائج</div>
              <div class="card-value">${logs.length}</div>
            </div>

            <div class="card">
              <div class="card-title">نوع التقرير</div>
              <div class="card-value">سجل العمليات</div>
            </div>
          </div>

          <div class="filters">
            ${
              filtersText.length
                ? filtersText.map((item) => `<div>${escapeHtml(String(item))}</div>`).join('')
                : '<div>بدون فلاتر</div>'
            }
          </div>

          ${
            logs.length
              ? `
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>العملية</th>
                      <th>الموديول</th>
                      <th>رقم المرجع</th>
                      <th>التفاصيل</th>
                      <th>المستخدم</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHtml}
                  </tbody>
                </table>
              `
              : '<div class="empty">لا توجد عمليات مطابقة للفلتر</div>'
          }

          <div class="footer">
            <div>تم إنشاء التقرير من نظام ERP Store</div>
            <div>صفحة سجل العمليات</div>
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

  useEffect(() => {
    void loadLogs({
      action: 'all',
      entity: 'all',
      limit: 500
    });
  }, []);

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      {pageMessage && (
        <div
          style={{
            position: 'fixed',
            top: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            padding: '12px 18px',
            borderRadius: '14px',
            background:
              pageMessage.type === 'error'
                ? 'rgba(239,68,68,0.95)'
                : 'rgba(16,185,129,0.95)',
            color: '#fff',
            fontWeight: 800,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            pointerEvents: 'none'
          }}
        >
          {pageMessage.text}
        </div>
      )}
      <div
        className="glass-card"
        style={{
          padding: '20px',
          borderRadius: '22px',
          display: 'grid',
          gap: '16px'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '14px',
            flexWrap: 'wrap',
            alignItems: 'center'
          }}
        >
          <div>
            <h2 style={{ margin: '0 0 6px' }}>سجل العمليات</h2>
            <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
              متابعة كل العمليات المهمة التي تمت داخل النظام.
            </p>
          </div>

          <div
            style={{
              padding: '10px 14px',
              borderRadius: '14px',
              background: 'rgba(37,99,235,0.12)',
              border: '1px solid rgba(37,99,235,0.28)',
              color: '#bfdbfe',
              fontWeight: 900
            }}
          >
            عدد النتائج: {logsCount}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
            alignItems: 'end'
          }}
        >
          <Field label="من تاريخ">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={inputStyle}
            />
          </Field>

          <Field label="إلى تاريخ">
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={inputStyle}
            />
          </Field>

          <Field label="نوع العملية">
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              style={inputStyle}
            >
              <option value="all">كل العمليات</option>

              <option value="sale_created">إنشاء فاتورة بيع</option>
              <option value="sale_return_created">مرتجع بيع</option>

              <option value="purchase_created">إنشاء فاتورة شراء</option>

              <option value="stock_count_created">إنشاء جرد</option>
              <option value="stock_count_approved">اعتماد جرد</option>
              <option value="stock_count_canceled">إلغاء جرد</option>

              <option value="cash_in">دخول خزنة</option>
              <option value="cash_out">خروج خزنة</option>
              <option value="cash_deposit">إيداع خزنة</option>
              <option value="cash_withdraw">سحب خزنة</option>

              <option value="expense_created">إضافة مصروف</option>

              <option value="product_created">إضافة منتج</option>
              <option value="product_updated">تعديل منتج</option>
              <option value="product_activated">تفعيل منتج</option>
              <option value="product_deactivated">تعطيل منتج</option>
              <option value="variant_updated">تعديل صنف</option>
              <option value="variant_created">إضافة صنف</option>
              <option value="variant_activated">تفعيل صنف</option>
              <option value="variant_deactivated">تعطيل صنف</option>

              <option value="user_created">إضافة مستخدم</option>
              <option value="user_updated">تعديل مستخدم</option>
              <option value="user_activated">تفعيل مستخدم</option>
              <option value="user_deactivated">تعطيل مستخدم</option>
              <option value="user_password_reset">تغيير كلمة مرور</option>

              <option value="supplier_created">إضافة مورد</option>
              <option value="supplier_updated">تعديل مورد</option>
              <option value="supplier_deactivated">تعطيل مورد</option>

              <option value="database_backup_created">Backup</option>
              <option value="database_restored">Restore</option>
            </select>
          </Field>

          <Field label="الموديول">
            <select
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              style={inputStyle}
            >
              <option value="all">كل الموديولات</option>
              <option value="sales">المبيعات</option>
              <option value="purchase_invoices">المشتريات</option>
              <option value="cash_movements">الخزنة</option>
              <option value="expenses">المصروفات</option>
              <option value="products">المنتجات</option>
              <option value="product_variants">أصناف المنتجات</option>
              <option value="sale_returns">مرتجعات البيع</option>
              <option value="stock_counts">جلسات الجرد</option>
              <option value="users">المستخدمين</option>
              <option value="suppliers">الموردين</option>
              <option value="settings">الإعدادات</option>
            </select>
          </Field>

          <Field label="بحث">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في التفاصيل أو المستخدم"
              style={inputStyle}
            />
          </Field>

          <button type="button" onClick={() => void loadLogs()} style={primaryButtonStyle}>
            {loading ? 'جاري التحميل...' : 'تطبيق الفلتر'}
          </button>

          <button type="button" onClick={clearFilters} style={secondaryButtonStyle}>
            مسح الفلتر
          </button>

          <button
            type="button"
            onClick={printActivityReport}
            style={{
              ...primaryButtonStyle,
              background: 'rgba(16,185,129,0.14)',
              border: '1px solid rgba(16,185,129,0.32)',
              color: '#6ee7b7'
            }}
          >
            طباعة السجل
          </button>
          
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
              <th style={thStyle}>#</th>
              <th style={thStyle}>العملية</th>
              <th style={thStyle}>الموديول</th>
              <th style={thStyle}>رقم المرجع</th>
              <th style={thStyle}>التفاصيل</th>
              <th style={thStyle}>المستخدم</th>
              <th style={thStyle}>التاريخ</th>
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
              logs.map((item) => {
                const detailsText = formatDetails(item.details);
                const isExpanded = Boolean(expandedDetails[item.id]);
                const canExpand = detailsText.length > 90;

                return (
                  <tr key={item.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={tdStyle}>{item.id}</td>

                    <td style={tdStyle}>
                      <span style={getActionBadgeStyle(item.action)}>
                        {getActionLabel(item.action)}
                      </span>
                    </td>

                    <td style={tdStyle}>{getEntityLabel(item.entity)}</td>
                    <td style={tdStyle}>{item.entity_id || '—'}</td>

                    <td style={{ ...tdStyle, maxWidth: '420px' }}>
                      <div
                        title={!isExpanded ? detailsText : undefined}
                        style={{
                          lineHeight: 1.7,
                          whiteSpace: isExpanded ? 'normal' : 'nowrap',
                          overflow: isExpanded ? 'visible' : 'hidden',
                          textOverflow: isExpanded ? 'clip' : 'ellipsis',
                          wordBreak: 'break-word'
                        }}
                      >
                        {detailsText}
                      </div>

                      {canExpand && (
                        <button
                          type="button"
                          onClick={() => toggleDetails(item.id)}
                          style={{
                            marginTop: '6px',
                            border: 'none',
                            background: 'transparent',
                            color: '#93c5fd',
                            fontWeight: 900,
                            cursor: 'pointer',
                            padding: 0
                          }}
                        >
                          {isExpanded ? 'عرض أقل' : 'عرض المزيد'}
                        </button>
                      )}
                    </td>

                    <td style={tdStyle}>{formatLogUser(item)}</td>

                    <td style={{ ...tdStyle, color: '#94a3b8' }}>
                      {formatDate(item.created_at)}
                    </td>
                  </tr>
                );
              })
            }

            {!loading && logs.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    ...tdStyle,
                    padding: '30px',
                    textAlign: 'center',
                    color: '#94a3b8'
                  }}
                >
                  لا توجد عمليات مطابقة للفلتر
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatLogUser(item: ActivityLog) {
  if (item.user_name || item.username) {
    return item.user_name || item.username;
  }

  return 'غير محدد';
}

function escapeHtml(value: unknown) {
  return String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: '8px' }}>
      <span style={{ color: '#cbd5e1', fontWeight: 800 }}>{label}</span>
      {children}
    </label>
  );
}

function getActionLabel(action: string) {
  switch (action) {
    case 'sale_created':
      return 'فاتورة بيع';
    case 'sale_return_created':
      return 'مرتجع بيع';
    case 'purchase_created':
      return 'فاتورة شراء';

    case 'cash_in':
      return 'دخول خزنة';
    case 'cash_out':
      return 'خروج خزنة';
    case 'cash_deposit':
      return 'إيداع خزنة';
    case 'cash_withdraw':
      return 'سحب خزنة';

    case 'expense_created':
      return 'مصروف';

    case 'product_created':
      return 'إضافة منتج';
    case 'product_updated':
      return 'تعديل منتج';
    case 'product_activated':
      return 'تفعيل منتج';
    case 'product_deactivated':
      return 'تعطيل منتج';
    case 'variant_updated':
      return 'تعديل صنف';
    case 'variant_created':
     return 'إضافة صنف';
      
    case 'user_created':
      return 'إضافة مستخدم';
    case 'user_updated':
      return 'تعديل مستخدم';
    case 'user_activated':
      return 'تفعيل مستخدم';
    case 'user_deactivated':
      return 'تعطيل مستخدم';
    case 'user_password_reset':
      return 'كلمة مرور';

    case 'supplier_created':
      return 'إضافة مورد';
    case 'supplier_updated':
      return 'تعديل مورد';
    case 'supplier_deactivated':
      return 'تعطيل مورد';

    case 'database_backup_created':
      return 'Backup';
    case 'database_restored':
      return 'Restore';

    case 'variant_activated':
      return 'تفعيل صنف';

    case 'variant_deactivated':
      return 'تعطيل صنف';

    case 'customer_created':
      return 'إضافة عميل';

    case 'customer_updated':
      return 'تعديل عميل';

    case 'customer_deactivated':
      return 'تعطيل عميل';

    case 'customer_payment_created':
      return 'دفعة عميل';

    case 'supplier_payment_created':
      return 'دفعة مورد';

    case 'database_reset':
      return 'تصفير البرنامج';

    case 'stock_count_created':
      return 'إنشاء جرد';

    case 'stock_count_approved':
      return 'اعتماد جرد';

    case 'stock_count_canceled':
      return 'إلغاء جرد';  

    default:
      return action;
  }
}

function getEntityLabel(entity?: string | null) {
  switch (entity) {
    case 'sales':
      return 'المبيعات';
    case 'sale_returns':
     return 'مرتجعات البيع';  
    case 'purchase_invoices':
      return 'المشتريات';
    case 'cash_movements':
      return 'الخزنة';
    case 'expenses':
      return 'المصروفات';
    case 'products':
      return 'المنتجات';
    case 'product_variants':
      return 'أصناف المنتجات';
    case 'users':
      return 'المستخدمين';
    case 'suppliers':
      return 'الموردين';
    case 'settings':
      return 'الإعدادات';

    case 'stock_counts':
      return 'الجرد';
  
    default:
      return entity || '—';
  }
}

function formatDetails(value?: string | null) {
  if (!value) return '—';

  try {
    const parsed = JSON.parse(value);

    if (!parsed || typeof parsed !== 'object') {
      return String(value);
    }

    const parts = [
      parsed.title ? `العنوان: ${parsed.title}` : null,
      parsed.name ? `الاسم: ${parsed.name}` : null,
      parsed.username ? `اسم المستخدم: ${parsed.username}` : null,
      parsed.phone ? `الهاتف: ${parsed.phone}` : null,
      parsed.role ? `الدور: ${roleName(parsed.role)}` : null,

      parsed.product_name ? `المنتج: ${parsed.product_name}` : null,
      parsed.barcode ? `الباركود: ${parsed.barcode}` : null,
      parsed.size ? `المقاس: ${parsed.size}` : null,
      parsed.color ? `اللون: ${parsed.color}` : null,

      parsed.amount ? `المبلغ: ${moneyValue(parsed.amount)}` : null,
      parsed.grand_total ? `الإجمالي: ${moneyValue(parsed.grand_total)}` : null,
      parsed.total_amount ? `الإجمالي: ${moneyValue(parsed.total_amount)}` : null,
      parsed.paid_amount ? `المدفوع: ${moneyValue(parsed.paid_amount)}` : null,
      parsed.remaining_amount ? `المتبقي: ${moneyValue(parsed.remaining_amount)}` : null,

      parsed.payment_method ? `الدفع: ${paymentName(parsed.payment_method)}` : null,
      parsed.items_count ? `عدد الأصناف: ${parsed.items_count}` : null,
      parsed.session_id ? `رقم الجلسة: ${parsed.session_id}` : null,
      parsed.changed_items !== undefined ? `أصناف تم تعديلها: ${parsed.changed_items}` : null,
      parsed.shortage_items !== undefined ? `أصناف عجز: ${parsed.shortage_items}` : null,
      parsed.surplus_items !== undefined ? `أصناف زيادة: ${parsed.surplus_items}` : null,
      parsed.total_shortage_qty !== undefined ? `إجمالي العجز: ${parsed.total_shortage_qty}` : null,
      parsed.total_surplus_qty !== undefined ? `إجمالي الزيادة: ${parsed.total_surplus_qty}` : null,
      parsed.buy_difference_value !== undefined ? `فرق الشراء: ${moneyValue(parsed.buy_difference_value)}` : null,
      parsed.sell_difference_value !== undefined ? `فرق البيع: ${moneyValue(parsed.sell_difference_value)}` : null,
      parsed.quantity ? `الكمية: ${parsed.quantity}` : null,
      parsed.old_stock !== undefined ? `المخزون القديم: ${parsed.old_stock}` : null,
      parsed.new_stock !== undefined ? `المخزون الجديد: ${parsed.new_stock}` : null,
      parsed.diff !== undefined ? `الفرق: ${parsed.diff}` : null,

      parsed.original_sale_id ? `فاتورة البيع الأصلية: #${parsed.original_sale_id}` : null,
      parsed.return_id ? `رقم المرتجع: #${parsed.return_id}` : null,
      parsed.refund_amount ? `المردود: ${moneyValue(parsed.refund_amount)}` : null,
      parsed.reason ? `السبب: ${parsed.reason}` : null,
      parsed.loyalty_points_reversed ? `نقاط ملغاة: ${parsed.loyalty_points_reversed}` : null,

      parsed.is_active !== undefined
        ? `الحالة: ${Number(parsed.is_active) === 1 ? 'مفعل' : 'معطل'}`
        : null,

      parsed.path ? `المسار: ${parsed.path}` : null,
      parsed.restored_from ? `استرجاع من: ${parsed.restored_from}` : null,
      parsed.safety_backup ? `نسخة أمان: ${parsed.safety_backup}` : null,

      parsed.notes ? `ملاحظات: ${parsed.notes}` : null
    ].filter(Boolean);

    if (parts.length) {
      return parts.join(' • ');
    }

    return formatUnknownDetails(parsed);
  } catch {
    return value;
  }
}

function moneyValue(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`;
}

function roleName(value: string) {
  if (value === 'admin') return 'مدير';
  if (value === 'cashier') return 'كاشير';
  return value;
}

function formatUnknownDetails(parsed: Record<string, any>) {
  const labels: Record<string, string> = {
    id: 'المعرف',
    type: 'النوع',
    action: 'العملية',
    entity: 'الموديول',
    entity_id: 'رقم المرجع',
    customer_id: 'رقم العميل',
    supplier_id: 'رقم المورد',
    purchase_id: 'رقم الشراء',
    sale_id: 'رقم البيع',
    variant_id: 'رقم الصنف',
    product_id: 'رقم المنتج',
    user_id: 'رقم المستخدم',
    email: 'البريد',
    address: 'العنوان',
    description: 'الوصف',
    session_id: 'رقم جلسة الجرد',
    items_count: 'عدد الأصناف',
    changed_items: 'أصناف تم تعديلها',
    shortage_items: 'أصناف عجز',
    surplus_items: 'أصناف زيادة',
    total_shortage_qty: 'إجمالي العجز',
    total_surplus_qty: 'إجمالي الزيادة',
    matched_count: 'أصناف مطابقة',
    counted_count: 'أصناف تم جردها',
    buy_difference_value: 'فرق الشراء',
    sell_difference_value: 'فرق البيع',
  };

  return Object.entries(parsed)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => {
      const label = labels[key] || key;
      return `${label}: ${formatDetailValue(value)}`;
    })
    .join(' • ') || '—';
}

function formatDetailValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? 'نعم' : 'لا';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function paymentName(value: string) {
  if (value === 'cash') return 'كاش';
  if (value === 'card') return 'كارت';
  if (value === 'wallet') return 'محفظة';
  if (value === 'bank' || value === 'bank_transfer') return 'تحويل بنكي / انستا باي';
  return value;
}

function formatDate(value?: string) {
  if (!value) return '—';

  try {
    const raw = String(value);
    const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;

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

function getActionBadgeStyle(action: string): React.CSSProperties {
  const isDanger =
    action.includes('delete') ||
    action.includes('deactivated') ||
    action.includes('canceled') ||
    action.includes('restored') ||
    action.includes('return') ||
    action.includes('out') ||
    action.includes('withdraw');

  const isSuccess =
    action.includes('created') ||
    action.includes('approved') ||
    action.includes('activated') ||
    action.includes('deposit') ||
    action.includes('in') ||
    action.includes('backup');

  if (isDanger) {
    return {
      ...badgeStyle,
      background: 'rgba(239,68,68,0.16)',
      color: '#fca5a5'
    };
  }

  if (isSuccess) {
    return {
      ...badgeStyle,
      background: 'rgba(16,185,129,0.16)',
      color: '#6ee7b7'
    };
  }

  return badgeStyle;
}

const inputStyle: React.CSSProperties = {
  height: '44px',
  borderRadius: '12px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  outline: 'none',
  padding: '0 12px',
  textAlign: 'right',
  direction: 'rtl',
  boxSizing: 'border-box',
  minWidth: '180px'
};

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  height: '44px',
  borderRadius: '12px',
  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 18px',
  cursor: 'pointer'
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  height: '44px',
  borderRadius: '12px',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 18px',
  cursor: 'pointer'
};

const thStyle: React.CSSProperties = {
  padding: '12px',
  fontWeight: 900,
  whiteSpace: 'nowrap'
};

const tdStyle: React.CSSProperties = {
  padding: '12px',
  color: '#e5e7eb',
  whiteSpace: 'nowrap'
};

const badgeStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: '999px',
  background: 'rgba(59,130,246,0.16)',
  color: '#93c5fd',
  fontWeight: 900,
  whiteSpace: 'nowrap'
};