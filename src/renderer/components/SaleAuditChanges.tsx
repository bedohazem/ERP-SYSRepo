import { formatMoney } from '../../shared/money';
import { getPaymentMethodLabel } from '../utils/payment-method';

type AuditItem = {
  variant_id?: number | null;
  product_name?: string | null;
  barcode?: string | null;
  size?: string | null;
  color?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  line_total?: number | null;
};

type AuditPayment = {
  payment_method?: string | null;
  amount?: number | null;
};

type AuditSnapshot = {
  sale?: Record<string, any> | null;
  items?: AuditItem[] | null;
  payments?: AuditPayment[] | null;
};

type ComparisonRow = {
  label: string;
  before: string;
  after: string;
};

type GroupedItem = {
  key: string;
  name: string;
  barcode: string;
  size: string;
  color: string;
  quantity: number;
  priceTotal: number;
  lineTotal: number;
};

function numeric(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function different(a: number, b: number): boolean {
  return Math.abs(a - b) > 0.000001;
}

function groupItems(items: AuditItem[]): Map<string, GroupedItem> {
  const result = new Map<string, GroupedItem>();

  for (const item of items) {
    const variantId = numeric(item.variant_id);

    // لا نعتمد على sale_item.id لأنه يتغير عند تعديل الفاتورة.
    const key =
      variantId > 0
        ? `variant:${variantId}`
        : item.barcode
          ? `barcode:${item.barcode}`
          : `legacy:${item.product_name || ''}:${item.size || ''}:${item.color || ''}`;

    const quantity = numeric(item.quantity);
    const price = numeric(item.unit_price);

    const existing = result.get(key);

    if (existing) {
      existing.quantity += quantity;
      existing.priceTotal += price * quantity;
      existing.lineTotal += numeric(item.line_total ?? price * quantity);
      continue;
    }

    result.set(key, {
      key,
      name: String(item.product_name || 'صنف غير معروف'),
      barcode: String(item.barcode || ''),
      size: String(item.size || ''),
      color: String(item.color || ''),
      quantity,
      priceTotal: price * quantity,
      lineTotal: numeric(item.line_total ?? price * quantity),
    });
  }

  return result;
}

function unitPrice(item?: GroupedItem): number {
  if (!item || item.quantity <= 0) return 0;
  return item.priceTotal / item.quantity;
}

export type SaleAuditItemChange = {
  key: string;
  status: 'added' | 'removed' | 'changed';
  title: string;
  barcode: string;
  description: string;
  beforeQuantity: number | null;
  afterQuantity: number | null;
  beforePrice: number | null;
  afterPrice: number | null;
  beforeTotal: number | null;
  afterTotal: number | null;
};

export function getSaleAuditItemChanges(
  beforeItems: AuditItem[] = [],
  afterItems: AuditItem[] = [],
): SaleAuditItemChange[] {
  const before = groupItems(Array.isArray(beforeItems) ? beforeItems : []);
  const after = groupItems(Array.isArray(afterItems) ? afterItems : []);

  const keys = new Set([...before.keys(), ...after.keys()]);
  const changes: SaleAuditItemChange[] = [];

  for (const key of keys) {
    const oldItem = before.get(key);
    const newItem = after.get(key);

    if (!oldItem && !newItem) continue;

    const oldPrice = unitPrice(oldItem);
    const newPrice = unitPrice(newItem);

    const quantityChanged =
      numeric(oldItem?.quantity) !== numeric(newItem?.quantity);

    const priceChanged = different(oldPrice, newPrice);

    const totalChanged = different(
      numeric(oldItem?.lineTotal),
      numeric(newItem?.lineTotal),
    );

    const nameChanged =
      Boolean(oldItem && newItem) && oldItem!.name !== newItem!.name;

    if (
      oldItem &&
      newItem &&
      !quantityChanged &&
      !priceChanged &&
      !totalChanged &&
      !nameChanged
    ) {
      continue;
    }

    const item = newItem || oldItem!;

    const status: SaleAuditItemChange['status'] = !oldItem
      ? 'added'
      : !newItem
        ? 'removed'
        : 'changed';

    const descriptions: string[] = [];

    if (status === 'added') {
      descriptions.push('صنف تمت إضافته');
    } else if (status === 'removed') {
      descriptions.push('صنف تم حذفه');
    } else {
      if (nameChanged) descriptions.push('تغيير اسم الصنف');
      if (quantityChanged) descriptions.push('تغيير الكمية');
      if (priceChanged) descriptions.push('تغيير سعر البيع');
      if (totalChanged && !priceChanged && !quantityChanged) {
        descriptions.push('تغيير إجمالي السطر');
      }
    }

    changes.push({
      key,
      status,
      title: [item.name, item.size, item.color].filter(Boolean).join(' — '),
      barcode: item.barcode,
      description: descriptions.join(' • ') || 'تعديل الصنف',
      beforeQuantity: oldItem ? oldItem.quantity : null,
      afterQuantity: newItem ? newItem.quantity : null,
      beforePrice: oldItem ? oldPrice : null,
      afterPrice: newItem ? newPrice : null,
      beforeTotal: oldItem ? oldItem.lineTotal : null,
      afterTotal: newItem ? newItem.lineTotal : null,
    });
  }

  return changes;
}

function groupPayments(payments: AuditPayment[]) {
  const result = new Map<string, number>();

  for (const payment of payments) {
    const method = String(payment.payment_method || 'cash');

    result.set(method, numeric(result.get(method)) + numeric(payment.amount));
  }

  return result;
}

function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  const cellStyle: React.CSSProperties = {
    padding: '11px 12px',
    textAlign: 'right',
    verticalAlign: 'middle',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    lineHeight: 1.65,
    borderBottom: '1px solid rgba(148,163,184,0.12)',
  };

  return (
    <div style={{ width: '100%', minWidth: 0, overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
          direction: 'rtl',
          fontSize: '13px',
        }}
      >
        <colgroup>
          <col style={{ width: '36%' }} />
          <col style={{ width: '32%' }} />
          <col style={{ width: '32%' }} />
        </colgroup>

        <thead>
          <tr style={{ background: 'rgba(148,163,184,0.09)' }}>
            {['البيان', 'قبل التعديل', 'بعد التعديل'].map((heading) => (
              <th
                key={heading}
                scope="col"
                style={{
                  ...cellStyle,
                  color: '#cbd5e1',
                  fontWeight: 900,
                }}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const changed = row.before !== row.after;

            return (
              <tr key={row.label}>
                <td
                  style={{
                    ...cellStyle,
                    color: '#cbd5e1',
                    fontWeight: 800,
                  }}
                >
                  {row.label}
                </td>

                <td style={{ ...cellStyle, color: '#e2e8f0' }}>{row.before}</td>

                <td
                  style={{
                    ...cellStyle,
                    color: changed ? '#86efac' : '#e2e8f0',
                    fontWeight: changed ? 900 : 500,
                  }}
                >
                  {row.after}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function SaleAuditChanges({
  before,
  after,
}: {
  before: AuditSnapshot;
  after: AuditSnapshot;
}) {
  const beforeSale = before?.sale || {};
  const afterSale = after?.sale || {};

  const amount = (sale: Record<string, any>, key: string) =>
    formatMoney(numeric(sale[key]));

  const saleRows: ComparisonRow[] = [
    {
      label: 'العميل',
      before: String(beforeSale.customer_name || 'بدون عميل'),
      after: String(afterSale.customer_name || 'بدون عميل'),
    },
    {
      label: 'إجمالي الأصناف',
      before: amount(beforeSale, 'sub_total'),
      after: amount(afterSale, 'sub_total'),
    },
    {
      label: 'الخصم العادي',
      before: amount(beforeSale, 'discount_value'),
      after: amount(afterSale, 'discount_value'),
    },
    {
      label: 'خصم المنتجات',
      before: amount(beforeSale, 'product_discount_value'),
      after: amount(afterSale, 'product_discount_value'),
    },
    {
      label: 'خصم العروض',
      before: amount(beforeSale, 'promotion_discount_value'),
      after: amount(afterSale, 'promotion_discount_value'),
    },
    {
      label: 'خصم النقاط',
      before: amount(beforeSale, 'loyalty_discount_value'),
      after: amount(afterSale, 'loyalty_discount_value'),
    },
    {
      label: 'الإجمالي النهائي',
      before: amount(beforeSale, 'grand_total'),
      after: amount(afterSale, 'grand_total'),
    },
    {
      label: 'المدفوع',
      before: amount(beforeSale, 'paid'),
      after: amount(afterSale, 'paid'),
    },
    {
      label: 'المتبقي',
      before: amount(beforeSale, 'remaining_amount'),
      after: amount(afterSale, 'remaining_amount'),
    },
    {
      label: 'طريقة الدفع',
      before: getPaymentMethodLabel(
        String(beforeSale.payment_method || 'cash'),
      ),
      after: getPaymentMethodLabel(String(afterSale.payment_method || 'cash')),
    },
  ];

  const itemChanges = getSaleAuditItemChanges(
    before?.items || [],
    after?.items || [],
  );

  const beforePayments = groupPayments(before?.payments || []);
  const afterPayments = groupPayments(after?.payments || []);

  const paymentKeys = new Set([
    ...beforePayments.keys(),
    ...afterPayments.keys(),
  ]);

  const paymentRows: ComparisonRow[] = [...paymentKeys].map((method) => ({
    label: getPaymentMethodLabel(method),
    before: beforePayments.has(method)
      ? formatMoney(beforePayments.get(method))
      : '—',
    after: afterPayments.has(method)
      ? formatMoney(afterPayments.get(method))
      : '—',
  }));

  const sectionTitle: React.CSSProperties = {
    color: '#f8fafc',
    fontWeight: 900,
    fontSize: '14px',
    margin: 0,
  };

  return (
    <div
      style={{
        display: 'grid',
        gap: '18px',
        minWidth: 0,
        width: '100%',
      }}
    >
      <section style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
        <h4 style={sectionTitle}>ملخص الفاتورة قبل وبعد التعديل</h4>
        <ComparisonTable rows={saleRows} />
      </section>

      <section style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
        <h4 style={sectionTitle}>
          تفاصيل تغييرات الأصناف ({itemChanges.length})
        </h4>

        {itemChanges.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: '12px' }}>
            لم تتغير الأصناف أو الكميات أو أسعار البيع.
          </div>
        ) : (
          itemChanges.map((item) => (
            <div
              key={item.key}
              style={{
                display: 'grid',
                gap: '10px',
                padding: '12px',
                minWidth: 0,
                borderRadius: '12px',
                border: '1px solid rgba(148,163,184,0.19)',
                background: 'rgba(255,255,255,0.025)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '10px',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  minWidth: 0,
                }}
              >
                <strong
                  style={{
                    color: '#e2e8f0',
                    overflowWrap: 'anywhere',
                    minWidth: 0,
                  }}
                >
                  {item.title}
                </strong>

                <span
                  style={{
                    color:
                      item.status === 'added'
                        ? '#86efac'
                        : item.status === 'removed'
                          ? '#fca5a5'
                          : '#fcd34d',
                    fontSize: '12px',
                    fontWeight: 800,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {item.description}
                </span>
              </div>

              {item.barcode && (
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>
                  باركود: {item.barcode}
                </div>
              )}

              <ComparisonTable
                rows={[
                  {
                    label: 'الكمية',
                    before:
                      item.beforeQuantity === null
                        ? '—'
                        : String(item.beforeQuantity),
                    after:
                      item.afterQuantity === null
                        ? '—'
                        : String(item.afterQuantity),
                  },
                  {
                    label: 'سعر بيع القطعة',
                    before:
                      item.beforePrice === null
                        ? '—'
                        : formatMoney(item.beforePrice),
                    after:
                      item.afterPrice === null
                        ? '—'
                        : formatMoney(item.afterPrice),
                  },
                  {
                    label: 'إجمالي السطر',
                    before:
                      item.beforeTotal === null
                        ? '—'
                        : formatMoney(item.beforeTotal),
                    after:
                      item.afterTotal === null
                        ? '—'
                        : formatMoney(item.afterTotal),
                  },
                ]}
              />
            </div>
          ))
        )}
      </section>

      <section style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
        <h4 style={sectionTitle}>تفاصيل المدفوعات</h4>

        {paymentRows.length > 0 ? (
          <ComparisonTable rows={paymentRows} />
        ) : (
          <div style={{ color: '#94a3b8', fontSize: '12px' }}>
            لا توجد مدفوعات مسجلة في النسختين.
          </div>
        )}
      </section>
    </div>
  );
}
