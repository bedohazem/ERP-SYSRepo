import type { CSSProperties } from 'react';
import { formatMoney } from '../../../shared/money';
import type { DailyProductRow } from './daily-products-model';

const thStyle: CSSProperties = {
  padding: '12px',
  fontWeight: 900,
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  background: '#1e293b',
  zIndex: 1,
};

const tdStyle: CSSProperties = {
  padding: '12px',
  color: '#e5e7eb',
  whiteSpace: 'nowrap',
  borderTop: '1px solid rgba(255,255,255,0.07)',
};

export function DailyProductsTable({
  rows,
  empty,
}: {
  rows: readonly DailyProductRow[];
  empty: boolean;
}) {
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'separate',
        borderSpacing: 0,
        direction: 'rtl',
      }}
    >
      <thead
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#1e293b',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.35)',
        }}
      >
        <tr style={{ textAlign: 'center' }}>
          {[
            'المنتج',
            'الباركود',
            'المقاس',
            'اللون',
            'البيع',
            'مباع',
            'مرتجع',
            'استبدال',
            'إلغاءات',
            'الصافي',
          ].map((title) => (
            <th key={title} style={thStyle}>
              {title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((item, index) => (
          <tr
            key={`${item.variant_id}-${item.product_name}-${index}`}
            style={{
              borderTop: '1px solid rgba(255,255,255,0.07)',
              textAlign: 'center',
            }}
          >
            <td style={tdStyle}>{item.product_name}</td>
            <td style={tdStyle}>{item.barcode || '—'}</td>
            <td style={tdStyle}>{item.size || '—'}</td>
            <td style={tdStyle}>{item.color || '—'}</td>
            <td style={tdStyle}>
              {item.sell_price === null ? '—' : formatMoney(item.sell_price)}
            </td>
            <td style={tdStyle}>{item.sold_quantity}</td>
            <td style={tdStyle}>{item.returned_quantity}</td>
            <td style={tdStyle}>{item.exchange_quantity}</td>
            <td style={tdStyle}>{item.cancellation_quantity}</td>
            <td
              style={{
                ...tdStyle,
                fontWeight: 900,
                color: item.net_quantity < 0 ? '#fca5a5' : '#86efac',
              }}
            >
              {item.net_quantity}
            </td>
          </tr>
        ))}
        {empty && rows.length === 0 && (
          <tr>
            <td
              colSpan={10}
              style={{
                padding: '30px',
                textAlign: 'center',
                color: '#94a3b8',
              }}
            >
              لا توجد حركات منتجات مطابقة
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
