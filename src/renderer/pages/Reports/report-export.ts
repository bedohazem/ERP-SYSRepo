import { getPaymentMethodLabel } from '../../utils/payment-method'

export type ReportsExportData = {
  summary: Record<string, number>

  cashAccounts: Array<{
    payment_method: string
    label: string
    total_in: number
    total_out: number
    balance: number
  }>

  cashAccountsTotalBalance: number

  topProducts: any[]
  dailySales: any[]
  paymentMethods: any[]
  cashierSales: any[]
  lowStock: any[]
  topCustomers: any[]
}

type ExportSection = {
  title: string
  columns: string[]
  rows: Array<Array<string | number>>
}

function numberValue(value: unknown) {
  return Number(value || 0).toFixed(2)
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function buildSections(data: ReportsExportData): ExportSection[] {
  const summary = data.summary || {}

  return [
    {
      title: 'الملخص المالي',

      columns: ['المؤشر', 'القيمة'],

      rows: [
        [
          'إجمالي أرصدة الحسابات المالية',
          numberValue(data.cashAccountsTotalBalance),
        ],

        ['إجمالي المبيعات', numberValue(summary.gross_sales)],

        ['صافي المبيعات', numberValue(summary.net_sales)],

        ['إجمالي المرتجعات', numberValue(summary.total_returns)],

        [
          'الربح قبل الخصومات',
          numberValue(summary.gross_profit_before_discounts),
        ],

        ['الربح بعد الخصومات', numberValue(summary.net_profit_after_discounts)],

        ['صافي الربح النهائي', numberValue(summary.final_net_profit)],

        ['المصروفات', numberValue(summary.total_expenses)],

        ['مدفوعات الالتزامات', numberValue(summary.total_liability_payments)],

        ['إجمالي فواتير الشراء', numberValue(summary.total_purchase_invoices)],

        ['إجمالي الخصومات', numberValue(summary.total_discounts)],

        ['خصومات النقاط', numberValue(summary.loyalty_discounts)],

        ['خصومات عادية', numberValue(summary.normal_discounts)],

        ['خصومات العروض', numberValue(summary.promotion_discounts)],

        ['عدد فواتير البيع', Number(summary.sales_count || 0)],

        ['عدد المرتجعات', Number(summary.returns_count || 0)],

        ['عدد الاستبدالات', Number(summary.exchange_count || 0)],

        ['صافي فروق الاستبدال', numberValue(summary.exchange_adjustment)],

        ['الإيداعات اليدوية', numberValue(summary.total_manual_deposits)],

        ['السحب اليدوي', numberValue(summary.total_manual_withdrawals)],
      ],
    },

    {
      title: 'أرصدة الحسابات المالية',

      columns: ['الحساب', 'إجمالي الداخل', 'إجمالي الخارج', 'الرصيد'],

      rows: data.cashAccounts.map((row) => [
        row.label || getPaymentMethodLabel(row.payment_method),

        numberValue(row.total_in),

        numberValue(row.total_out),

        numberValue(row.balance),
      ]),
    },

    {
      title: 'مبيعات الكاشير',

      columns: [
        'الكاشير',
        'عدد الفواتير',
        'مبيعات الفواتير',
        'عدد المرتجعات',
        'إجمالي المرتجعات',
        'عدد الاستبدالات',
        'فروق الاستبدال',
        'صافي المبيعات',
      ],

      rows: data.cashierSales.map((row) => [
        row.cashier_name,

        Number(row.sales_count || 0),

        numberValue(row.sales_total),

        Number(row.returns_count || 0),

        numberValue(row.returns_total),

        Number(row.exchange_count || 0),

        numberValue(row.exchange_adjustment),

        numberValue(row.net_sales),
      ]),
    },

    {
      title: 'المنتجات حسب المبيعات',

      columns: ['المنتج', 'المقاس', 'اللون', 'صافي الكمية', 'صافي الإجمالي'],

      rows: data.topProducts.map((row) => [
        row.product_name,

        row.size || '—',

        row.color || '—',

        Number(row.net_quantity || 0),

        numberValue(row.net_total),
      ]),
    },

    {
      title: 'صافي التحصيل الفعلي حسب طريقة الدفع',

      columns: ['طريقة الدفع', 'عدد الحركات', 'صافي التحصيل'],

      rows: data.paymentMethods.map((row) => [
        getPaymentMethodLabel(row.payment_method),

        Number(row.count || 0),

        numberValue(row.total),
      ]),
    },

    {
      title: 'المخزون المنخفض والنافد',

      columns: [
        'المنتج',
        'الباركود',
        'المقاس',
        'اللون',
        'المخزون',
        'الحد الأدنى',
      ],

      rows: data.lowStock.map((row) => [
        row.product_name,

        row.barcode || '—',

        row.size || '—',

        row.color || '—',

        Number(row.stock || 0),

        Number(row.min_stock || 0),
      ]),
    },

    {
      title: 'العملاء حسب إجمالي الشراء',

      columns: ['العميل', 'الهاتف', 'عدد الفواتير', 'إجمالي الشراء'],

      rows: data.topCustomers.map((row) => [
        row.name,

        row.phone || '—',

        Number(row.sales_count || 0),

        numberValue(row.total_spent),
      ]),
    },

    {
      title: 'المبيعات اليومية',

      columns: ['اليوم', 'صافي المبيعات'],

      rows: [...data.dailySales]
        .sort((a, b) => String(a.day).localeCompare(String(b.day)))
        .map((row) => [row.day, numberValue(row.total)]),
    },
  ]
}

export function buildReportsCsv(
  data: ReportsExportData,

  periodLabel: string,
) {
  const sections = buildSections(data)

  const lines: string[] = [
    csvCell('تقرير ERP'),

    csvCell(`الفترة: ${periodLabel}`),

    '',
  ]

  for (const section of sections) {
    lines.push(csvCell(section.title))

    lines.push(section.columns.map(csvCell).join(','))

    for (const row of section.rows) {
      lines.push(row.map(csvCell).join(','))
    }

    lines.push('')
  }

  return lines.join('\r\n')
}

export function buildReportsPdfHtml(
  data: ReportsExportData,

  periodLabel: string,
) {
  const sections = buildSections(data)

  const sectionsHtml = sections
    .map((section) => {
      const rows = section.rows.length
        ? section.rows
            .map(
              (row) => `
                    <tr>
                      ${row
                        .map((cell) => `<td>${escapeHtml(cell)}</td>`)
                        .join('')}
                    </tr>
                  `,
            )
            .join('')
        : `
              <tr>
                <td
                  colspan="${section.columns.length}"
                  class="empty"
                >
                  لا توجد بيانات
                </td>
              </tr>
            `

      return `
          <section>
            <h2>
              ${escapeHtml(section.title)}
            </h2>

            <table>
              <thead>
                <tr>
                  ${section.columns
                    .map((column) => `<th>${escapeHtml(column)}</th>`)
                    .join('')}
                </tr>
              </thead>

              <tbody>
                ${rows}
              </tbody>
            </table>
          </section>
        `
    })
    .join('')

  return `
<!doctype html>
<html
  lang="ar"
  dir="rtl"
>
<head>
  <meta charset="utf-8">

  <title>
    تقرير ERP
  </title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 24px;
      direction: rtl;
      font-family:
        Arial,
        Tahoma,
        sans-serif;
      color: #111827;
      background: #ffffff;
      font-size: 11px;
    }

    header {
      margin-bottom: 22px;
      border-bottom:
        2px solid #111827;
      padding-bottom: 12px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 24px;
    }

    .period {
      font-size: 13px;
      font-weight: 700;
    }

    section {
      margin-bottom: 24px;
      page-break-inside:
        avoid;
    }

    h2 {
      margin: 0 0 9px;
      font-size: 15px;
      color: #1d4ed8;
    }

    table {
      width: 100%;
      border-collapse:
        collapse;
    }

    th,
    td {
      border:
        1px solid #d1d5db;
      padding: 7px;
      text-align: right;
      vertical-align: top;
    }

    th {
      background: #f3f4f6;
      font-weight: 800;
    }

    tr:nth-child(even) td {
      background: #fafafa;
    }

    .empty {
      text-align: center;
      color: #6b7280;
      padding: 15px;
    }

    @page {
      size: A4 landscape;
      margin: 10mm;
    }
  </style>
</head>

<body>
  <header>
    <h1>
      تقرير ERP
    </h1>

    <div class="period">
      الفترة:
      ${escapeHtml(periodLabel)}
    </div>
  </header>

  ${sectionsHtml}
</body>
</html>
  `.trim()
}
