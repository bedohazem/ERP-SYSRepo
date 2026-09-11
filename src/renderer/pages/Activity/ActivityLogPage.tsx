import { useEffect, useState } from 'react'
import PaginationBar, { SYSTEM_PAGE_SIZE } from '../../components/PaginationBar'
import {
  ACTIVITY_ACTION_OPTIONS,
  ACTIVITY_ENTITY_OPTIONS,
  formatActivityDetails as formatDetails,
  getActivityActionLabel as getActionLabel,
  getActivityEntityLabel as getEntityLabel,
} from '../../utils/activity-log'
import MultiSelectFilter from '../../components/MultiSelectFilter'
type ActivityFilters = {
  date_from?: string
  date_to?: string
  action?: string
  actions?: string[]
  entity?: string
  entities?: string[]
  search?: string
  limit?: number
  offset?: number
}

export default function ActivityLogPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [expandedDetails, setExpandedDetails] = useState<
    Record<number, boolean>
  >({})
  const [loading, setLoading] = useState(false)
  const [pageMessage, setPageMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  function showMessage(type: 'success' | 'error', text: string) {
    setPageMessage({ type, text })

    setTimeout(() => {
      setPageMessage(null)
    }, 1800)
  }

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [actions, setActions] = useState<string[]>([])
  const [entities, setEntities] = useState<string[]>([])
  const [search, setSearch] = useState('')

  function getFilters(targetPage = page): ActivityFilters {
    const safePage = Math.max(1, Number(targetPage || 1))

    return {
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      actions: actions.length > 0 ? actions : undefined,
      entities: entities.length > 0 ? entities : undefined,
      search: search.trim() || undefined,
      limit: SYSTEM_PAGE_SIZE,
      offset: (safePage - 1) * SYSTEM_PAGE_SIZE,
    }
  }

  function toggleDetails(id: number) {
    setExpandedDetails((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  async function loadLogs(targetPage = page, customFilters?: ActivityFilters) {
    setLoading(true)

    try {
      const safePage = Math.max(1, Number(targetPage || 1))

      const result = await window.api.getActivityLogs(
        customFilters ?? getFilters(safePage),
      )

      setLogs(Array.isArray(result.rows) ? result.rows : [])
      setTotal(Number(result.total || 0))
      setPage(safePage)
      setExpandedDetails({})
    } catch (error) {
      console.error(error)
      showMessage('error', 'حدث خطأ أثناء تحميل سجل العمليات')
      setLogs([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  function clearFilters() {
    const emptyFilters: ActivityFilters = {
      limit: SYSTEM_PAGE_SIZE,
      offset: 0,
    }

    setDateFrom('')
    setDateTo('')
    setActions([])
    setEntities([])
    setSearch('')

    setPage(1)
    void loadLogs(1, emptyFilters)
  }

  async function getAllActivityLogsForPrint() {
    const batchSize = 200

    const baseFilters = {
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      actions: actions.length > 0 ? actions : undefined,
      entities: entities.length > 0 ? entities : undefined,
      search: search.trim() || undefined,
    }

    const firstResult = await window.api.getActivityLogs({
      ...baseFilters,
      limit: batchSize,
      offset: 0,
    })

    const allLogs = Array.isArray(firstResult.rows) ? [...firstResult.rows] : []

    const total = Number(firstResult.total || 0)

    for (let offset = batchSize; offset < total; offset += batchSize) {
      const result = await window.api.getActivityLogs({
        ...baseFilters,
        limit: batchSize,
        offset,
      })

      if (Array.isArray(result.rows)) {
        allLogs.push(...result.rows)
      }
    }

    return allLogs
  }

  async function printActivityReport() {
    let printLogs: ActivityLog[] = []

    try {
      printLogs = await getAllActivityLogsForPrint()
    } catch (error) {
      console.error('Failed to load activity logs for print:', error)
      showMessage('error', 'حدث خطأ أثناء تجهيز سجل العمليات للطباعة')
      return
    }

    const printWindow = window.open('', '_blank', 'width=1100,height=800')

    if (!printWindow) {
      showMessage('error', 'تعذر فتح نافذة الطباعة')
      return
    }

    const filtersText = [
      dateFrom ? `من تاريخ: ${dateFrom}` : null,
      dateTo ? `إلى تاريخ: ${dateTo}` : null,
      actions.length > 0
        ? `نوع العملية: ${actions
            .map((item) => getActionLabel(item))
            .join('، ')}`
        : null,
      entities.length > 0
        ? `القسم: ${entities.map((item) => getEntityLabel(item)).join('، ')}`
        : null,
      search.trim() ? `بحث: ${search.trim()}` : null,
    ].filter(Boolean)

    const rowsHtml = printLogs
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
        `,
      )
      .join('')

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
              عدد العمليات: ${printLogs.length}
            </div>
          </div>

          <div class="summary">
            <div class="card">
              <div class="card-title">عدد النتائج</div>
              <div class="card-value">${printLogs.length}</div>
            </div>

            <div class="card">
              <div class="card-title">نوع التقرير</div>
              <div class="card-value">سجل العمليات</div>
            </div>
          </div>

          <div class="filters">
            ${
              filtersText.length
                ? filtersText
                    .map((item) => `<div>${escapeHtml(String(item))}</div>`)
                    .join('')
                : '<div>بدون فلاتر</div>'
            }
          </div>

          ${
            printLogs.length
              ? `
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>العملية</th>
                      <th>القسم</th>
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
    `

    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
  }

  useEffect(() => {
    void loadLogs(1, {
      limit: SYSTEM_PAGE_SIZE,
      offset: 0,
    })
  }, [])

  return (
    <div
      style={{
        display: 'grid',
        gap: '12px',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        gridTemplateRows: 'auto minmax(0, 1fr)',
      }}
    >
      <style>
        {`
          .activity-body-scroll {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }

          .activity-body-scroll::-webkit-scrollbar {
            width: 0;
            height: 0;
            display: none;
          }
        `}
      </style>

      {pageMessage && (
        <div
          style={{
            position: 'fixed',
            top: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000001,
            padding: '12px 18px',
            borderRadius: '14px',
            background:
              pageMessage.type === 'error'
                ? 'rgba(239,68,68,0.95)'
                : 'rgba(16,185,129,0.95)',
            color: '#fff',
            fontWeight: 800,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        >
          {pageMessage.text}
        </div>
      )}
      <div
        className="glass-card"
        style={{
          padding: '14px',
          borderRadius: '16px',
          display: 'grid',
          gap: '12px',
          minHeight: 0,

          position: 'relative',
          zIndex: 50,
          overflow: 'visible',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '14px',
            flexWrap: 'wrap',
            alignItems: 'center',
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
              fontWeight: 900,
            }}
          >
            عدد النتائج: {total}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
            alignItems: 'end',
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

          <MultiSelectFilter
            label="نوع العملية"
            allLabel="كل العمليات"
            options={ACTIVITY_ACTION_OPTIONS}
            selected={actions}
            onChange={setActions}
            controlStyle={{
              ...inputStyle,
              minHeight: '42px',
            }}
          />

          <MultiSelectFilter
            label="القسم"
            allLabel="كل الأقسام"
            options={ACTIVITY_ENTITY_OPTIONS}
            selected={entities}
            onChange={setEntities}
            controlStyle={{
              ...inputStyle,
              minHeight: '42px',
            }}
          />

          <Field label="بحث">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في التفاصيل أو المستخدم"
              style={inputStyle}
            />
          </Field>

          <button
            type="button"
            onClick={() => {
              setPage(1)
              void loadLogs(1)
            }}
            style={primaryButtonStyle}
          >
            {loading ? 'جاري التحميل...' : 'تطبيق الفلتر'}
          </button>

          <button
            type="button"
            onClick={clearFilters}
            style={secondaryButtonStyle}
          >
            مسح الفلتر
          </button>

          <button
            type="button"
            onClick={() => void printActivityReport()}
            style={{
              ...primaryButtonStyle,
              background: 'rgba(16,185,129,0.14)',
              border: '1px solid rgba(16,185,129,0.32)',
              color: '#6ee7b7',
            }}
          >
            طباعة السجل
          </button>
        </div>
      </div>

      <div
        className="glass-card"
        style={{
          padding: '14px',
          borderRadius: '16px',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',

          position: 'relative',
          zIndex: 1,
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr)',
          gap: '10px',
        }}
      >
        <PaginationBar
          page={page}
          totalItems={total}
          loading={loading}
          onPageChange={(nextPage) => {
            void loadLogs(nextPage)
          }}
        />

        <div
          className="activity-body-scroll"
          style={{
            overflow: 'auto',
            minHeight: 0,
            height: '100%',
            maxWidth: '100%',
          }}
        >
          <table
            style={{
              width: '100%',
              minWidth: '1000px',
              borderCollapse: 'collapse',
              direction: 'rtl',
            }}
          >
            <thead>
              <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                <th style={thStyle}>#</th>
                <th style={thStyle}>العملية</th>
                <th style={thStyle}>القسم</th>
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
                  const detailsText = formatDetails(item.details)
                  const isExpanded = Boolean(expandedDetails[item.id])
                  const canExpand = detailsText.length > 90

                  return (
                    <tr
                      key={item.id}
                      style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                    >
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
                            wordBreak: 'break-word',
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
                              padding: 0,
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
                  )
                })}

              {!loading && logs.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      ...tdStyle,
                      padding: '30px',
                      textAlign: 'center',
                      color: '#94a3b8',
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
    </div>
  )
}

function formatLogUser(item: ActivityLog) {
  if (item.user_name || item.username) {
    return item.user_name || item.username
  }

  return 'غير محدد'
}

function escapeHtml(value: unknown) {
  return String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'grid', gap: '8px' }}>
      <span style={{ color: '#cbd5e1', fontWeight: 800 }}>{label}</span>
      {children}
    </label>
  )
}

function formatDate(value?: string) {
  if (!value) return '—'

  try {
    const raw = String(value)
    const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`

    return new Date(normalized).toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return value
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
    action.includes('withdraw')

  const isSuccess =
    action.includes('created') ||
    action.includes('approved') ||
    action.includes('activated') ||
    action.includes('deposit') ||
    action.includes('in') ||
    action.includes('backup')

  if (isDanger) {
    return {
      ...badgeStyle,
      background: 'rgba(239,68,68,0.16)',
      color: '#fca5a5',
    }
  }

  if (isSuccess) {
    return {
      ...badgeStyle,
      background: 'rgba(16,185,129,0.16)',
      color: '#6ee7b7',
    }
  }

  return badgeStyle
}

const inputStyle: React.CSSProperties = {
  height: '38px',
  borderRadius: '12px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  outline: 'none',
  padding: '0 12px',
  textAlign: 'right',
  direction: 'rtl',
  boxSizing: 'border-box',
  minWidth: '180px',
}

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  height: '44px',
  borderRadius: '12px',
  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 18px',
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  height: '44px',
  borderRadius: '12px',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 18px',
  cursor: 'pointer',
}

const thStyle: React.CSSProperties = {
  padding: '12px',
  fontWeight: 900,
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '12px',
  color: '#e5e7eb',
  whiteSpace: 'nowrap',
}

const badgeStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: '999px',
  background: 'rgba(59,130,246,0.16)',
  color: '#93c5fd',
  fontWeight: 900,
  whiteSpace: 'nowrap',
}
