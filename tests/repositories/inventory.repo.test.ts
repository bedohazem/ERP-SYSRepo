import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createProduct,
  getVariantByBarcode
} from '../../src/main/database/repositories/product.repo';
import {
  adjustVariantStock,
  getInventoryList,
  getStockMovements,
  getVariantStock
} from '../../src/main/database/repositories/inventory.repo';

type InventoryVariantTestRow = {
  variant_id: number;
  product_id: number;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  sell_price: number;
  buy_price: number;
  stock: number;
  min_stock: number;
  is_active: number;
};

type StockMovementTestRow = {
  id: number;
  variant_id: number;
  type: 'in' | 'out';
  quantity: number;
  signed_quantity: number;
  reference_id: number | null;
  reference_type: string | null;
  notes: string | null;
  created_at: string;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
};

function seedInventoryProduct(options?: {
  name?: string;
  barcode?: string;
  openingQty?: number;
  minStock?: number;
  size?: string;
  color?: string;
}) {
  const barcode = options?.barcode ?? 'INV001';

  createProduct({
    name: options?.name ?? 'Inventory Test Product',
    category_id: null,
    image_path: null,
    description: null,
    variants: [
      {
        barcode,
        size: options?.size ?? 'M',
        color: options?.color ?? 'Black',
        buy_price: 100,
        sell_price: 150,
        min_stock: options?.minStock ?? 5,
        opening_qty: options?.openingQty ?? 10
      }
    ]
  });

  const variant = getVariantByBarcode(barcode) as InventoryVariantTestRow | undefined;

  if (!variant) {
    throw new Error(`Failed to seed inventory variant: ${barcode}`);
  }

  return variant;
}

describe('inventory repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  it('gets current variant stock from stock movements', () => {
    const variant = seedInventoryProduct({
      barcode: 'INVSTOCK001',
      openingQty: 10
    });

    expect(getVariantStock(variant.variant_id)).toBe(10);
  });

  it('lists inventory items with calculated stock', () => {
    seedInventoryProduct({
      name: 'Inventory Product A',
      barcode: 'INVA001',
      openingQty: 10,
      minStock: 5
    });

    seedInventoryProduct({
      name: 'Inventory Product B',
      barcode: 'INVB001',
      openingQty: 0,
      minStock: 5
    });

    const rows = getInventoryList() as InventoryVariantTestRow[];

    expect(rows.length).toBeGreaterThanOrEqual(2);

    const first = rows.find((row) => row.barcode === 'INVA001');
    const second = rows.find((row) => row.barcode === 'INVB001');

    expect(first?.stock).toBe(10);
    expect(first?.min_stock).toBe(5);

    expect(second?.stock).toBe(0);
    expect(second?.min_stock).toBe(5);
  });

  it('searches inventory by product name barcode size and color', () => {
    seedInventoryProduct({
      name: 'Blue Jacket',
      barcode: 'BLUEJACKET001',
      openingQty: 10,
      size: 'XL',
      color: 'Blue'
    });

    expect(getInventoryList({ search: 'Jacket' }) as InventoryVariantTestRow[]).toHaveLength(1);
    expect(getInventoryList({ search: 'BLUEJACKET001' }) as InventoryVariantTestRow[]).toHaveLength(1);
    expect(getInventoryList({ search: 'XL' }) as InventoryVariantTestRow[]).toHaveLength(1);
    expect(getInventoryList({ search: 'Blue' }) as InventoryVariantTestRow[]).toHaveLength(1);
  });

  it('filters inventory by available low and out status', () => {
    seedInventoryProduct({
      name: 'Available Product',
      barcode: 'AVAILABLE001',
      openingQty: 10,
      minStock: 5
    });

    seedInventoryProduct({
      name: 'Low Product',
      barcode: 'LOW001',
      openingQty: 3,
      minStock: 5
    });

    seedInventoryProduct({
      name: 'Out Product',
      barcode: 'OUT001',
      openingQty: 0,
      minStock: 5
    });

    const availableRows = getInventoryList({ status: 'available' }) as InventoryVariantTestRow[];
    const lowRows = getInventoryList({ status: 'low' }) as InventoryVariantTestRow[];
    const outRows = getInventoryList({ status: 'out' }) as InventoryVariantTestRow[];

    expect(availableRows.some((row) => row.barcode === 'AVAILABLE001')).toBe(true);
    expect(availableRows.every((row) => row.stock > row.min_stock)).toBe(true);

    expect(lowRows.some((row) => row.barcode === 'LOW001')).toBe(true);
    expect(lowRows.every((row) => row.stock > 0 && row.stock <= row.min_stock)).toBe(true);

    expect(outRows.some((row) => row.barcode === 'OUT001')).toBe(true);
    expect(outRows.every((row) => row.stock === 0)).toBe(true);
  });

  it('adjusts variant stock upward with manual in movement', () => {
    const variant = seedInventoryProduct({
      barcode: 'ADJUP001',
      openingQty: 10
    });

    const result = adjustVariantStock({
      variant_id: variant.variant_id,
      target_stock: 15,
      notes: 'Manual increase'
    });

    expect(result.success).toBe(true);
    expect(result.old_stock).toBe(10);
    expect(result.new_stock).toBe(15);
    expect(result.diff).toBe(5);

    expect(getVariantStock(variant.variant_id)).toBe(15);

    const movements = getStockMovements({ variant_id: variant.variant_id }) as StockMovementTestRow[];

    expect(movements[0].type).toBe('in');
    expect(movements[0].quantity).toBe(5);
    expect(movements[0].signed_quantity).toBe(5);
    expect(movements[0].reference_type).toBe('manual_adjust');
    expect(movements[0].notes).toBe('Manual increase');
  });

  it('adjusts variant stock downward with manual out movement', () => {
    const variant = seedInventoryProduct({
      barcode: 'ADJDOWN001',
      openingQty: 10
    });

    const result = adjustVariantStock({
      variant_id: variant.variant_id,
      target_stock: 4,
      notes: 'Manual decrease'
    });

    expect(result.success).toBe(true);
    expect(result.old_stock).toBe(10);
    expect(result.new_stock).toBe(4);
    expect(result.diff).toBe(-6);

    expect(getVariantStock(variant.variant_id)).toBe(4);

    const movements = getStockMovements({ variant_id: variant.variant_id }) as StockMovementTestRow[];

    expect(movements[0].type).toBe('out');
    expect(movements[0].quantity).toBe(6);
    expect(movements[0].signed_quantity).toBe(-6);
    expect(movements[0].reference_type).toBe('manual_adjust');
    expect(movements[0].notes).toBe('Manual decrease');
  });

  it('does not create stock movement when target stock equals current stock', () => {
    const variant = seedInventoryProduct({
      barcode: 'NOCHANGE001',
      openingQty: 10
    });

    const beforeMovements = getStockMovements({ variant_id: variant.variant_id }) as StockMovementTestRow[];

    const result = adjustVariantStock({
      variant_id: variant.variant_id,
      target_stock: 10
    });

    const afterMovements = getStockMovements({ variant_id: variant.variant_id }) as StockMovementTestRow[];

    expect(result.success).toBe(true);
    expect(result.old_stock).toBe(10);
    expect(result.new_stock).toBe(10);
    expect(result.diff).toBe(0);
    expect(afterMovements).toHaveLength(beforeMovements.length);
  });

  it('rejects stock adjustment without variant id', () => {
    expect(() =>
      adjustVariantStock({
        variant_id: 0,
        target_stock: 10
      })
    ).toThrow('Variant ID is required');
  });

  it('rejects stock adjustment for missing variant', () => {
    expect(() =>
      adjustVariantStock({
        variant_id: 999999,
        target_stock: 10
      })
    ).toThrow('الصنف غير موجود');
  });

  it('rejects stock adjustment with negative target stock', () => {
    const variant = seedInventoryProduct({
      barcode: 'NEGADJ001',
      openingQty: 10
    });

    expect(() =>
      adjustVariantStock({
        variant_id: variant.variant_id,
        target_stock: -1
      })
    ).toThrow('المخزون الجديد غير صحيح');

    expect(getVariantStock(variant.variant_id)).toBe(10);
  });

  it('lists stock movements by variant search and limit', () => {
    const first = seedInventoryProduct({
      name: 'Movement Product One',
      barcode: 'MOVE001',
      openingQty: 10,
      color: 'Red'
    });

    const second = seedInventoryProduct({
      name: 'Movement Product Two',
      barcode: 'MOVE002',
      openingQty: 5,
      color: 'Green'
    });

    adjustVariantStock({
      variant_id: first.variant_id,
      target_stock: 12,
      notes: 'First movement search note'
    });

    adjustVariantStock({
      variant_id: second.variant_id,
      target_stock: 7,
      notes: 'Second movement note'
    });

    const firstRows = getStockMovements({ variant_id: first.variant_id }) as StockMovementTestRow[];
    const searchRows = getStockMovements({ search: 'search note' }) as StockMovementTestRow[];
    const limitedRows = getStockMovements({ limit: 1 }) as StockMovementTestRow[];

    expect(firstRows.every((row) => row.variant_id === first.variant_id)).toBe(true);
    expect(searchRows).toHaveLength(1);
    expect(searchRows[0].notes).toBe('First movement search note');

    expect(limitedRows).toHaveLength(1);
  });
});