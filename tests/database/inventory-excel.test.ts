import { describe, expect, it } from 'vitest';
import {
  buildInventoryWorkbook,
  type InventoryExcelRow,
} from '../../src/main/inventory-excel';

describe('inventory Excel export', () => {
  const base: InventoryExcelRow = {
    product_name: 'منتج تجريبي',
    category_name: 'ملابس',
    barcode: '000126-D',
    size: '6-1',
    color: 'أسود',
    stock: 12,
    min_stock: 3,
    buy_price: 60.25,
    sell_price: 100,
    discount_price: 75,
    is_active: 1,
    product_is_active: 1,
  };

  it('preserves barcode and exports prices as numbers', async () => {
    const workbook = buildInventoryWorkbook([base]);
    const sheet = workbook.getWorksheet('المخزون');

    expect(sheet).toBeDefined();

    expect(sheet!.getCell('B5').value).toBe('000126-D');
    expect(sheet!.getCell('B5').numFmt).toBe('@');

    expect(sheet!.getCell('C5').value).toBe('منتج تجريبي');
    expect(sheet!.getCell('D5').value).toBe('ملابس');
    expect(sheet!.getCell('G5').value).toBe(12);

    expect(sheet!.getCell('I5').value).toBe(60.25);
    expect(sheet!.getCell('J5').value).toBe(100);
    expect(sheet!.getCell('K5').value).toBe(75);
    expect(sheet!.getCell('L5').value).toBe('متاح');

    const buffer = await workbook.xlsx.writeBuffer();

    expect(buffer.byteLength).toBeGreaterThan(1000);
  });

  it('leaves discount empty when there is no valid discount', () => {
    const workbook = buildInventoryWorkbook([
      {
        ...base,
        discount_price: null,
        stock: 0,
      },
    ]);

    const sheet = workbook.getWorksheet('المخزون')!;

    expect(sheet.getCell('K5').value).toBeNull();
    expect(sheet.getCell('L5').value).toBe('نافد');
  });

  it('includes inactive products without changing their quantities', () => {
    const workbook = buildInventoryWorkbook([
      {
        ...base,
        product_is_active: 0,
        stock: 8,
      },
    ]);

    const sheet = workbook.getWorksheet('المخزون')!;

    expect(sheet.getCell('G5').value).toBe(8);
    expect(sheet.getCell('L5').value).toBe('متعطل');
  });
});
