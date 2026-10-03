import { useEffect, useState } from 'react'

import PaginationBar, { SYSTEM_PAGE_SIZE } from '../../components/PaginationBar'

type ShiftUserOption = {
  id: number

  name: string

  role: string
}

type CashDrawerEvent = {
  id: number

  status: 'success' | 'failed'

  shift_id: number

  shift_opened_by: number | null

  shift_opened_by_name: string | null

  user_id: number | null

  user_name: string | null

  username: string | null

  reason: string

  printer_name: string

  error: string | null

  created_at: string
}

type Props = {
  users: ShiftUserOption[]
}

type StatusFilter = 'all' | 'success' | 'failed'

export default function CashDrawerHistorySection({ users }: Props) {
  const [rows, setRows] = useState<CashDrawerEvent[]>([])

  const [page, setPage] = useState(1)

  const [total, setTotal] = useState(0)

  const [successCount, setSuccessCount] = useState(0)

  const [failedCount, setFailedCount] = useState(0)

  const [shiftId, setShiftId] = useState('')

  const [userId, setUserId] = useState('')

  const [status, setStatus] = useState<StatusFilter>('all')

  const [dateFrom, setDateFrom] = useState('')

  const [dateTo, setDateTo] = useState('')

  const [loading, setLoading] = useState(false)

  async function loadData(targetPage = page) {
    const safePage = Math.max(1, Number(targetPage || 1))

    setLoading(true)

    try {
      const result = await window.api.getCashDrawerNoSaleEvents({
        shift_id: shiftId ? Number(shiftId) : undefined,

        user_id: userId ? Number(userId) : undefined,

        status,

        date_from: dateFrom || undefined,

        date_to: dateTo || undefined,

        limit: SYSTEM_PAGE_SIZE,

        offset: (safePage - 1) * SYSTEM_PAGE_SIZE,
      })

      setRows(Array.isArray(result?.rows) ? result.rows : [])

      setTotal(Number(result?.total || 0))

      setSuccessCount(Number(result?.success_count || 0))

      setFailedCount(Number(result?.failed_count || 0))

      setPage(safePage)
    } catch (error) {
      console.error('Failed to load cash drawer report:', error)

      setRows([])

      setTotal(0)

      setSuccessCount(0)

      setFailedCount(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData(1)
  }, [])

  return (
    <section
      className="glass-card"
      style={{
        padding: '16px',

        borderRadius: '20px',

        display: 'grid',

        gap: '14px',

        direction: 'rtl',
      }}
    >
      <div>
        <h3
          style={{
            margin: '0 0 6px',
          }}
        >
          فتحات درج الكاشير بدون بيع
        </h3>

        <div
          style={{
            color: '#94a3b8',

            fontSize: '13px',

            fontWeight: 700,
          }}
        >
          تقرير الفتحات اليدوية المرتبطة بالشفت مع المستخدم والسبب والنتيجة
        </div>
      </div>

      <div
        style={{
          display: 'grid',

          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',

          gap: '10px',
        }}
      >
        <Metric title="إجمالي النتائج" value={total} />

        <Metric title="تم الفتح" value={successCount} />

        <Metric title="فشل الفتح" value={failedCount} />
      </div>

      <div
        style={{
          display: 'flex',

          gap: '8px',

          flexWrap: 'wrap',

          alignItems: 'end',
        }}
      >
        <Field label="رقم الشفت">
          <input
            type="number"
            min="1"
            value={shiftId}
            onChange={(event) => setShiftId(event.target.value)}
            placeholder="كل الشفتات"
            style={inputStyle}
          />
        </Field>

        <Field label="المستخدم">
          <select
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            style={inputStyle}
          >
            <option value="">كل المستخدمين</option>

            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="النتيجة">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            style={inputStyle}
          >
            <option value="all">الكل</option>

            <option value="success">تم الفتح</option>

            <option value="failed">فشل الفتح</option>
          </select>
        </Field>

        <Field label="من">
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field label="إلى">
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            style={inputStyle}
          />
        </Field>

        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setPage(1)

            void loadData(1)
          }}
          style={{
            ...buttonStyle,

            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'جاري التحميل...' : 'تطبيق'}
        </button>
      </div>

      <PaginationBar
        page={page}
        totalItems={total}
        loading={loading}
        onPageChange={(nextPage) => {
          void loadData(nextPage)
        }}
      />

      <div
        style={{
          overflow: 'auto',

          border: '1px solid rgba(255,255,255,0.08)',

          borderRadius: '14px',
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
            <tr>
              <th style={thStyle}>الشفت</th>

              <th style={thStyle}>صاحب الشفت</th>

              <th style={thStyle}>فتح بواسطة</th>

              <th style={thStyle}>السبب</th>

              <th style={thStyle}>النتيجة</th>

              <th style={thStyle}>الوقت</th>

              <th style={thStyle}>الطابعة</th>

              <th style={thStyle}>الخطأ</th>
            </tr>
          </thead>

          <tbody>
            {!loading &&
              rows.map((row) => (
                <tr
                  key={row.id}
                  style={{
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <td style={tdStyle}>#{row.shift_id}</td>

                  <td style={tdStyle}>{row.shift_opened_by_name || '—'}</td>

                  <td style={tdStyle}>
                    {row.user_name || row.username || '—'}
                  </td>

                  <td style={tdStyle}>{getReasonLabel(row.reason)}</td>

                  <td style={tdStyle}>
                    <strong
                      style={{
                        color: row.status === 'success' ? '#34d399' : '#f87171',
                      }}
                    >
                      {row.status === 'success' ? 'تم الفتح' : 'فشل الفتح'}
                    </strong>
                  </td>

                  <td style={tdStyle}>{formatDate(row.created_at)}</td>

                  <td style={tdStyle}>{row.printer_name || '—'}</td>

                  <td
                    style={{
                      ...tdStyle,

                      whiteSpace: 'normal',

                      maxWidth: '260px',
                    }}
                  >
                    {row.error || '—'}
                  </td>
                </tr>
              ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    ...tdStyle,

                    padding: '30px',

                    textAlign: 'center',

                    color: '#94a3b8',
                  }}
                >
                  لا توجد فتحات درج بدون بيع بهذه الفلاتر
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Metric({
  title,
  value,
}: {
  title: string

  value: number
}) {
  return (
    <div
      style={{
        padding: '13px',

        borderRadius: '14px',

        background: 'rgba(255,255,255,0.04)',

        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        style={{
          color: '#94a3b8',

          fontSize: '12px',

          fontWeight: 800,
        }}
      >
        {title}
      </div>

      <div
        style={{
          marginTop: '5px',

          fontSize: '22px',

          fontWeight: 900,
        }}
      >
        {value}
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string

  children: React.ReactNode
}) {
  return (
    <label
      style={{
        display: 'grid',

        gap: '5px',

        fontSize: '12px',

        fontWeight: 800,
      }}
    >
      <span>{label}</span>

      {children}
    </label>
  )
}

function getReasonLabel(reason: string) {
  if (reason === 'manual') {
    return 'فتح يدوي'
  }

  if (reason === 'test') {
    return 'اختبار'
  }

  return reason || '—'
}

function formatDate(value?: string | null) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('ar-EG')
}

const inputStyle: React.CSSProperties = {
  height: '40px',

  minWidth: '145px',

  borderRadius: '10px',

  border: '1px solid rgba(255,255,255,0.12)',

  background: 'rgba(15,23,42,0.72)',

  color: '#fff',

  padding: '0 10px',
}

const buttonStyle: React.CSSProperties = {
  minHeight: '40px',

  padding: '0 16px',

  border: 0,

  borderRadius: '10px',

  cursor: 'pointer',

  fontWeight: 900,
}

const thStyle: React.CSSProperties = {
  padding: '11px',

  textAlign: 'right',

  whiteSpace: 'nowrap',

  color: '#cbd5e1',

  fontSize: '12px',
}

const tdStyle: React.CSSProperties = {
  padding: '11px',

  textAlign: 'right',

  whiteSpace: 'nowrap',

  fontSize: '12px',
}
