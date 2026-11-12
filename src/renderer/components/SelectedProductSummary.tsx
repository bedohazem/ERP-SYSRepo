import { formatMoney } from '../../shared/money';

type Props = {
  name: string;
  category?: string | null;
  size?: string | null;
  color?: string | null;
  price?: number;
  originalPrice?: number;
  showPrice?: boolean;
  variant?: 'selected' | 'dropdown';
  onChangeProduct?: () => void;
};

export default function SelectedProductSummary({
  name,
  category,
  size,
  color,
  price,
  originalPrice,
  showPrice = true,
  variant = 'selected',
  onChangeProduct,
}: Props) {
  const isDropdown = variant === 'dropdown';

  const clean = (value?: string | null) => {
    const text = String(value ?? '').trim();
    return ['-', '—', 'بدون تصنيف'].includes(text) ? '' : text;
  };

  const hasDiscount =
    price !== undefined &&
    originalPrice !== undefined &&
    Number(originalPrice) > Number(price);

  const details = [
    {
      label: 'التصنيف',
      value: clean(category),
      color: '#93c5fd',
    },
    {
      label: 'المقاس',
      value: clean(size),
      color: '#d8b4fe',
    },
    {
      label: 'اللون',
      value: clean(color),
      color: '#86efac',
    },
    ...(!isDropdown && hasDiscount
      ? [
          {
            label: 'قبل الخصم',
            value: formatMoney(originalPrice),
            color: '#fcd34d',
          },
        ]
      : []),
  ].filter((detail) => detail.value !== '');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '100%',
        minWidth: 0,
        minHeight: isDropdown ? '52px' : '46px',
        padding: isDropdown ? '5px 2px' : '7px 10px',
        borderRadius: '10px',
        background: isDropdown ? 'transparent' : 'rgba(255,255,255,0.04)',
        border: isDropdown ? 'none' : '1px solid rgba(148,163,184,0.18)',
        direction: 'rtl',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          display: isDropdown ? 'grid' : 'flex',
          alignItems: isDropdown ? 'stretch' : 'center',
          gap: isDropdown ? '7px' : '10px',
        }}
      >
        <strong
          title={name}
          style={{
            flex: isDropdown ? undefined : '1 1 140px',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'right',
            color: '#f8fafc',
            fontWeight: 900,
            fontSize: '14px',
          }}
        >
          <bdi dir="auto">{name}</bdi>
        </strong>

        {details.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              minWidth: 0,
              maxWidth: isDropdown ? '100%' : '62%',
              overflowX: 'auto',
              scrollbarWidth: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {details.map((detail) => (
              <span
                key={detail.label}
                title={`${detail.label}: ${detail.value}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  flexShrink: 0,
                  padding: isDropdown ? '3px 7px' : '5px 9px',
                  borderRadius: '7px',
                  background: 'rgba(148,163,184,0.09)',
                  border: '1px solid rgba(148,163,184,0.14)',
                  color: detail.color,
                  fontSize: '13px',
                  fontWeight: 800,
                }}
              >
                {detail.label}:<bdi dir="auto">{detail.value}</bdi>
              </span>
            ))}
          </div>
        )}
      </div>

      {showPrice && price !== undefined && (
        <div
          style={{
            display: 'grid',
            justifyItems: 'end',
            alignContent: 'center',
            gap: '3px',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {isDropdown && hasDiscount && (
            <span
              style={{
                color: '#94a3b8',
                fontSize: '12px',
                fontWeight: 700,
                textDecoration: 'line-through',
                textDecorationColor: '#f87171',
              }}
            >
              <bdi dir="ltr">{formatMoney(originalPrice)}</bdi> ج
            </span>
          )}

          <strong
            style={{
              color: '#86efac',
              fontSize: '15px',
              fontWeight: 900,
            }}
          >
            <bdi dir="ltr">{formatMoney(price)}</bdi> ج
          </strong>
        </div>
      )}

      {onChangeProduct && (
        <button
          type="button"
          onClick={onChangeProduct}
          style={{
            flexShrink: 0,
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid rgba(96,165,250,0.35)',
            background: 'rgba(96,165,250,0.10)',
            color: '#93c5fd',
            fontSize: '12px',
            fontWeight: 800,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          تغيير الصنف
        </button>
      )}
    </div>
  );
}
