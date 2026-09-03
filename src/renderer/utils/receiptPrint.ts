import QRCode from 'qrcode'
import { getPaymentMethodLabel } from './payment-method'

export type SaleReceiptData = {
  sale: any
  items: any[]
  loyalty?: any[]
}

export type StoreReceiptInfo = {
  app_name?: string
  app_logo_url?: string
  store_phone?: string
  store_address?: string
  store_qr_enabled?: boolean
  store_qr_title?: string
  store_qr_primary_url?: string
}

export type ReceiptPrintSettings = {
  receipt_silent_print: boolean
  receipt_paper_size: '80mm' | '58mm' | 'custom'
  receipt_width_px: number
  receipt_padding_top_px: number
  receipt_padding_right_px: number
  receipt_padding_bottom_px: number
  receipt_padding_left_px: number
  receipt_font_size_px: number
}

export const DEFAULT_RECEIPT_PRINT_SETTINGS: ReceiptPrintSettings = {
  receipt_silent_print: false,
  receipt_paper_size: '80mm',
  receipt_width_px: 245,
  receipt_padding_top_px: 10,
  receipt_padding_right_px: 4,
  receipt_padding_bottom_px: 10,
  receipt_padding_left_px: 18,
  receipt_font_size_px: 12,
}

export const ENGINEER_FOOTER =
  'برمجة وتصميم: بشمهندس عبدالرحمن حازم   01155559287-01068377869'

export function money(value: number | string | null | undefined): string {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function getPaymentStatusLabel(status?: string | null) {
  if (status === 'paid') return 'مدفوعة'
  if (status === 'partial') return 'مدفوعة جزئيًا'
  if (status === 'unpaid') return 'غير مدفوعة'
  if (status === 'cancelled') return 'ملغاة'
  return status || '—'
}

export function formatReceiptDate(
  value?: string | null,
  businessDate?: string | null,
): string {
  if (!value) return '—'

  try {
    const raw = String(value)
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z'
    const date = new Date(normalized)

    let datePart = date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })

    if (businessDate && /^\d{4}-\d{2}-\d{2}$/.test(String(businessDate))) {
      const [year, month, day] = String(businessDate).split('-')
      datePart = `${day}/${month}/${year}`
    }

    const timePart = date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    return `${datePart}  ${timePart}`
  } catch {
    return value
  }
}

export async function loadReceiptStoreInfo(): Promise<StoreReceiptInfo> {
  try {
    const status = await window.api.getLicenseStatus()

    return {
      app_name: status.app_name,
      app_logo_url: status.app_logo_url,
      store_phone: status.store_phone,
      store_address: status.store_address,
      store_qr_enabled: status.store_qr_enabled,
      store_qr_title: status.store_qr_title,
      store_qr_primary_url: status.store_qr_primary_url,
    }
  } catch (error) {
    console.error('Failed to load store receipt info:', error)
    return {}
  }
}

export async function loadReceiptPrintSettings(): Promise<ReceiptPrintSettings> {
  try {
    return await window.api.getReceiptPrintSettings()
  } catch (error) {
    console.error('Failed to load receipt print settings:', error)
    return DEFAULT_RECEIPT_PRINT_SETTINGS
  }
}

export async function buildReceiptQrDataUrl(
  storeInfo: StoreReceiptInfo,
): Promise<string> {
  try {
    if (storeInfo.store_qr_enabled && storeInfo.store_qr_primary_url?.trim()) {
      return await QRCode.toDataURL(storeInfo.store_qr_primary_url.trim(), {
        width: 120,
        margin: 1,
        errorCorrectionLevel: 'M',
      })
    }
  } catch (error) {
    console.error('Failed to generate receipt QR:', error)
  }

  return ''
}

export function openReceiptPrintWindow(html: string): boolean {
  const printWindow = window.open('', '_blank', 'width=420,height=700')

  if (!printWindow) {
    return false
  }

  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()

  setTimeout(() => {
    printWindow.print()
    printWindow.close()
  }, 350)

  return true
}

function getReceiptFinance(
  receipt: SaleReceiptData,
  returnHistory: any[] = [],
) {
  const remainingAmount = Math.max(
    0,
    Number(receipt.sale.remaining_amount || 0),
  )

  const grandTotal = Number(receipt.sale.grand_total || 0)

  const paidNetAmount = Math.max(0, grandTotal - remainingAmount)
  const activeReturnHistory = returnHistory.filter(
    (item: any) => !item?.cancelled_at,
  )
  const totalReturns = activeReturnHistory.reduce((sum, item: any) => {
    return sum + Number(item.refund_amount || item.total_return_amount || 0)
  }, 0)

  const netPaidAmount = Math.max(0, paidNetAmount - totalReturns)
  const netTotal = Math.max(0, grandTotal - totalReturns)

  return {
    remainingAmount,
    grandTotal,
    paidNetAmount,
    totalReturns,
    netPaidAmount,
    netTotal,
  }
}

export function buildSaleReceiptHtml(
  receipt: SaleReceiptData,
  returnHistory: any[] = [],
  storeInfo: StoreReceiptInfo = {},
  qrDataUrl = '',
  printSettings: ReceiptPrintSettings = DEFAULT_RECEIPT_PRINT_SETTINGS,
) {
  const sale = receipt.sale
  const finance = getReceiptFinance(receipt, returnHistory)

  const {
    remainingAmount,
    grandTotal,
    paidNetAmount,
    totalReturns,
    netPaidAmount,
    netTotal,
  } = finance

  const storeName = String(storeInfo.app_name || 'ERP Store').trim()

  const storeLogoUrl = String(storeInfo.app_logo_url || '').trim()

  const storePhone = String(storeInfo.store_phone || '').trim()

  const storeAddress = String(storeInfo.store_address || '').trim()

  const itemRows = receipt.items
    .map((item: any) => {
      const originalQty = Number(item.quantity || 0)
      const returnedQty = Number(item.returned_quantity || 0)
      const netQty = Math.max(0, originalQty - returnedQty)
      const unitPrice = Number(item.unit_price || 0)
      const netLineTotal = netQty * unitPrice

      const details = [
        item.size ? String(item.size) : '',
        item.color ? String(item.color) : '',
      ]
        .filter(Boolean)
        .join(' / ')

      return `
      <tr class="${returnedQty > 0 ? 'has-return' : ''}">
        <td class="product-cell">
          <strong>${escapeHtml(item.product_name)}</strong>

          ${
            details
              ? `<div class="product-details">${escapeHtml(details)}</div>`
              : ''
          }

          ${
            returnedQty > 0
              ? `<div class="return-note">مرتجع ${returnedQty} من ${originalQty}</div>`
              : ''
          }
        </td>

        <td>${netQty}</td>
        <td>${unitPrice.toFixed(2)}</td>
        <td class="line-total">${netLineTotal.toFixed(2)}</td>
      </tr>
    `
    })
    .join('')

  return `
    <!doctype html>

    <html lang="ar" dir="rtl">

      <head>

        <meta charset="UTF-8" />

        <title>
          فاتورة #${escapeHtml(sale.id)}
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
            font-family: Arial, Tahoma, sans-serif;
            font-size: ${printSettings.receipt_font_size_px}px;
          }

          .receipt {
            width: 280px;
            margin: 0 auto;
          }

          .header {
            padding: 5px 0 7px;
            border-bottom: 1px solid #222;
          }

          /* اللوجو + اسم المحل */
          .store-main-row {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 10px;
            direction: ltr;
          }

          .logo {
            width: 48px;
            height: 48px;
            object-fit: cover;
            border-radius: 50%;
            flex-shrink: 0;
            display: block;
          }

          .store-name {
            font-size: 19px;
            line-height: 1;
            font-weight: 900;
            color: #111;
            white-space: nowrap;
          }

          /* التليفون + العنوان */
          .store-contact-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-top: 5px;
            direction: ltr;
            font-size: 9.5px;
            color: #222;
          }

          .store-contact-item {
            display: flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
            font-weight: 700;
          }

          .store-contact-item.phone {
            direction: ltr;
          }

          .store-contact-item.address {
            direction: rtl;
          }

          .contact-svg {
            width: 13px;
            height: 13px;
            flex-shrink: 0;
            fill: #111;
          }

          /* رقم الفاتورة + العنوان + التاريخ */
          .invoice-title-row {
            display: grid;
            grid-template-columns: 58px 1fr 125px;
            align-items: center;
            gap: 7px;
            padding: 7px 0;
            direction: ltr;
            border-bottom: 1px dashed #999;
          }

          .invoice-number {
            justify-self: start;
            min-width: 42px;
            padding: 5px 7px;
            border: 1.2px solid #222;
            border-radius: 7px;
            text-align: center;
            direction: ltr;
            font-size: 10px;
            font-weight: 700;
            line-height: 1;
          }

          .invoice-title {
            justify-self: center;
            direction: rtl;
            text-align: center;
            white-space: nowrap;
            font-size: 17px;
            font-weight: 900;
            line-height: 1;
          }

          .invoice-date {
            justify-self: end;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 4px;
            direction: ltr;
            white-space: nowrap;
            color: #222;
            font-size: 10px;
            font-weight: 700;
          }

          .date-svg {
            width: 15px;
            height: 15px;
            flex-shrink: 0;
            fill: none;
            stroke: #111;
            stroke-width: 1.8;
          }


          .sale-info {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            align-items: stretch;
            width: 100%;
            padding: 7px 0;
            direction: rtl;
            border-bottom: 1px dashed #999;
          }

          .sale-info-item {
            text-align: center;
            padding: 2px 6px;
            min-width: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }

          .sale-info-item:not(:last-child) {
            border-left: 1px dashed #aaa;
          }

          .sale-info-item span {
            display: block;
            font-size: 9px;
            color: #555;
            margin-bottom: 4px;
            line-height: 1;
          }

          .sale-info-item strong {
            display: block;
            font-size: 11px;
            font-weight: 900;
            color: #111;
            line-height: 1.2;
            overflow-wrap: anywhere;
          }

          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin: 8px 0 10px;
            table-layout: fixed;
            font-size: 10.5px;
          }

          .items-table th {
            padding: 5px 3px;
            border-top: 1px solid #555;
            border-bottom: 1px solid #555;
            font-size: 9.5px;
            font-weight: 900;
            text-align: center;
          }

          .items-table td {
            padding: 6px 3px;
            border-bottom: 1px dotted #bbb;
            text-align: center;
            vertical-align: middle;
          }

          .items-table th:first-child,
          .items-table td:first-child {
            width: 45%;
            text-align: right;
          }

          .items-table th:nth-child(2),
          .items-table td:nth-child(2) {
            width: 10%;
          }

          .items-table th:nth-child(3),
          .items-table td:nth-child(3) {
            width: 20%;
          }

          .items-table th:nth-child(4),
          .items-table td:nth-child(4) {
            width: 25%;
          }

          .product-cell strong {
            display: block;
            font-size: 11px;
          }

          .product-details {
            color: #666;
            font-size: 9px;
            margin-top: 2px;
          }

          .line-total {
            font-weight: 900;
          }

          .has-return {
            background: #fff8ee;
          }

          .return-note {
            color: #b45309;
            font-size: 8.5px;
            font-weight: 800;
            margin-top: 2px;
          }


          .return-note {
            margin-top: 6px;
            padding: 5px;
            border-radius: 5px;
            background: #ffedd5;
            color: #9a3412;
            text-align: center;
            font-weight: 800;
            font-size: 10px;
          }

          .summary-box {
            border: 1px solid #999;
            border-radius: 8px;
            padding: 9px;
            margin-top: 10px;
          }

          .summary-row {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            margin: 5px 0;
          }

          .discount {
            color: #b91c1c;
          }

          .final-total {
            margin-top: 7px;
            padding-top: 8px;
            border-top: 1px dashed #777;
            font-size: 12px;
            font-weight: 800;
            color: #172554;
          }

          .paid {
            font-size: 12px;
            font-weight: 800;
          }

          .remaining-zero {
            color: #15803d;
            font-weight: 900;
          }

          .remaining-debt {
            color: #c2410c;
            font-weight: 900;
          }

          .receipt-bottom {
            display: grid;
            grid-template-columns: 90px 1fr;
            align-items: center;
            gap: 10px;
            margin-top: 6px;
            padding-top: 5px;
            direction: ltr;
          }

          .qr-side {
            text-align: center;
          }

          .qr-side img {
            width: 68px;
            height: 68px;
            display: block;
            margin: 0 auto;
          }

          .qr-title {
            margin-top: 2px;
            font-size: 7.5px;
            line-height: 1.2;
            font-weight: 700;
            white-space: nowrap;
            direction: rtl;
          }

          .thanks-side {
            direction: rtl;
            text-align: right;
            font-size: 13px;
            font-weight: 900;
            padding-right: 6px;
          }
            
          .engineer-footer {
            margin-top: 4px;
            padding-top: 4px;
            border-top: 1px dashed #bbb;
            text-align: center;
            font-size: 12px;
            color: #555;
            line-height: 1.5;
          }

          @media print {
            body {
              margin: 0;
              padding: ${printSettings.receipt_padding_top_px}px ${printSettings.receipt_padding_right_px}px ${printSettings.receipt_padding_bottom_px}px ${printSettings.receipt_padding_left_px}px;
              background: #fff;
            }

            .receipt {
              width: ${printSettings.receipt_width_px}px;
              margin: 0 auto;
            }
          }

        </style>

      </head>

      <body>

        <div class="receipt">

        <div class="header">

          <div class="store-main-row">

            ${
              storeLogoUrl
                ? `
                  <img
                    class="logo"
                    src="${escapeHtml(storeLogoUrl)}"
                    alt="Logo"
                  />
                `
                : ''
            }

            <div class="store-name">
              ${escapeHtml(storeName)}
            </div>

          </div>

          ${
            storePhone || storeAddress
              ? `
                <div class="store-contact-row">

                  ${
                    storePhone
                      ? `
                        <div class="store-contact-item phone">

                          <svg
                            class="contact-svg"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path d="M6.62 10.79a15.46 15.46 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.61 21 3 13.39 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.59a1 1 0 01-.25 1.02l-2.2 2.18z"/>
                          </svg>

                          <span>
                            ${escapeHtml(storePhone)}
                          </span>

                        </div>
                      `
                      : ''
                  }

                  ${
                    storeAddress
                      ? `
                        <div class="store-contact-item address">

                          <svg
                            class="contact-svg"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1112 6a2.5 2.5 0 010 5.5z"/>
                          </svg>

                          <span>
                            ${escapeHtml(storeAddress)}
                          </span>

                        </div>
                      `
                      : ''
                  }

                </div>
              `
              : ''
          }

        </div>
          

          <div class="invoice-title-row">

            <div class="invoice-number">
              #${escapeHtml(sale.id)}
            </div>

            <div class="invoice-title">
              فاتورة بيع
            </div>

            <div class="invoice-date">

              <svg
                class="date-svg"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="16"
                  rx="2"
                />

                <path d="M16 3v4M8 3v4M3 10h18" />

                <circle cx="17" cy="17" r="4" />

                <path d="M17 15v2.2l1.5 1" />
              </svg>

              <span>
                ${escapeHtml(
                  formatReceiptDate(sale.created_at, sale.business_date),
                )}
              </span>

            </div>

          </div>

          <div class="sale-info">

            <div class="sale-info-item">
              <span>العميل</span>
              <strong>
                ${escapeHtml(sale.customer_name || 'عميل نقدي')}
              </strong>
            </div>

            <div class="sale-info-item">
              <span>الكاشير</span>
              <strong>
                ${escapeHtml(sale.cashier_name || '—')}
              </strong>
            </div>

            <div class="sale-info-item">
              <span>طريقة الدفع</span>
              <strong>
                ${escapeHtml(getPaymentMethodLabel(sale.payment_method))}
              </strong>
            </div>

          </div>

          <table class="items-table">
            <thead>
              <tr>
                <th>الصنف</th>
                <th>ك</th>
                <th>السعر</th>
                <th>الإجمالي</th>
              </tr>
            </thead>

            <tbody>
              ${itemRows}
            </tbody>
          </table>

          <div class="summary-box">

            <div class="summary-row">
              <span>قبل الخصم</span>
              <strong>
                ${Number(sale.sub_total || 0).toFixed(2)}
              </strong>
            </div>

            ${
              Number(sale.discount_value || 0) > 0
                ? `
                  <div class="summary-row discount">
                    <span>الخصم</span>
                    <strong>
                      -${Number(sale.discount_value || 0).toFixed(2)}
                    </strong>
                  </div>
                `
                : ''
            }

            ${
              Number(sale.promotion_discount_value || 0) > 0
                ? `
                  <div class="summary-row discount">
                    <span>
                      عرض ${escapeHtml(sale.promotion_name || '')}
                    </span>

                    <strong>
                      -${Number(sale.promotion_discount_value || 0).toFixed(2)}
                    </strong>
                  </div>
                `
                : ''
            }

            ${
              Number(sale.loyalty_discount_value || 0) > 0
                ? `
                  <div class="summary-row discount">
                    <span>خصم النقاط</span>
                    <strong>
                      -${Number(sale.loyalty_discount_value || 0).toFixed(2)}
                    </strong>
                  </div>
                `
                : ''
            }

            ${
              finance.totalReturns > 0
                ? `
                  <div class="summary-row">
                    <span>
                      المرتجعات
                    </span>
                    <strong>
                      -${finance.totalReturns.toFixed(2)}
                    </strong>
                  </div>
                `
                : ''
            }

            <div class="summary-row final-total">
              <span>
                ${
                  finance.totalReturns > 0
                    ? 'الصافي النهائي'
                    : 'الإجمالي النهائي'
                }
              </span>

              <strong>
                ${finance.netTotal.toFixed(2)}
                ج.م
              </strong>
            </div>

            <div class="summary-row paid">
              <span>المدفوع</span>
              <strong>
                ${finance.netPaidAmount.toFixed(2)}
                ج.م
              </strong>
            </div>

            <div class="summary-row">
              <span>الباقي</span>

              <strong
                class="${
                  finance.remainingAmount > 0
                    ? 'remaining-debt'
                    : 'remaining-zero'
                }"
              >
                ${finance.remainingAmount.toFixed(2)}
                ج.م
              </strong>
            </div>

          </div>

          <div class="receipt-bottom">

            ${
              qrDataUrl
                ? `
                  <div class="qr-side">

                    <img
                      src="${qrDataUrl}"
                      alt="QR Code"
                    />

                    <div class="qr-title">
                      امسح الكود للتواصل معنا
                    </div>

                  </div>
                `
                : ''
            }

            <div class="thanks-side">
              شكرًا لتعاملكم معنا
            </div>

          </div>

          <div class="engineer-footer">
            ${escapeHtml(ENGINEER_FOOTER)}
          </div>

        </div>

      </body>

    </html>
  `
}

export async function printSaleReceiptHtml(options: {
  receipt: SaleReceiptData
  returnHistory?: any[]
  onBlocked?: () => void
  onError?: (message: string) => void
}) {
  const storeInfo = await loadReceiptStoreInfo()
  const printSettings = await loadReceiptPrintSettings()
  const qrDataUrl = await buildReceiptQrDataUrl(storeInfo)

  const html = buildSaleReceiptHtml(
    options.receipt,
    options.returnHistory || [],
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
        options.onError?.(result?.message || 'فشل تنفيذ الطباعة الصامتة')

        return false
      }

      return true
    } catch (error) {
      console.error('Silent receipt print failed:', error)

      options.onError?.(
        error instanceof Error ? error.message : 'فشل تنفيذ الطباعة الصامتة',
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
