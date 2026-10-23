import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import PaginationBar, {
  SYSTEM_PAGE_SIZE,
} from '../../components/PaginationBar';

import { formatMoney } from '../../../shared/money';

type SalespersonPerformance = {
  id: number;
  name: string;
  is_active: number;
  month: string;

  target_amount: number;

  sales_count: number;
  sales_total: number;

  returns_count: number;
  returns_total: number;

  exchange_count: number;
  exchange_adjustment: number;

  net_sales: number;

  achievement_percent: number;

  remaining_target: number;
  exceeded_target: number;
};

function getCurrentMonth() {
  const now = new Date();

  const year = now.getFullYear();

  const month = String(now.getMonth() + 1).padStart(2, '0');

  return `${year}-${month}`;
}

function getMonthRange(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);

  const monthNumber = Number(match[2]);

  if (monthNumber < 1 || monthNumber > 12) {
    return null;
  }

  const lastDay = new Date(year, monthNumber, 0).getDate();

  return {
    date_from: `${month}-01`,

    date_to: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

export default function SalespeoplePage() {
  const [month, setMonth] = useState(getCurrentMonth());

  const [rows, setRows] = useState<SalespersonPerformance[]>([]);
  const [salespeoplePage, setSalespeoplePage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [saving, setSaving] = useState(false);

  const [formName, setFormName] = useState('');
  const [salespersonSearch, setSalespersonSearch] = useState('');

  const [targetFilter, setTargetFilter] = useState<
    'all' | 'with_target' | 'without_target' | 'achieved' | 'pending'
  >('all');
  const [editingId, setEditingId] = useState<number | null>(null);

  const [targetDrafts, setTargetDrafts] = useState<Record<number, string>>({});

  const [savingTargetId, setSavingTargetId] = useState<number | null>(null);

  const [togglingId, setTogglingId] = useState<number | null>(null);

  const [selectedSalesperson, setSelectedSalesperson] =
    useState<SalespersonPerformance | null>(null);

  const [invoiceRows, setInvoiceRows] = useState<any[]>([]);

  const [invoicesTotal, setInvoicesTotal] = useState(0);

  const [invoicesPage, setInvoicesPage] = useState(1);

  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const [pageMessage, setPageMessage] = useState<{
    type: 'success' | 'error';

    text: string;
  } | null>(null);

  function showMessage(
    type: 'success' | 'error',

    text: string,
  ) {
    setPageMessage({
      type,
      text,
    });

    window.setTimeout(
      () => {
        setPageMessage(null);
      },
      type === 'error' ? 4500 : 2200,
    );
  }

  async function loadPerformance() {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return;
    }

    setLoading(true);

    try {
      const result = await window.api.getSalespeoplePerformance({
        month,
      });

      const nextRows = Array.isArray(result) ? result : [];

      setRows(nextRows);

      setTargetDrafts(
        Object.fromEntries(
          nextRows.map((row) => [row.id, String(row.target_amount ?? 0)]),
        ),
      );

      setSelectedSalesperson((current) => {
        if (!current) {
          return null;
        }

        return nextRows.find((row) => row.id === current.id) ?? current;
      });
    } catch (error) {
      console.error('Failed to load salespeople performance:', error);

      showMessage(
        'error',
        error instanceof Error ? error.message : 'تعذر تحميل بيانات البائعين',
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadSalespersonInvoices(salespersonId: number, page = 1) {
    const range = getMonthRange(month);

    if (!range) {
      return;
    }

    const safePage = Math.max(1, Number(page || 1));

    setLoadingInvoices(true);

    try {
      const result = await window.api.listSales({
        salesperson_id: salespersonId,

        date_from: range.date_from,

        date_to: range.date_to,

        limit: SYSTEM_PAGE_SIZE,

        offset: (safePage - 1) * SYSTEM_PAGE_SIZE,
      });

      setInvoiceRows(Array.isArray(result.rows) ? result.rows : []);

      setInvoicesTotal(Number(result.total || 0));

      setInvoicesPage(safePage);
    } catch (error) {
      console.error('Failed to load salesperson invoices:', error);

      showMessage(
        'error',
        error instanceof Error ? error.message : 'تعذر تحميل فواتير البائع',
      );
    } finally {
      setLoadingInvoices(false);
    }
  }

  async function saveSalesperson() {
    const name = formName.trim().replace(/\s+/g, ' ');

    if (!name) {
      showMessage('error', 'اكتب اسم البائع');

      return;
    }

    if (saving) {
      return;
    }

    setSaving(true);

    try {
      if (editingId) {
        await window.api.updateSalesperson({
          id: editingId,

          name,
        });

        showMessage('success', 'تم تعديل اسم البائع');
      } else {
        await window.api.createSalesperson({
          name,
        });

        showMessage('success', 'تم إضافة البائع');
      }

      setFormName('');

      setEditingId(null);

      await loadPerformance();
    } catch (error) {
      console.error('Failed to save salesperson:', error);

      showMessage(
        'error',
        error instanceof Error ? error.message : 'تعذر حفظ البائع',
      );
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: SalespersonPerformance) {
    setEditingId(row.id);

    setFormName(row.name);

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  function cancelEdit() {
    setEditingId(null);

    setFormName('');
  }

  async function toggleSalesperson(row: SalespersonPerformance) {
    if (togglingId) {
      return;
    }

    setTogglingId(row.id);

    try {
      const nextActive = !row.is_active;

      await window.api.setSalespersonActive({
        id: row.id,

        is_active: nextActive,
      });

      showMessage(
        'success',
        nextActive ? 'تم تفعيل البائع' : 'تم تعطيل البائع',
      );

      await loadPerformance();
    } catch (error) {
      console.error('Failed to toggle salesperson:', error);

      showMessage(
        'error',
        error instanceof Error ? error.message : 'تعذر تحديث حالة البائع',
      );
    } finally {
      setTogglingId(null);
    }
  }

  async function saveTarget(row: SalespersonPerformance) {
    if (savingTargetId) {
      return;
    }

    const raw = targetDrafts[row.id] ?? '0';

    const target = Number(raw);

    if (!Number.isFinite(target) || target < 0) {
      showMessage('error', 'قيمة التارجت غير صحيحة');

      return;
    }

    setSavingTargetId(row.id);

    try {
      await window.api.setSalespersonMonthlyTarget({
        salesperson_id: row.id,

        month,

        target_amount: target,
      });

      showMessage('success', `تم حفظ تارجت ${row.name}`);

      await loadPerformance();
    } catch (error) {
      console.error('Failed to save salesperson target:', error);

      showMessage(
        'error',
        error instanceof Error ? error.message : 'تعذر حفظ التارجت',
      );
    } finally {
      setSavingTargetId(null);
    }
  }

  function openInvoices(row: SalespersonPerformance) {
    setSelectedSalesperson(row);

    setInvoicesPage(1);
  }

  function closeInvoices() {
    setSelectedSalesperson(null);

    setInvoiceRows([]);

    setInvoicesTotal(0);

    setInvoicesPage(1);
  }

  useEffect(() => {
    if (/^\d{4}-\d{2}$/.test(month)) {
      void loadPerformance();
    }
  }, [month]);

  useEffect(() => {
    if (selectedSalesperson) {
      void loadSalespersonInvoices(selectedSalesperson.id, 1);
    }
  }, [selectedSalesperson?.id, month]);

  const filteredRows = useMemo(() => {
    const term = salespersonSearch.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSearch =
        !term ||
        row.name.toLowerCase().includes(term) ||
        String(Number(row.target_amount || 0)).includes(term);

      if (!matchesSearch) {
        return false;
      }

      const target = Number(row.target_amount || 0);
      const achievement = Number(row.achievement_percent || 0);

      switch (targetFilter) {
        case 'with_target':
          return target > 0;

        case 'without_target':
          return target <= 0;

        case 'achieved':
          return target > 0 && achievement >= 100;

        case 'pending':
          return target > 0 && achievement < 100;

        default:
          return true;
      }
    });
  }, [rows, salespersonSearch, targetFilter]);

  const pagedSalespeopleRows = useMemo(() => {
    const start = (salespeoplePage - 1) * SYSTEM_PAGE_SIZE;

    return filteredRows.slice(start, start + SYSTEM_PAGE_SIZE);
  }, [filteredRows, salespeoplePage]);

  useEffect(() => {
    setSalespeoplePage(1);
  }, [salespersonSearch, targetFilter, month]);

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(filteredRows.length / SYSTEM_PAGE_SIZE),
    );

    if (salespeoplePage > totalPages) {
      setSalespeoplePage(totalPages);
    }
  }, [filteredRows.length, salespeoplePage]);

  const summary = useMemo(() => {
    const target = filteredRows.reduce(
      (total, row) => total + Number(row.target_amount || 0),
      0,
    );

    const netSales = filteredRows.reduce(
      (total, row) => total + Number(row.net_sales || 0),
      0,
    );

    const salesCount = filteredRows.reduce(
      (total, row) => total + Number(row.sales_count || 0),
      0,
    );

    const achievement =
      target > 0 ? Math.round((netSales / target) * 10000) / 100 : 0;

    return {
      target,
      netSales,
      salesCount,
      achievement,
    };
  }, [filteredRows]);

  const hasSalespeopleFilters =
    Boolean(salespersonSearch.trim()) ||
    targetFilter !== 'all' ||
    month !== getCurrentMonth();

  return (
    <div
      className="fade-slide-in"
      style={{
        display: 'grid',
        gap: '18px',
      }}
    >
      {pageMessage && (
        <div
          style={{
            position: 'fixed',

            top: '24px',

            left: '50%',

            transform: 'translateX(-50%)',

            zIndex: 2147483647,

            padding: '12px 18px',

            borderRadius: '14px',

            background:
              pageMessage.type === 'error'
                ? 'rgba(239,68,68,0.95)'
                : 'rgba(16,185,129,0.95)',

            color: '#fff',

            fontWeight: 900,

            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',

            pointerEvents: 'none',
          }}
        >
          {pageMessage.text}
        </div>
      )}

      <section className="glass-card" style={headerStyle}>
        <div>
          <h2
            style={{
              margin: '0 0 7px',
            }}
          >
            إدارة البائعين
          </h2>

          <p
            style={{
              margin: 0,

              color: '#94a3b8',

              fontWeight: 700,
            }}
          >
            إدارة فريق البيع ومتابعة التارجت والمبيعات والفواتير المرتبطة بكل
            بائع.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            alignItems: 'end',
            direction: 'rtl',
          }}
        >
          <label
            style={{
              display: 'grid',
              gap: '6px',
              fontWeight: 800,
              color: '#cbd5e1',
            }}
          >
            بحث
            <input
              value={salespersonSearch}
              onChange={(event) => setSalespersonSearch(event.target.value)}
              placeholder="اسم البائع أو قيمة التارجت"
              style={{
                ...inputStyle,
                width: '220px',
              }}
            />
          </label>

          <label
            style={{
              display: 'grid',
              gap: '6px',
              fontWeight: 800,
              color: '#cbd5e1',
            }}
          >
            التارجت
            <select
              value={targetFilter}
              onChange={(event) =>
                setTargetFilter(
                  event.target.value as
                    | 'all'
                    | 'with_target'
                    | 'without_target'
                    | 'achieved'
                    | 'pending',
                )
              }
              style={{
                ...inputStyle,
                width: '170px',
              }}
            >
              <option value="all">كل البائعين</option>
              <option value="with_target">عليه تارجت</option>
              <option value="without_target">بدون تارجت</option>
              <option value="achieved">حقق التارجت</option>
              <option value="pending">لم يحقق التارجت</option>
            </select>
          </label>

          <label
            style={{
              display: 'grid',
              gap: '6px',
              fontWeight: 800,
              color: '#cbd5e1',
            }}
          >
            شهر المتابعة
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              style={{
                ...inputStyle,
                width: '190px',
              }}
            />
          </label>
          {hasSalespeopleFilters && (
            <button
              type="button"
              onClick={() => {
                setSalespersonSearch('');
                setTargetFilter('all');
                setMonth(getCurrentMonth());
                setSalespeoplePage(1);
              }}
              style={secondaryButtonStyle}
            >
              مسح الفلتر
            </button>
          )}
        </div>
      </section>

      <section style={summaryGridStyle}>
        <SummaryCard
          label="إجمالي التارجت"
          value={formatMoney(summary.target)}
        />

        <SummaryCard
          label="صافي مبيعات البائعين"
          value={formatMoney(summary.netSales)}
        />

        <SummaryCard label="عدد الفواتير" value={String(summary.salesCount)} />

        <SummaryCard
          label="تحقيق التارجت"
          value={summary.target > 0 ? `${summary.achievement}%` : '—'}
        />
      </section>

      <section
        className="glass-card"
        style={{
          ...cardStyle,

          display: 'grid',

          gridTemplateColumns: 'minmax(260px, 360px) minmax(0, 1fr)',

          alignItems: 'start',
        }}
      >
        <div
          style={{
            display: 'grid',

            gap: '14px',

            padding: '4px 8px',
          }}
        >
          <div>
            <h3
              style={{
                margin: '0 0 6px',
              }}
            >
              {editingId ? 'تعديل البائع' : 'إضافة بائع جديد'}
            </h3>

            <div
              style={{
                color: '#94a3b8',

                fontSize: '13px',

                fontWeight: 700,
              }}
            >
              البائع مستقل عن حساب الكاشير ولا يحتاج حساب دخول.
            </div>
          </div>

          <input
            value={formName}
            onChange={(event) => setFormName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();

                void saveSalesperson();
              }
            }}
            placeholder="اسم البائع"
            style={inputStyle}
          />

          <div
            style={{
              display: 'flex',

              gap: '8px',

              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => void saveSalesperson()}
              disabled={saving}
              style={primaryButtonStyle}
            >
              {saving
                ? 'جاري الحفظ...'
                : editingId
                  ? 'حفظ التعديل'
                  : 'إضافة البائع'}
            </button>

            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                style={secondaryButtonStyle}
              >
                إلغاء
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            minWidth: 0,

            overflowX: 'auto',

            borderRight: '1px solid rgba(255,255,255,0.08)',

            paddingRight: '18px',
          }}
        >
          <PaginationBar
            page={salespeoplePage}
            totalItems={filteredRows.length}
            loading={loading}
            onPageChange={(page) => {
              setSalespeoplePage(page);
            }}
          />

          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>البائع</th>

                <th style={thStyle}>الحالة</th>

                <th style={thStyle}>التارجت</th>

                <th style={thStyle}>صافي المبيعات</th>

                <th style={thStyle}>الفواتير</th>

                <th style={thStyle}>المرتجعات</th>

                <th style={thStyle}>تحقيق التارجت</th>

                <th style={thStyle}>المتبقي</th>

                <th style={thStyle}>إجراءات</th>
              </tr>
            </thead>

            <tbody>
              {loading && filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={emptyCellStyle}>
                    جاري تحميل البائعين...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={emptyCellStyle}>
                    لا يوجد بائعين
                  </td>
                </tr>
              ) : (
                pagedSalespeopleRows.map((row) => (
                  <tr
                    key={row.id}
                    style={{
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <td style={tdStyle}>
                      <strong>{row.name}</strong>
                    </td>

                    <td style={tdStyle}>
                      <span
                        style={
                          row.is_active ? activeBadgeStyle : inactiveBadgeStyle
                        }
                      >
                        {row.is_active ? 'مفعل' : 'متوقف'}
                      </span>
                    </td>

                    <td style={tdStyle}>
                      <div
                        style={{
                          display: 'flex',

                          gap: '6px',

                          minWidth: '180px',
                        }}
                      >
                        <input
                          type="number"
                          min={0}
                          value={targetDrafts[row.id] ?? ''}
                          onChange={(event) =>
                            setTargetDrafts((current) => ({
                              ...current,

                              [row.id]: event.target.value,
                            }))
                          }
                          style={{
                            ...smallInputStyle,

                            width: '105px',
                          }}
                        />

                        <button
                          type="button"
                          disabled={savingTargetId === row.id}
                          onClick={() => void saveTarget(row)}
                          style={smallButtonStyle}
                        >
                          {savingTargetId === row.id ? '...' : 'حفظ'}
                        </button>
                      </div>
                    </td>

                    <td
                      style={{
                        ...tdStyle,

                        color: '#6ee7b7',

                        fontWeight: 900,
                      }}
                    >
                      {formatMoney(row.net_sales)}
                    </td>

                    <td style={tdStyle}>{row.sales_count}</td>

                    <td style={tdStyle}>
                      <div
                        style={{
                          display: 'grid',

                          gap: '3px',
                        }}
                      >
                        <span>{row.returns_count} عملية</span>

                        <span
                          style={{
                            color: '#fca5a5',

                            fontSize: '12px',
                          }}
                        >
                          {formatMoney(row.returns_total)}
                        </span>
                      </div>
                    </td>

                    <td style={tdStyle}>
                      {row.target_amount > 0 ? (
                        <div
                          style={{
                            display: 'grid',

                            gap: '5px',

                            minWidth: '110px',
                          }}
                        >
                          <strong
                            style={{
                              color:
                                row.achievement_percent >= 100
                                  ? '#86efac'
                                  : '#c4b5fd',
                            }}
                          >
                            {row.achievement_percent}%
                          </strong>

                          <div
                            style={{
                              height: '6px',

                              borderRadius: '999px',

                              overflow: 'hidden',

                              background: 'rgba(255,255,255,0.08)',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',

                                width: `${Math.min(
                                  100,
                                  Math.max(0, row.achievement_percent),
                                )}%`,

                                background:
                                  row.achievement_percent >= 100
                                    ? '#22c55e'
                                    : '#7c3aed',
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span
                          style={{
                            color: '#64748b',
                          }}
                        >
                          بدون تارجت
                        </span>
                      )}
                    </td>

                    <td style={tdStyle}>
                      {row.target_amount <= 0 ? (
                        '—'
                      ) : row.exceeded_target > 0 ? (
                        <strong
                          style={{
                            color: '#86efac',
                          }}
                        >
                          +{formatMoney(row.exceeded_target)}
                        </strong>
                      ) : (
                        formatMoney(row.remaining_target)
                      )}
                    </td>

                    <td style={tdStyle}>
                      <div
                        style={{
                          display: 'flex',

                          gap: '6px',

                          flexWrap: 'wrap',

                          minWidth: '210px',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => openInvoices(row)}
                          style={smallButtonStyle}
                        >
                          الفواتير
                        </button>

                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          style={smallButtonStyle}
                        >
                          تعديل
                        </button>

                        <button
                          type="button"
                          disabled={togglingId === row.id}
                          onClick={() => void toggleSalesperson(row)}
                          style={{
                            ...smallButtonStyle,

                            borderColor: row.is_active
                              ? 'rgba(239,68,68,0.45)'
                              : 'rgba(34,197,94,0.45)',

                            color: row.is_active ? '#fca5a5' : '#86efac',
                          }}
                        >
                          {togglingId === row.id
                            ? '...'
                            : row.is_active
                              ? 'تعطيل'
                              : 'تفعيل'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedSalesperson && (
        <section className="glass-card" style={cardStyle}>
          <div
            style={{
              display: 'flex',

              alignItems: 'center',

              justifyContent: 'space-between',

              gap: '12px',

              flexWrap: 'wrap',
            }}
          >
            <div>
              <h3
                style={{
                  margin: '0 0 5px',
                }}
              >
                فواتير {selectedSalesperson.name}
              </h3>

              <div
                style={{
                  color: '#94a3b8',

                  fontSize: '13px',

                  fontWeight: 700,
                }}
              >
                الفواتير المرتبطة بالبائع خلال {month}
              </div>
            </div>

            <button
              type="button"
              onClick={closeInvoices}
              style={secondaryButtonStyle}
            >
              إغلاق
            </button>
          </div>

          <PaginationBar
            page={invoicesPage}
            totalItems={invoicesTotal}
            loading={loadingInvoices}
            onPageChange={(page) => {
              void loadSalespersonInvoices(selectedSalesperson.id, page);
            }}
          />

          <div
            style={{
              overflowX: 'auto',
            }}
          >
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>#</th>

                  <th style={thStyle}>التاريخ</th>

                  <th style={thStyle}>العميل</th>

                  <th style={thStyle}>الكاشير</th>

                  <th style={thStyle}>الإجمالي</th>

                  <th style={thStyle}>المرتجعات</th>

                  <th style={thStyle}>الصافي الحالي</th>

                  <th style={thStyle}>الحالة</th>
                </tr>
              </thead>

              <tbody>
                {loadingInvoices && invoiceRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={emptyCellStyle}>
                      جاري تحميل الفواتير...
                    </td>
                  </tr>
                ) : invoiceRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={emptyCellStyle}>
                      لا توجد فواتير لهذا البائع في الشهر المحدد
                    </td>
                  </tr>
                ) : (
                  invoiceRows.map((sale) => (
                    <tr
                      key={sale.id}
                      style={{
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      <td style={tdStyle}>#{sale.id}</td>

                      <td style={tdStyle}>
                        {sale.business_date ||
                          String(sale.created_at || '').slice(0, 10) ||
                          '—'}
                      </td>

                      <td style={tdStyle}>
                        {sale.customer_name || 'عميل نقدي'}
                      </td>

                      <td style={tdStyle}>{sale.cashier_name || '—'}</td>

                      <td style={tdStyle}>{formatMoney(sale.grand_total)}</td>

                      <td
                        style={{
                          ...tdStyle,

                          color:
                            Number(sale.total_return_amount || 0) > 0
                              ? '#fca5a5'
                              : undefined,
                        }}
                      >
                        {formatMoney(sale.total_return_amount || 0)}
                      </td>

                      <td
                        style={{
                          ...tdStyle,

                          color: '#6ee7b7',

                          fontWeight: 900,
                        }}
                      >
                        {formatMoney(
                          sale.current_net_total ?? sale.grand_total,
                        )}
                      </td>

                      <td style={tdStyle}>
                        {sale.cancelled_at ? (
                          <span style={inactiveBadgeStyle}>ملغاة</span>
                        ) : (
                          <span style={activeBadgeStyle}>فعالة</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="glass-card"
      style={{
        padding: '18px',

        borderRadius: '16px',

        display: 'grid',

        gap: '8px',

        minWidth: 0,
      }}
    >
      <span
        style={{
          color: '#94a3b8',

          fontWeight: 800,

          fontSize: '13px',
        }}
      >
        {label}
      </span>

      <strong
        style={{
          fontSize: '22px',

          color: '#f8fafc',

          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </strong>
    </div>
  );
}

const headerStyle: CSSProperties = {
  display: 'flex',

  alignItems: 'center',

  justifyContent: 'space-between',

  gap: '16px',

  flexWrap: 'wrap',

  padding: '18px',

  borderRadius: '18px',
};

const summaryGridStyle: CSSProperties = {
  display: 'grid',

  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',

  gap: '12px',
};

const cardStyle: CSSProperties = {
  padding: '18px',

  borderRadius: '18px',

  gap: '16px',
};

const inputStyle: CSSProperties = {
  width: '100%',

  height: '42px',

  borderRadius: '10px',

  border: '1px solid rgba(255,255,255,0.10)',

  background: 'rgba(255,255,255,0.05)',

  color: '#fff',

  padding: '0 12px',

  outline: 'none',

  boxSizing: 'border-box',

  fontWeight: 700,
};

const smallInputStyle: CSSProperties = {
  ...inputStyle,

  height: '34px',

  padding: '0 8px',

  textAlign: 'center',
};

const primaryButtonStyle: CSSProperties = {
  minHeight: '40px',

  border: 'none',

  borderRadius: '10px',

  background: 'linear-gradient(135deg, #6d5dfc, #7c3aed)',

  color: '#fff',

  padding: '0 16px',

  fontWeight: 900,

  cursor: 'pointer',
};

const secondaryButtonStyle: CSSProperties = {
  minHeight: '40px',

  borderRadius: '10px',

  border: '1px solid rgba(124,58,237,0.50)',

  background: 'rgba(124,58,237,0.10)',

  color: '#c4b5fd',

  padding: '0 16px',

  fontWeight: 900,

  cursor: 'pointer',
};

const smallButtonStyle: CSSProperties = {
  height: '34px',

  borderRadius: '8px',

  border: '1px solid rgba(124,58,237,0.50)',

  background: 'rgba(124,58,237,0.10)',

  color: '#c4b5fd',

  padding: '0 10px',

  fontWeight: 900,

  cursor: 'pointer',

  whiteSpace: 'nowrap',
};

const tableStyle: CSSProperties = {
  width: '100%',

  borderCollapse: 'collapse',

  direction: 'rtl',

  minWidth: '1050px',
};

const thStyle: CSSProperties = {
  textAlign: 'right',

  color: '#cbd5e1',

  padding: '12px 10px',

  whiteSpace: 'nowrap',

  fontSize: '13px',
};

const tdStyle: CSSProperties = {
  padding: '12px 10px',

  color: '#e5e7eb',

  verticalAlign: 'middle',

  fontSize: '13px',
};

const emptyCellStyle: CSSProperties = {
  ...tdStyle,

  textAlign: 'center',

  color: '#94a3b8',

  padding: '30px',
};

const activeBadgeStyle: CSSProperties = {
  display: 'inline-flex',

  alignItems: 'center',

  padding: '4px 9px',

  borderRadius: '999px',

  border: '1px solid rgba(34,197,94,0.32)',

  background: 'rgba(34,197,94,0.12)',

  color: '#86efac',

  fontWeight: 900,

  fontSize: '12px',
};

const inactiveBadgeStyle: CSSProperties = {
  display: 'inline-flex',

  alignItems: 'center',

  padding: '4px 9px',

  borderRadius: '999px',

  border: '1px solid rgba(239,68,68,0.32)',

  background: 'rgba(239,68,68,0.10)',

  color: '#fca5a5',

  fontWeight: 900,

  fontSize: '12px',
};
