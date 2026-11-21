import type { CSSProperties, MouseEvent } from 'react';

export const SYSTEM_PAGE_SIZE = 50;

export function scrollPaginationToTableTop(event: MouseEvent<HTMLDivElement>) {
  const target = event.target;

  if (!(target instanceof Element)) return;

  const button = target.closest('button');

  if (!(button instanceof HTMLButtonElement) || button.disabled) {
    return;
  }

  // بعض الشاشات بتحط الـ Pagination داخل div منفصل.
  // نطلع للمستوى المناسب لحد ما نوصل للجدول السابق.
  let current: HTMLElement | null = event.currentTarget;
  let content: HTMLElement | null = null;

  for (let depth = 0; current && depth < 5; depth += 1) {
    const previous = current.previousElementSibling;

    if (previous instanceof HTMLElement) {
      content = previous;
      break;
    }

    current = current.parentElement;
  }

  if (!content) return;

  window.requestAnimationFrame(() => {
    if (!content.isConnected) return;

    const scrollables = [
      content,
      ...content.querySelectorAll<HTMLElement>(
        '[style*="overflow"], .table-scroll, .list-scroll, .invoice-list-scroll',
      ),
    ];

    for (const element of scrollables) {
      if (element.scrollHeight > element.clientHeight + 1) {
        element.scrollTop = 0;
      }
    }

    content.scrollIntoView({
      behavior: 'auto',
      block: 'start',
      inline: 'nearest',
    });
  });
}

type PaginationBarProps = {
  page: number;
  totalItems: number;
  pageSize?: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
};

export default function PaginationBar({
  page,
  totalItems,
  pageSize = SYSTEM_PAGE_SIZE,
  loading = false,
  onPageChange,
}: PaginationBarProps) {
  if (totalItems <= 0) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const safePage = Math.min(Math.max(Number(page || 1), 1), totalPages);

  const startItem = (safePage - 1) * pageSize + 1;
  const endItem = Math.min(safePage * pageSize, totalItems);

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
  });

  return (
    <div
      onClickCapture={scrollPaginationToTableTop}
      style={{
        display: 'grid',
        justifyItems: 'center',
        gap: '8px',
        direction: 'rtl',
        marginTop: '12px',
        paddingTop: '12px',
        borderTop: '1px solid rgba(255,255,255,0.10)',
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
  );
}
