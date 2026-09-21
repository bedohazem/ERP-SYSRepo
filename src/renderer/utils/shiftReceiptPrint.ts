import {
  DEFAULT_RECEIPT_PRINT_SETTINGS,
  ENGINEER_FOOTER,
  escapeHtml,
  formatReceiptDate,
  loadReceiptPrintSettings,
  loadReceiptStoreInfo,
  money,
  openReceiptPrintWindow,
  type ReceiptPrintSettings,
  type StoreReceiptInfo,
} from './receiptPrint'

export type ShiftCloseReceiptData = {
  shift_id: number

  cashier_name: string

  opened_at: string

  closed_at?: string | null

  closing_counted_amount: number

  left_for_next_shift: number
}

export type ShiftReceiptPrintResult = {
  ok: boolean
  message?: string
}

export function buildShiftCloseReceiptHtml(
  data: ShiftCloseReceiptData,
  storeInfo: StoreReceiptInfo = {},
  printSettings: ReceiptPrintSettings = DEFAULT_RECEIPT_PRINT_SETTINGS,
) {
  const storeName = String(storeInfo.app_name || 'ERP Store').trim()

  const storeLogoUrl = String(storeInfo.app_logo_url || '').trim()

  const storePhone = String(storeInfo.store_phone || '').trim()

  const storeAddress = String(storeInfo.store_address || '').trim()

  const closingAmount = Math.max(0, Number(data.closing_counted_amount || 0))

  const leftAmount = Math.max(0, Number(data.left_for_next_shift || 0))

  const safeTransferAmount = Math.max(0, closingAmount - leftAmount)

  const closedAt = data.closed_at || new Date().toISOString()

  return `
    <!doctype html>

    <html lang="ar" dir="rtl">

    <head>
      <meta charset="UTF-8" />

      <title>
        إيصال إغلاق شفت #${escapeHtml(data.shift_id)}
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

        .header {
          padding:
            5px 0 7px;

          border-bottom:
            1px solid #222;
        }

        .store-main-row {
          display: flex;
          align-items: center;

          justify-content:
            flex-start;

          gap: 10px;

          direction: ltr;
        }

        .logo {
          width: 48px;
          height: 48px;

          object-fit: cover;

          border-radius:
            50%;

          flex-shrink: 0;
        }

        .store-name {
          font-size: 19px;

          line-height: 1;

          font-weight: 900;

          white-space:
            nowrap;
        }

        .contact-row {
          display: flex;

          justify-content:
            space-between;

          gap: 8px;

          margin-top: 5px;

          font-size: 9px;

          font-weight: 700;
        }

        .title-row {
          display: grid;

          grid-template-columns:
            54px 1fr 105px;

          align-items: center;

          gap: 6px;

          padding: 8px 0;

          direction: ltr;

          border-bottom:
            1px dashed #999;
        }

        .shift-number {
          border:
            1px solid #222;

          border-radius:
            7px;

          padding:
            5px 6px;

          font-size:
            10px;

          font-weight:
            900;

          text-align:
            center;
        }

        .title {
          text-align:
            center;

          direction:
            rtl;

          font-size:
            16px;

          font-weight:
            900;

          white-space:
            nowrap;
        }

        .date {
          text-align:
            left;

          direction:
            ltr;

          font-size:
            9px;

          font-weight:
            700;
        }

        .cashier-box {
          padding:
            9px 0;

          border-bottom:
            1px dashed #999;

          display: grid;

          gap: 5px;
        }

        .row {
          display: flex;

          justify-content:
            space-between;

          align-items:
            center;

          gap: 10px;
        }

        .label {
          color:
            #555;

          font-size:
            10px;
        }

        .value {
          font-weight:
            900;

          text-align:
            left;
        }

        .amount-box {
          margin-top:
            10px;

          padding:
            10px;

          border:
            1px solid #999;

          border-radius:
            8px;

          display: grid;

          gap: 8px;
        }

        .amount-row {
          display: flex;

          justify-content:
            space-between;

          align-items:
            center;

          gap: 8px;
        }

        .amount-row strong {
          direction: ltr;
        }

        .main-amount {
          padding-bottom:
            8px;

          border-bottom:
            1px dashed #999;

          font-size:
            12px;
        }

        .review-note {
          margin-top:
            10px;

          padding:
            7px;

          border:
            1px dashed #777;

          border-radius:
            7px;

          text-align:
            center;

          font-size:
            9px;

          font-weight:
            800;
        }

        .signatures {
          display: grid;

          grid-template-columns:
            1fr 1fr;

          gap: 14px;

          margin-top:
            18px;

          font-size:
            9px;

          text-align:
            center;
        }

        .signature-line {
          padding-top:
            18px;

          border-top:
            1px solid #777;
        }

        .footer {
          margin-top:
            12px;

          padding-top:
            5px;

          border-top:
            1px dashed #bbb;

          text-align:
            center;

          font-size:
            8px;

          color:
            #555;
        }

        @media print {
          body {
            margin: 0;

            padding:
              ${printSettings.receipt_padding_top_px}px
              ${printSettings.receipt_padding_right_px}px
              ${printSettings.receipt_padding_bottom_px}px
              ${printSettings.receipt_padding_left_px}px;

            background:
              #fff;
          }

          .receipt {
            width:
              ${printSettings.receipt_width_px}px;

            margin:
              0 auto;
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
                <div class="contact-row">

                  <span>
                    ${escapeHtml(storePhone)}
                  </span>

                  <span>
                    ${escapeHtml(storeAddress)}
                  </span>

                </div>
              `
              : ''
          }

        </div>

        <div class="title-row">

          <div class="shift-number">
            #${escapeHtml(data.shift_id)}
          </div>

          <div class="title">
            إيصال إغلاق شفت
          </div>

          <div class="date">
            ${escapeHtml(formatReceiptDate(closedAt))}
          </div>

        </div>

        <div class="cashier-box">

          <div class="row">

            <span class="label">
              الكاشير
            </span>

            <strong class="value">
              ${escapeHtml(data.cashier_name || '—')}
            </strong>

          </div>

          <div class="row">

            <span class="label">
              فتح الشفت
            </span>

            <strong class="value">
              ${escapeHtml(formatReceiptDate(data.opened_at))}
            </strong>

          </div>

          <div class="row">

            <span class="label">
              إغلاق الشفت
            </span>

            <strong class="value">
              ${escapeHtml(formatReceiptDate(closedAt))}
            </strong>

          </div>

        </div>

        <div class="amount-box">

          <div class="amount-row main-amount">

            <span>
              المبلغ الفعلي بعد العد
            </span>

            <strong>
              ${money(closingAmount)}
              ج.م
            </strong>

          </div>

          <div class="amount-row">

            <span>
              المتروك للشفت التالي
            </span>

            <strong>
              ${money(leftAmount)}
              ج.م
            </strong>

          </div>

          <div class="amount-row">

            <span>
              المسلم للخزنة الآمنة
            </span>

            <strong>
              ${money(safeTransferAmount)}
              ج.م
            </strong>

          </div>

        </div>

        <div class="review-note">
          تم إغلاق الشفت وإرسال نتيجة الجرد للمراجعة
        </div>

        <div class="signatures">

          <div class="signature-line">
            توقيع الكاشير
          </div>

          <div class="signature-line">
            توقيع المستلم
          </div>

        </div>

        <div class="footer">
          ${escapeHtml(ENGINEER_FOOTER)}
        </div>

      </div>

    </body>

    </html>
  `
}

export async function printShiftCloseReceipt(
  data: ShiftCloseReceiptData,
): Promise<ShiftReceiptPrintResult> {
  const storeInfo = await loadReceiptStoreInfo()

  const printSettings = await loadReceiptPrintSettings()

  const html = buildShiftCloseReceiptHtml(data, storeInfo, printSettings)

  if (printSettings.receipt_silent_print) {
    try {
      const result = await window.api.printHtmlSilent({
        html,
      })

      if (!result?.ok) {
        return {
          ok: false,

          message: result?.message || 'تعذر طباعة إيصال الشفت',
        }
      }

      return {
        ok: true,
      }
    } catch (error) {
      return {
        ok: false,

        message:
          error instanceof Error ? error.message : 'تعذر طباعة إيصال الشفت',
      }
    }
  }

  const opened = await openReceiptPrintWindow(html)

  if (!opened) {
    return {
      ok: false,

      message: 'تعذر فتح نافذة الطباعة',
    }
  }

  return {
    ok: true,
  }
}
