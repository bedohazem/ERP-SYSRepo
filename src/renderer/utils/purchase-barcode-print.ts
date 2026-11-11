import JsBarcode from 'jsbarcode';
import { truncateForDisplay } from '../../shared/money';

type Position =
  | 'top'
  | 'top-left'
  | 'top-right'
  | 'above_barcode'
  | 'below_barcode'
  | 'bottom'
  | 'bottom-left'
  | 'bottom-right'
  | 'hidden';
type Align = 'left' | 'center' | 'right';

type PrintSettings = {
  barcode_label_width_mm: number;
  barcode_label_height_mm: number;
  barcode_content_offset_x_mm: number;
  barcode_content_offset_y_mm: number;
  barcode_svg_height: number;
  barcode_store_name_font_size: number;
  barcode_store_name_position: Position;
  barcode_store_name_align: Align;
  barcode_name_font_size: number;
  barcode_name_position: Position;
  barcode_name_align: Align;
  barcode_price_font_size: number;
  barcode_price_position: Position;
  barcode_price_align: Align;
  barcode_size_font_size: number;
  barcode_size_position: Position;
  barcode_size_align: Align;
  barcode_color_font_size: number;
  barcode_color_position: Position;
  barcode_color_align: Align;
  barcode_value_font_size: number;
  barcode_value_position: Position;
  barcode_value_align: Align;
};

export type PurchaseBarcodeSourceItem = {
  product_name?: string | null;
  barcode?: string | null;
  size?: string | null;
  color?: string | null;
  quantity: number;
  sell_price?: number | null;
  discount_price?: number | null;
};

export type PurchaseBarcodePlanItem = {
  name: string;
  barcode: string;
  size: string;
  color: string;
  quantity: number;
  price: number;
  discountPrice: number | null;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * مصدر النسخ هو كمية الشراء المحفوظة، وليس barcode_copies
 * أو المخزون الحالي الذي قد يكون اتغير بعد الشراء.
 */
export function buildPurchaseBarcodePlan(
  rows: PurchaseBarcodeSourceItem[],
): PurchaseBarcodePlanItem[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('لا توجد أصناف في فاتورة الشراء لطباعة الباركود');
  }

  const result = rows.map((row) => {
    const quantity = Number(row.quantity);
    const barcode = String(row.barcode ?? '').trim();
    const name = String(row.product_name ?? '').trim();
    const price = Number(row.sell_price ?? 0);
    const rawDiscount = row.discount_price;
    const discountPrice = rawDiscount == null ? null : Number(rawDiscount);

    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error(
        `كمية الصنف «${name || barcode}» غير صالحة لعدد ملصقات الباركود`,
      );
    }
    if (!barcode) {
      throw new Error(`الصنف «${name || 'غير معروف'}» ليس له باركود`);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`سعر البيع للصنف «${name}» غير صحيح`);
    }

    return {
      name: name || barcode,
      barcode,
      size: String(row.size ?? ''),
      color: String(row.color ?? ''),
      quantity,
      price,
      discountPrice:
        discountPrice !== null &&
        Number.isFinite(discountPrice) &&
        discountPrice > 0 &&
        discountPrice < price
          ? discountPrice
          : null,
    };
  });

  const totalLabels = result.reduce((sum, row) => sum + row.quantity, 0);
  if (totalLabels > 1500) {
    throw new Error(
      'الفاتورة تحتوي على أكثر من 1500 ملصق. قسّم عملية الطباعة إلى دفعات أصغر.',
    );
  }
  return result;
}

function buildLabelsHtml(
  plan: PurchaseBarcodePlanItem[],
  settings: PrintSettings,
  storeName: string,
): string {
  const width = Number(settings.barcode_label_width_mm || 35);
  const height = Number(settings.barcode_label_height_mm || 25);
  const svgHeight = Math.max(10, Number(settings.barcode_svg_height || 22));
  const offsetX = Number(settings.barcode_content_offset_x_mm || 0);
  const offsetY = Number(settings.barcode_content_offset_y_mm || 0);

  type ItemDef = {
    value: string;
    html?: string;
    size: number;
    position: Position;
    align: Align;
    className: string;
  };

  const alignCss = (position: Position, align: Align) =>
    position.endsWith('-left')
      ? 'left'
      : position.endsWith('-right')
        ? 'right'
        : align;

  const labels: string[] = [];
  for (const item of plan) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'barcode');
    JsBarcode(svg, item.barcode, {
      format: 'CODE128',
      displayValue: false,
      width: 1.05,
      height: svgHeight,
      margin: 0,
    });

    const priceHtml =
      item.discountPrice === null
        ? undefined
        : `<span class="old-price">${escapeHtml(truncateForDisplay(item.price))}</span>
         <span class="discount-price">بعد الخصم: ${escapeHtml(truncateForDisplay(item.discountPrice))} ج.م</span>`;

    const definitions: ItemDef[] = [
      {
        value: storeName,
        size: settings.barcode_store_name_font_size,
        position: settings.barcode_store_name_position,
        align: settings.barcode_store_name_align,
        className: 'store-name-item',
      },
      {
        value: item.name,
        size: settings.barcode_name_font_size,
        position: settings.barcode_name_position,
        align: settings.barcode_name_align,
        className: 'name-item',
      },
      {
        value: `${truncateForDisplay(item.price)} ج.م`,
        html: priceHtml,
        size: settings.barcode_price_font_size,
        position: settings.barcode_price_position,
        align: settings.barcode_price_align,
        className: 'price-item',
      },
      {
        value: `المقاس: ${item.size || '—'}`,
        size: settings.barcode_size_font_size,
        position: settings.barcode_size_position,
        align: settings.barcode_size_align,
        className: 'size-item',
      },
      {
        value: `اللون: ${item.color || '—'}`,
        size: settings.barcode_color_font_size,
        position: settings.barcode_color_position,
        align: settings.barcode_color_align,
        className: 'color-item',
      },
      {
        value: item.barcode,
        size: settings.barcode_value_font_size,
        position: settings.barcode_value_position,
        align: settings.barcode_value_align,
        className: 'barcode-value',
      },
    ];

    function renderZoneContent(position: Position): string {
      return definitions
        .filter((entry) => entry.position === position)
        .map(
          (entry) =>
            `<div class="text-item ${entry.className}" style="font-size:${Number(entry.size)}px;text-align:${alignCss(entry.position, entry.align)}">${entry.html ?? escapeHtml(entry.value)}</div>`,
        )
        .join('');
    }

    function singleZone(position: Position): string {
      const content = renderZoneContent(position);
      return content ? `<div class="zone">${content}</div>` : '';
    }

    function tripleZone(
      left: Position,
      middle: Position,
      right: Position,
    ): string {
      const parts = [left, middle, right].map(renderZoneContent);
      return parts.some(Boolean)
        ? `<div class="triple-row">${parts.map((part) => `<div class="triple-cell">${part}</div>`).join('')}</div>`
        : '';
    }

    const content = `<div class="label"><div class="label-content">
      ${tripleZone('top-left', 'top', 'top-right')}
      ${singleZone('above_barcode')}
      <div class="barcode-zone">${svg.outerHTML}</div>
      ${singleZone('below_barcode')}
      ${tripleZone('bottom-left', 'bottom', 'bottom-right')}
    </div></div>`;

    for (let copy = 0; copy < item.quantity; copy += 1) {
      labels.push(content);
    }
  }

  return `<!doctype html><html dir="ltr"><head>
    <meta charset="UTF-8"/><title>باركود فاتورة شراء</title>
    <style>
      @page { size: ${width}mm ${height}mm; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, sans-serif; }
      body { display: flex; flex-direction: column; align-items: center; }
      .label { width: ${width}mm; height: ${height}mm; box-sizing: border-box; page-break-after: always; overflow: hidden; position: relative; }
      .label:last-child { page-break-after: auto; }
      .label-content { width: 100%; height: 100%; box-sizing: border-box; padding: 1.5mm; display: grid; grid-template-rows: auto auto auto auto; gap: 0.4mm; transform: translate(${offsetX}mm, ${offsetY}mm); }
      .zone { width: 100%; text-align: center; }
      .triple-row { width: 100%; display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: center; gap: 1mm; }
      .triple-cell { min-width: 0; }
      .text-item { line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .store-name-item, .price-item, .name-item { font-weight: bold; }
      .store-name-item { unicode-bidi: plaintext; overflow: visible; text-overflow: clip; position: relative; z-index: 2; }
      .barcode-value { line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .old-price { position: relative; display: inline-block; font-size: 0.85em; direction: ltr; margin-bottom: 0.4mm; }
      .old-price::after { content: ''; position: absolute; left: -6%; right: -6%; top: 50%; height: 1.2px; background: #000; transform: rotate(-14deg); }
      .discount-price { display: inline-block; direction: rtl; font-size: 0.95em; font-weight: 900; }
      .barcode-zone { display: flex; align-items: center; justify-content: center; min-height: ${svgHeight}px; }
      .barcode { width: ${Math.max(width - 4, 20)}mm; height: ${svgHeight}px; display: block; }
    </style></head><body>${labels.join('')}</body></html>`;
}

export async function printPurchaseInvoiceBarcodes(purchaseId: number) {
  if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) {
    throw new Error('رقم فاتورة الشراء غير صحيح');
  }

  const [invoice, settings, license] = await Promise.all([
    window.api.getPurchaseInvoice(purchaseId),
    window.api.getBarcodePrintSettings(),
    window.__APP_LICENSE_STATUS__
      ? Promise.resolve(window.__APP_LICENSE_STATUS__)
      : window.api.getLicenseStatus(),
  ]);

  if (invoice?.purchase?.status === 'cancelled') {
    throw new Error('لا يمكن طباعة باركود فاتورة شراء ملغاة');
  }

  const plan = buildPurchaseBarcodePlan(invoice.items || []);
  const total = plan.reduce((sum, item) => sum + item.quantity, 0);
  const storeName =
    String(license?.app_name || 'ERP Store').trim() || 'ERP Store';
  const html = buildLabelsHtml(plan, settings, storeName);

  if (html.length > 4_900_000) {
    throw new Error('حجم الملصقات كبير جدًا، يلزم تقسيم الطباعة إلى دفعات');
  }

  const result = await window.api.printHtmlWithDialog({
    html,
    previewWidth: 500,
    previewHeight: 700,
  });

  return { ...result, total, purchaseId };
}
