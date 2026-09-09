import {
  DEFAULT_RECEIPT_PRINT_SETTINGS,
  ENGINEER_FOOTER,
  buildReceiptQrDataUrl,
  escapeHtml,
  formatReceiptDate,
  loadReceiptPrintSettings,
  loadReceiptStoreInfo,
  money,
  openReceiptPrintWindow,
  type ReceiptPrintSettings,
  type StoreReceiptInfo,
} from './receiptPrint'

import { getPaymentMethodLabel } from './payment-method'

export function buildSaleExchangeReceiptHtml(
  exchange: any,
  storeInfo: StoreReceiptInfo = {},
  qrDataUrl = '',
  printSettings: ReceiptPrintSettings = DEFAULT_RECEIPT_PRINT_SETTINGS,
) {
  const code = exchange.code || `EXC-${String(exchange.id).padStart(5, '0')}`

  const storeName = String(storeInfo.app_name || 'ERP Store').trim()

  const storePhone = String(storeInfo.store_phone || '').trim()

  const storeAddress = String(storeInfo.store_address || '').trim()

  const logo = String(storeInfo.app_logo_url || '').trim()

  const rows = (Array.isArray(exchange.items) ? exchange.items : [])
    .map((item: any) => {
      const oldDetails = [item.old_size, item.old_color]
        .filter(Boolean)
        .join(' / ')

      const newDetails = [item.new_size, item.new_color]
        .filter(Boolean)
        .join(' / ')

      return `
            <tr>
              <td>
                <strong>
                  ${escapeHtml(item.old_product_name || '—')}
                </strong>

                ${oldDetails ? `<small>${escapeHtml(oldDetails)}</small>` : ''}

                <div>
                  ${money(item.old_unit_price)}
                  ج.م
                </div>
              </td>

              <td class="arrow">
                ←
              </td>

              <td>
                <strong>
                  ${escapeHtml(item.new_product_name || '—')}
                </strong>

                ${newDetails ? `<small>${escapeHtml(newDetails)}</small>` : ''}

                <div>
                  ${money(item.new_unit_price)}
                  ج.م
                </div>
              </td>
            </tr>
          `
    })
    .join('')

  const difference = Number(exchange.difference_amount || 0)

  const statusText = exchange.cancelled_at ? 'ملغي' : 'فعال'

  return `
    <!doctype html>

    <html lang="ar" dir="rtl">

      <head>

        <meta charset="UTF-8" />

        <title>
          ${escapeHtml(code)}
        </title>

        <style>
          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 10px;
            background: #fff;
            color: #111;
            font-family:
              Arial,
              Tahoma,
              sans-serif;
            font-size:
              ${printSettings.receipt_font_size_px}px;
          }

          .receipt {
            width: 280px;
            margin: 0 auto;
          }

          .store {
            text-align: center;
            border-bottom:
              1px dashed #777;
            padding-bottom: 8px;
          }

          .logo {
            width: 46px;
            height: 46px;
            object-fit: cover;
            border-radius: 50%;
            display: block;
            margin: 0 auto 5px;
          }

          .store-name {
            font-size: 18px;
            font-weight: 900;
          }

          .contact {
            margin-top: 4px;
            font-size: 9px;
          }

          .title {
            text-align: center;
            padding: 10px 0;
            border-bottom:
              1px dashed #777;
          }

          .title strong {
            display: block;
            font-size: 17px;
          }

          .code {
            margin-top: 4px;
            font-weight: 900;
          }

          .meta {
            display: grid;
            gap: 4px;
            margin: 8px 0;
            font-size: 10px;
          }

          .meta-row,
          .summary-row {
            display: flex;
            justify-content:
              space-between;
            gap: 8px;
          }

          table {
            width: 100%;
            border-collapse:
              collapse;
            margin: 10px 0;
          }

          th,
          td {
            border-bottom:
              1px dotted #aaa;
            padding: 6px 3px;
            vertical-align: top;
            font-size: 9.5px;
          }

          th {
            font-weight: 900;
          }

          td small {
            display: block;
            color: #666;
            margin-top: 2px;
          }

          .arrow {
            width: 24px;
            text-align: center;
            vertical-align: middle;
            font-size: 16px;
            font-weight: 900;
          }

          .summary {
            border:
              1px solid #999;
            border-radius: 7px;
            padding: 8px;
            display: grid;
            gap: 6px;
          }

          .difference {
            font-size: 13px;
            font-weight: 900;
            border-top:
              1px dashed #999;
            padding-top: 6px;
          }

          .cancelled {
            margin-top: 8px;
            padding: 7px;
            border:
              1px solid #b91c1c;
            border-radius: 6px;
            color: #991b1b;
            font-weight: 900;
            text-align: center;
          }

          .reason {
            margin-top: 8px;
            font-size: 9px;
          }

          .qr {
            width: 80px;
            height: 80px;
            display: block;
            margin: 10px auto 4px;
          }

          .footer {
            margin-top: 10px;
            padding-top: 6px;
            border-top:
              1px dashed #aaa;
            text-align: center;
            font-size: 8px;
          }
        </style>

      </head>

      <body>

        <div class="receipt">

          <div class="store">

            ${
              logo
                ? `
                  <img
                    class="logo"
                    src="${escapeHtml(logo)}"
                    alt=""
                  />
                `
                : ''
            }

            <div class="store-name">
              ${escapeHtml(storeName)}
            </div>

            ${
              storePhone || storeAddress
                ? `
                  <div class="contact">
                    ${escapeHtml(
                      [storePhone, storeAddress].filter(Boolean).join(' — '),
                    )}
                  </div>
                `
                : ''
            }

          </div>

          <div class="title">
            <strong>
              إيصال استبدال
            </strong>

            <div class="code">
              ${escapeHtml(code)}
            </div>
          </div>

          <div class="meta">

            <div class="meta-row">
              <span>
                الفاتورة الأصلية
              </span>

              <strong>
                #${escapeHtml(exchange.original_sale_id)}
              </strong>
            </div>

            <div class="meta-row">
              <span>التاريخ</span>

              <strong>
                ${escapeHtml(
                  formatReceiptDate(
                    exchange.created_at,
                    exchange.business_date,
                  ),
                )}
              </strong>
            </div>

            <div class="meta-row">
              <span>العميل</span>

              <strong>
                ${escapeHtml(exchange.customer_name || 'عميل نقدي')}
              </strong>
            </div>

            <div class="meta-row">
              <span>الكاشير</span>

              <strong>
                ${escapeHtml(exchange.cashier_name || '—')}
              </strong>
            </div>

            <div class="meta-row">
              <span>الحالة</span>

              <strong>
                ${escapeHtml(statusText)}
              </strong>
            </div>

          </div>

          <table>
            <thead>
              <tr>
                <th>القديم</th>
                <th></th>
                <th>الجديد</th>
              </tr>
            </thead>

            <tbody>
              ${rows}
            </tbody>
          </table>

          <div class="summary">

            <div class="summary-row">
              <span>
                قيمة العرض قبل
              </span>

              <strong>
                ${money(exchange.old_group_total)}
                ج.م
              </strong>
            </div>

            <div class="summary-row">
              <span>
                قيمة العرض بعد
              </span>

              <strong>
                ${money(exchange.new_group_total)}
                ج.م
              </strong>
            </div>

            <div class="summary-row difference">
              <span>
                فرق الاستبدال
              </span>

              <strong>
                ${difference > 0 ? '+' : ''}${money(difference)}
                ج.م
              </strong>
            </div>

            ${
              Number(exchange.cash_collection_amount || 0) > 0
                ? `
                  <div class="summary-row">
                    <span>
                      تحصيل كاش
                    </span>
                    <strong>
                      ${money(exchange.cash_collection_amount)}
                      ج.م
                    </strong>
                  </div>
                `
                : ''
            }

            ${
              Number(exchange.cash_refund_amount || 0) > 0
                ? `
                  <div class="summary-row">
                    <span>
                      رد كاش
                    </span>
                    <strong>
                      ${money(exchange.cash_refund_amount)}
                      ج.م
                    </strong>
                  </div>
                `
                : ''
            }

            ${
              Number(exchange.debt_reduction_amount || 0) > 0
                ? `
                  <div class="summary-row">
                    <span>
                      خفض مديونية
                    </span>
                    <strong>
                      ${money(exchange.debt_reduction_amount)}
                      ج.م
                    </strong>
                  </div>
                `
                : ''
            }

            ${
              Number(exchange.loyalty_earned_points_adjustment || 0) !== 0
                ? `
                  <div class="summary-row">
                    <span>
                      تعديل نقاط مكتسبة
                    </span>
                    <strong>
                      ${escapeHtml(exchange.loyalty_earned_points_adjustment)}
                    </strong>
                  </div>
                `
                : ''
            }

            ${
              Number(exchange.loyalty_redeemed_points_adjustment || 0) !== 0
                ? `
                  <div class="summary-row">
                    <span>
                      تعديل نقاط مستخدمة
                    </span>
                    <strong>
                      ${escapeHtml(exchange.loyalty_redeemed_points_adjustment)}
                    </strong>
                  </div>
                `
                : ''
            }

            <div class="summary-row">
              <span>
                حساب التسوية
              </span>

              <strong>
                ${escapeHtml(getPaymentMethodLabel(exchange.payment_method))}
              </strong>
            </div>

          </div>

          ${
            exchange.reason
              ? `
                <div class="reason">
                  سبب الاستبدال:
                  ${escapeHtml(exchange.reason)}
                </div>
              `
              : ''
          }

          ${
            exchange.cancelled_at
              ? `
                <div class="cancelled">
                  ملغي

                  ${
                    exchange.cancel_reason
                      ? `<div>
                          ${escapeHtml(exchange.cancel_reason)}
                        </div>`
                      : ''
                  }
                </div>
              `
              : ''
          }

          ${
            qrDataUrl
              ? `
                <img
                  class="qr"
                  src="${qrDataUrl}"
                  alt="QR"
                />
              `
              : ''
          }

          <div class="footer">
            ${escapeHtml(ENGINEER_FOOTER)}
          </div>

        </div>

      </body>

    </html>
  `
}

export async function printSaleExchangeReceiptHtml(options: {
  exchange: any

  onBlocked?: () => void

  onError?: (message: string) => void
}) {
  const storeInfo = await loadReceiptStoreInfo()

  const printSettings = await loadReceiptPrintSettings()

  const qrDataUrl = await buildReceiptQrDataUrl(storeInfo)

  const html = buildSaleExchangeReceiptHtml(
    options.exchange,

    storeInfo,

    qrDataUrl,

    printSettings,
  )

  if (printSettings.receipt_silent_print) {
    try {
      const result = await window.api.printHtmlSilent({
        html,
      })

      if (!result?.ok) {
        options.onError?.(result?.message || 'فشل طباعة إيصال الاستبدال')

        return false
      }

      return true
    } catch (error) {
      options.onError?.(
        error instanceof Error ? error.message : 'فشل طباعة إيصال الاستبدال',
      )

      return false
    }
  }

  const opened = openReceiptPrintWindow(html)

  if (!opened) {
    options.onBlocked?.()
  }

  return opened
}
