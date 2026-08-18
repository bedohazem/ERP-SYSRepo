import type { CSSProperties } from 'react'

export const SYSTEM_PAGE_SIZE = 50

type PaginationBarProps = {
  page: number
  totalItems: number
  pageSize?: number
  loading?: boolean
  onPageChange: (page: number) => void
}

export default function PaginationBar({
  page,
  totalItems,
  pageSize = SYSTEM_PAGE_SIZE,
  loading = false,
  onPageChange,
}: PaginationBarProps) {
  if (totalItems <= 0) {
    return null
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  const safePage = Math.min(Math.max(Number(page || 1), 1), totalPages)

  const startItem = (safePage - 1) * pageSize + 1
  const endItem = Math.min(safePage * pageSize, totalItems)

  const buttonStyle = (disabled: boolean): CSSProperties => ({
    height: '34px',
    borderRadius: '8px',
    border: '1px solid rgba(124,58,237,0.55)',
    background: 'rgba(124,58,237,0.10)',
    color: '#c4b5fd',
    padding: '0 12px',
    fontWeight: 800,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  })

  return (
    <div
      style={{
        display: 'grid',
        justifyItems: 'center',
        gap: '8px',
        direction: 'rtl',
        marginBottom: '12px',
        paddingBottom: '12px',
        borderBottom: '1px solid rgba(255,255,255,0.10)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          disabled={loading || safePage <= 1}
          onClick={() => onPageChange(1)}
          style={buttonStyle(loading || safePage <= 1)}
        >
          الأولى
        </button>

        <button
          type="button"
          disabled={loading || safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          style={buttonStyle(loading || safePage <= 1)}
        >
          السابق
        </button>

        <strong
          style={{
            color: '#fff',
            minWidth: '115px',
            textAlign: 'center',
            fontSize: '14px',
          }}
        >
          صفحة {safePage} من {totalPages}
        </strong>

        <button
          type="button"
          disabled={loading || safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          style={buttonStyle(loading || safePage >= totalPages)}
        >
          التالي
        </button>

        <button
          type="button"
          disabled={loading || safePage >= totalPages}
          onClick={() => onPageChange(totalPages)}
          style={buttonStyle(loading || safePage >= totalPages)}
        >
          الأخيرة
        </button>
      </div>

      <div
        style={{
          color: '#94a3b8',
          fontWeight: 800,
          fontSize: '12px',
          textAlign: 'center',
        }}
      >
        عرض {startItem} - {endItem} من {totalItems}
      </div>
    </div>
  )
}
