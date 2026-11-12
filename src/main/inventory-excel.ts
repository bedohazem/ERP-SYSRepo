import ExcelJS from '@ayocore/exceljs';

export type InventoryExcelRow = {
  product_name: string;
  category_name?: string | null;
  barcode?: string | null;
  size?: string | null;
  color?: string | null;
  stock: number;
  min_stock: number;
  buy_price: number;
  sell_price: number;
  discount_price?: number | null;
  is_active: number;
  product_is_active: number;
};

function inventoryStatus(item: InventoryExcelRow): string {
  if (Number(item.is_active) !== 1 || Number(item.product_is_active) !== 1) {
    return 'متعطل';
  }

  const stock = Number(item.stock || 0);

  if (stock < 0) return 'سالب';
  if (stock === 0) return 'نافد';
  if (stock <= Number(item.min_stock || 0)) return 'منخفض';

  return 'متاح';
}

function safeNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function buildInventoryWorkbook(
  items: readonly InventoryExcelRow[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'ERP Store';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('المخزون');

  sheet.views = [
    {
      state: 'frozen',
      ySplit: 4,
      rightToLeft: true,
      showGridLines: false,
    },
  ];

  sheet.columns = [
    { width: 9 },
    { width: 24 },
    { width: 45 },
    { width: 23 },
    { width: 17 },
    { width: 19 },
    { width: 17 },
    { width: 17 },
    { width: 19 },
    { width: 19 },
    { width: 21 },
    { width: 16 },
  ];

  sheet.mergeCells('A1:L1');

  const title = sheet.getCell('A1');
  title.value = 'تقرير المخزون';
  title.font = {
    name: 'Arial',
    size: 18,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };
  title.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF172554' },
  };
  title.alignment = {
    horizontal: 'center',
    vertical: 'middle',
  };

  sheet.getRow(1).height = 38;

  sheet.mergeCells('A2:L2');

  const subtitle = sheet.getCell('A2');
  subtitle.value =
    `تاريخ التصدير: ${new Date().toLocaleString('ar-EG')}` +
    `     |     عدد الأصناف: ${items.length}`;

  subtitle.font = {
    name: 'Arial',
    size: 11,
    color: { argb: 'FF334155' },
  };
  subtitle.alignment = {
    horizontal: 'right',
    vertical: 'middle',
  };

  sheet.getRow(2).height = 27;

  const headers = [
    '#',
    'الباركود',
    'اسم المنتج',
    'التصنيف',
    'المقاس',
    'اللون',
    'الكمية الحالية',
    'الحد الأدنى',
    'سعر الشراء',
    'سعر البيع',
    'السعر بعد الخصم',
    'الحالة',
  ];

  const headerRow = sheet.getRow(4);
  headerRow.values = headers;
  headerRow.height = 30;

  headerRow.eachCell((cell) => {
    cell.font = {
      name: 'Arial',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };

    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E40AF' },
    };

    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
  });

  sheet.autoFilter = {
    from: 'A4',
    to: 'L4',
  };

  // الباركود نص وليس رقمًا لحماية الأصفار الأولى.
  sheet.getColumn(2).numFmt = '@';

  for (const column of [7, 8, 9, 10, 11]) {
    sheet.getColumn(column).numFmt = '#,##0.########';
  }

  items.forEach((item, index) => {
    const sellPrice = safeNumber(item.sell_price);
    const discountPrice =
      item.discount_price == null ? null : safeNumber(item.discount_price);

    const validDiscount =
      discountPrice !== null && discountPrice > 0 && discountPrice < sellPrice;

    const status = inventoryStatus(item);

    const row = sheet.addRow([
      index + 1,
      String(item.barcode ?? ''),
      String(item.product_name ?? ''),
      String(item.category_name ?? ''),
      String(item.size ?? ''),
      String(item.color ?? ''),
      safeNumber(item.stock),
      safeNumber(item.min_stock),
      safeNumber(item.buy_price),
      sellPrice,
      validDiscount ? discountPrice : null,
      status,
    ]);

    row.height = 25;

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = {
        name: 'Arial',
        size: 11,
        color: { argb: 'FF1E293B' },
      };

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: index % 2 === 0 ? 'FFFFFFFF' : 'FFF1F5F9',
        },
      };

      cell.alignment = {
        vertical: 'middle',
        horizontal: 'right',
      };

      cell.border = {
        bottom: {
          style: 'hair',
          color: { argb: 'FFE2E8F0' },
        },
      };
    });

    const barcodeCell = row.getCell(2);
    barcodeCell.numFmt = '@';
    barcodeCell.alignment = {
      horizontal: 'left',
      vertical: 'middle',
    };

    const stockCell = row.getCell(7);

    stockCell.font = {
      name: 'Arial',
      size: 11,
      bold: true,
      color: {
        argb: safeNumber(item.stock) <= 0 ? 'FFDC2626' : 'FF166534',
      },
    };

    const statusCell = row.getCell(12);

    statusCell.font = {
      name: 'Arial',
      size: 11,
      bold: true,
      color: {
        argb:
          status === 'متاح'
            ? 'FF166534'
            : status === 'منخفض'
              ? 'FFB45309'
              : status === 'متعطل'
                ? 'FF64748B'
                : 'FFDC2626',
      },
    };
  });

  return workbook;
}
