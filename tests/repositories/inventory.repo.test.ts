import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createProduct,
  toggleProductActive,
  toggleVariantActive,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';
import {
  adjustVariantStock,
  getInventoryList,
  getStockMovements,
  listInventoryPage,
  getVariantStock,
  getInventoryAnalytics,
} from '../../src/main/database/repositories/inventory.repo';
import { createSale } from '../../src/main/database/repositories/sales.repo';
import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo';

type InventoryVariantTestRow = {
  variant_id: number;
  product_id: number;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  average_cost: number;
  inventory_value: number;
  sell_price: number;
  buy_price: number;
  stock: number;
  min_stock: number;
  is_active: number;
  product_is_active: number;
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
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  unit_cost: number | null;
  cost_value: number | null;
};

function getStockMovementRows(input?: Parameters<typeof getStockMovements>[0]) {
  return getStockMovements(input).rows as StockMovementTestRow[];
}

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
        opening_qty: options?.openingQty ?? 10,
      },
    ],
  });

  const variant = getVariantByBarcode(barcode) as
    InventoryVariantTestRow | undefined;

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
      openingQty: 10,
    });

    expect(getVariantStock(variant.variant_id)).toBe(10);
  });

  it('lists inventory items with calculated stock', () => {
    seedInventoryProduct({
      name: 'Inventory Product A',
      barcode: 'INVA001',
      openingQty: 10,
      minStock: 5,
    });

    seedInventoryProduct({
      name: 'Inventory Product B',
      barcode: 'INVB001',
      openingQty: 0,
      minStock: 5,
    });

    const rows = getInventoryList() as InventoryVariantTestRow[];

    expect(rows.length).toBeGreaterThanOrEqual(2);

    const first = rows.find((row) => row.barcode === 'INVA001');
    const second = rows.find((row) => row.barcode === 'INVB001');

    expect(first?.stock).toBe(10);
    expect(first?.average_cost).toBe(100);

    expect(first?.inventory_value).toBe(1000);
    expect(first?.min_stock).toBe(5);

    expect(second?.stock).toBe(0);
    expect(second?.min_stock).toBe(5);
  });

  it('builds 30-day movement and 90-day dead-stock analytics', () => {
    /*
     * أول شفت هو نقطة مرجع
     * التاريخ المالي للنظام.
     */
    openCashShift({
      opening_counted_amount: 0,
      opened_by: 1,
    });

    const oldMover = seedInventoryProduct({
      name: 'Old Inventory Mover',

      barcode: 'ANALYTICS-OLD',

      openingQty: 10,

      minStock: 2,
    });

    const recentMover = seedInventoryProduct({
      name: 'Recent Inventory Mover',

      barcode: 'ANALYTICS-RECENT',

      openingQty: 10,

      minStock: 2,
    });

    seedInventoryProduct({
      name: 'Never Sold Inventory',

      barcode: 'ANALYTICS-NEVER',

      openingQty: 5,

      minStock: 2,
    });

    const oldSale = createSale({
      user_id: 1,

      sub_total: 150,

      discount_value: 0,

      grand_total: 150,

      change_amount: 0,

      payment_method: 'owner_bank',

      paid: 150,

      items: [
        {
          variant_id: oldMover.variant_id,

          product_name: oldMover.product_name,

          barcode: oldMover.barcode,

          size: oldMover.size,

          color: oldMover.color,

          quantity: 1,

          unit_price: 150,
        },
      ],
    });

    createSale({
      user_id: 1,

      sub_total: 300,

      discount_value: 0,

      grand_total: 300,

      change_amount: 0,

      payment_method: 'owner_bank',

      paid: 300,

      items: [
        {
          variant_id: recentMover.variant_id,

          product_name: recentMover.product_name,

          barcode: recentMover.barcode,

          size: recentMover.size,

          color: recentMover.color,

          quantity: 2,

          unit_price: 150,
        },
      ],
    });

    const db = getDb();

    db.prepare(
      `
    UPDATE sales

    SET created_at =
      datetime(
        'now',
        'localtime',
        '-120 days'
      )

    WHERE id = ?
    `,
    ).run(oldSale.saleId);

    const analytics = getInventoryAnalytics();

    expect(analytics.stock_units).toBe(22);

    expect(analytics.sold_units_30d).toBe(2);

    expect(analytics.dead_stock_variants_90d).toBe(2);

    expect(analytics.dead_stock_units_90d).toBe(14);

    expect(analytics.dead_stock_value_90d).toBe(1400);

    expect(analytics.potential_gross_profit).toBe(1100);

    expect(analytics.top_mover?.variant_id).toBe(recentMover.variant_id);

    expect(analytics.top_mover?.sold_units_30d).toBe(2);
  });

  it('keeps disabled products and variants visible in inventory', () => {
    const variantDisabled = seedInventoryProduct({
      name: 'Disabled Variant Inventory',
      barcode: 'INV-DISABLED-VARIANT',
      openingQty: 6,
      minStock: 2,
    });

    const productDisabled = seedInventoryProduct({
      name: 'Disabled Product Inventory',
      barcode: 'INV-DISABLED-PRODUCT',
      openingQty: 4,
      minStock: 2,
    });

    toggleVariantActive(variantDisabled.variant_id, 0);

    toggleProductActive(productDisabled.product_id, 0);

    const rows = getInventoryList({
      status: 'inactive',
    }) as InventoryVariantTestRow[];

    const disabledVariantRow = rows.find(
      (row) => row.barcode === 'INV-DISABLED-VARIANT',
    );

    const disabledProductRow = rows.find(
      (row) => row.barcode === 'INV-DISABLED-PRODUCT',
    );

    expect(disabledVariantRow).toBeDefined();
    expect(disabledVariantRow?.stock).toBe(6);
    expect(disabledVariantRow?.is_active).toBe(0);
    expect(disabledVariantRow?.product_is_active).toBe(1);

    expect(disabledProductRow).toBeDefined();
    expect(disabledProductRow?.stock).toBe(4);
    expect(disabledProductRow?.product_is_active).toBe(0);

    const activeRows = getInventoryList({
      status: 'available',
    }) as InventoryVariantTestRow[];

    expect(
      activeRows.some((row) => row.barcode === 'INV-DISABLED-VARIANT'),
    ).toBe(false);

    expect(
      activeRows.some((row) => row.barcode === 'INV-DISABLED-PRODUCT'),
    ).toBe(false);

    const page = listInventoryPage({
      status: 'all',
      limit: 50,
      offset: 0,
    });

    expect(page.summary.inactive).toBe(2);

    expect(page.summary.totalBuyValue).toBe(1000);
  });

  it('filters inventory by multiple selected statuses', () => {
    seedInventoryProduct({
      name: 'Multi Available',
      barcode: 'MULTI-AVAILABLE',
      openingQty: 10,
      minStock: 5,
    });

    seedInventoryProduct({
      name: 'Multi Low',
      barcode: 'MULTI-LOW',
      openingQty: 3,
      minStock: 5,
    });

    seedInventoryProduct({
      name: 'Multi Out',
      barcode: 'MULTI-OUT',
      openingQty: 0,
      minStock: 5,
    });

    const disabled = seedInventoryProduct({
      name: 'Multi Disabled',
      barcode: 'MULTI-DISABLED',
      openingQty: 4,
      minStock: 5,
    });

    toggleVariantActive(disabled.variant_id, 0);

    const result = listInventoryPage({
      statuses: ['low', 'out', 'inactive'],
      limit: 50,
      offset: 0,
    });

    const barcodes = result.rows.map((row: any) => row.barcode);

    expect(barcodes).toContain('MULTI-LOW');
    expect(barcodes).toContain('MULTI-OUT');
    expect(barcodes).toContain('MULTI-DISABLED');

    expect(barcodes).not.toContain('MULTI-AVAILABLE');

    expect(result.total).toBe(3);
  });

  it('searches inventory by product name barcode size and color', () => {
    seedInventoryProduct({
      name: 'Blue Jacket',
      barcode: 'BLUEJACKET001',
      openingQty: 10,
      size: 'XL',
      color: 'Blue',
    });

    expect(
      getInventoryList({ search: 'Jacket' }) as InventoryVariantTestRow[],
    ).toHaveLength(1);
    expect(
      getInventoryList({
        search: 'BLUEJACKET001',
      }) as InventoryVariantTestRow[],
    ).toHaveLength(1);
    expect(
      getInventoryList({ search: 'XL' }) as InventoryVariantTestRow[],
    ).toHaveLength(1);
    expect(
      getInventoryList({ search: 'Blue' }) as InventoryVariantTestRow[],
    ).toHaveLength(1);
  });

  it('filters inventory by available low and out status', () => {
    seedInventoryProduct({
      name: 'Available Product',
      barcode: 'AVAILABLE001',
      openingQty: 10,
      minStock: 5,
    });

    seedInventoryProduct({
      name: 'Low Product',
      barcode: 'LOW001',
      openingQty: 3,
      minStock: 5,
    });

    seedInventoryProduct({
      name: 'Out Product',
      barcode: 'OUT001',
      openingQty: 0,
      minStock: 5,
    });

    const availableRows = getInventoryList({
      status: 'available',
    }) as InventoryVariantTestRow[];
    const lowRows = getInventoryList({
      status: 'low',
    }) as InventoryVariantTestRow[];
    const outRows = getInventoryList({
      status: 'out',
    }) as InventoryVariantTestRow[];

    expect(availableRows.some((row) => row.barcode === 'AVAILABLE001')).toBe(
      true,
    );
    expect(availableRows.every((row) => row.stock > row.min_stock)).toBe(true);

    expect(lowRows.some((row) => row.barcode === 'LOW001')).toBe(true);
    expect(
      lowRows.every((row) => row.stock > 0 && row.stock <= row.min_stock),
    ).toBe(true);

    expect(outRows.some((row) => row.barcode === 'OUT001')).toBe(true);
    expect(outRows.every((row) => row.stock === 0)).toBe(true);
  });

  it('adjusts variant stock upward with manual in movement', () => {
    const variant = seedInventoryProduct({
      barcode: 'ADJUP001',
      openingQty: 10,
    });

    const result = adjustVariantStock({
      variant_id: variant.variant_id,
      target_stock: 15,
      notes: 'Manual increase',
    });

    expect(result.success).toBe(true);
    expect(result.old_stock).toBe(10);
    expect(result.new_stock).toBe(15);
    expect(result.diff).toBe(5);

    expect(getVariantStock(variant.variant_id)).toBe(15);

    const movements = getStockMovementRows({
      variant_id: variant.variant_id,
    }) as StockMovementTestRow[];

    expect(movements[0].type).toBe('in');
    expect(movements[0].quantity).toBe(5);
    expect(movements[0].signed_quantity).toBe(5);
    expect(movements[0].reference_type).toBe('manual_adjust');
    expect(movements[0].unit_cost).toBe(100);

    expect(movements[0].cost_value).toBe(500);
    expect(movements[0].notes).toBe('Manual increase');
  });

  it('adjusts variant stock downward with manual out movement', () => {
    const variant = seedInventoryProduct({
      barcode: 'ADJDOWN001',
      openingQty: 10,
    });

    const result = adjustVariantStock({
      variant_id: variant.variant_id,
      target_stock: 4,
      notes: 'Manual decrease',
    });

    expect(result.success).toBe(true);
    expect(result.old_stock).toBe(10);
    expect(result.new_stock).toBe(4);
    expect(result.diff).toBe(-6);

    expect(getVariantStock(variant.variant_id)).toBe(4);

    const movements = getStockMovementRows({
      variant_id: variant.variant_id,
    }) as StockMovementTestRow[];

    expect(movements[0].type).toBe('out');
    expect(movements[0].quantity).toBe(6);
    expect(movements[0].signed_quantity).toBe(-6);
    expect(movements[0].reference_type).toBe('manual_adjust');
    expect(movements[0].unit_cost).toBe(100);

    expect(movements[0].cost_value).toBe(600);
    expect(movements[0].notes).toBe('Manual decrease');
  });

  it('stores the actor who created a manual stock movement', () => {
    const db = getDb();

    db.prepare(
      `
    INSERT INTO users (
      id,
      name,
      username,
      password,
      role,
      is_active
    )

    VALUES (?, ?, ?, ?, 'admin', 1)
    `,
    ).run(77, 'Inventory Actor', 'inventory_actor', 'test-password');

    const variant = seedInventoryProduct({
      barcode: 'ACTOR-ADJUST-001',
      openingQty: 10,
    });

    adjustVariantStock({
      variant_id: variant.variant_id,
      target_stock: 13,
      notes: 'Actor tracking test',
      actor_id: 77,
    });

    const movements = getStockMovementRows({
      variant_id: variant.variant_id,
    });

    expect(movements[0].reference_type).toBe('manual_adjust');

    expect(movements[0].created_by).toBe(77);

    expect(movements[0].created_by_name).toBe('Inventory Actor');
  });

  it('does not create stock movement when target stock equals current stock', () => {
    const variant = seedInventoryProduct({
      barcode: 'NOCHANGE001',
      openingQty: 10,
    });

    const beforeMovements = getStockMovementRows({
      variant_id: variant.variant_id,
    }) as StockMovementTestRow[];

    const result = adjustVariantStock({
      variant_id: variant.variant_id,
      target_stock: 10,
    });

    const afterMovements = getStockMovementRows({
      variant_id: variant.variant_id,
    }) as StockMovementTestRow[];

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
        target_stock: 10,
      }),
    ).toThrow('رقم الصنف مطلوب');
  });

  it('rejects stock adjustment for missing variant', () => {
    expect(() =>
      adjustVariantStock({
        variant_id: 999999,
        target_stock: 10,
      }),
    ).toThrow('الصنف غير موجود');
  });

  it('rejects stock adjustment with negative target stock', () => {
    const variant = seedInventoryProduct({
      barcode: 'NEGADJ001',
      openingQty: 10,
    });

    expect(() =>
      adjustVariantStock({
        variant_id: variant.variant_id,
        target_stock: -1,
      }),
    ).toThrow('المخزون الجديد غير صحيح');

    expect(getVariantStock(variant.variant_id)).toBe(10);
  });

  it('lists stock movements by variant search and limit', () => {
    const first = seedInventoryProduct({
      name: 'Movement Product One',
      barcode: 'MOVE001',
      openingQty: 10,
      color: 'Red',
    });

    const second = seedInventoryProduct({
      name: 'Movement Product Two',
      barcode: 'MOVE002',
      openingQty: 5,
      color: 'Green',
    });

    adjustVariantStock({
      variant_id: first.variant_id,
      target_stock: 12,
      notes: 'First movement search note',
    });

    adjustVariantStock({
      variant_id: second.variant_id,
      target_stock: 7,
      notes: 'Second movement note',
    });

    const firstRows = getStockMovementRows({
      variant_id: first.variant_id,
    }) as StockMovementTestRow[];
    const searchRows = getStockMovementRows({
      search: 'search note',
    }) as StockMovementTestRow[];
    const limitedRows = getStockMovementRows({
      limit: 1,
    }) as StockMovementTestRow[];

    expect(firstRows.every((row) => row.variant_id === first.variant_id)).toBe(
      true,
    );
    expect(searchRows).toHaveLength(1);
    expect(searchRows[0].notes).toBe('First movement search note');

    expect(limitedRows).toHaveLength(1);
  });

  it('paginates inventory items', () => {
    for (let index = 1; index <= 5; index += 1) {
      seedInventoryProduct({
        name: `Paged Product ${index}`,
        barcode: `PAGEINV00${index}`,
        openingQty: index,
        minStock: 2,
      });
    }

    const firstPage = listInventoryPage({
      limit: 2,
      offset: 0,
    });

    const secondPage = listInventoryPage({
      limit: 2,
      offset: 2,
    });

    expect(firstPage.total).toBe(5);
    expect(firstPage.rows).toHaveLength(2);
    expect(secondPage.rows).toHaveLength(2);

    expect(firstPage.summary.total).toBe(5);
  });

  it('paginates stock movement history', () => {
    const variant = seedInventoryProduct({
      barcode: 'MOVEPAGE001',
      openingQty: 10,
    });

    adjustVariantStock({
      variant_id: variant.variant_id,
      target_stock: 11,
    });

    adjustVariantStock({
      variant_id: variant.variant_id,
      target_stock: 12,
    });

    adjustVariantStock({
      variant_id: variant.variant_id,
      target_stock: 13,
    });

    adjustVariantStock({
      variant_id: variant.variant_id,
      target_stock: 14,
    });

    const firstPage = getStockMovements({
      variant_id: variant.variant_id,
      limit: 2,
      offset: 0,
    });

    const secondPage = getStockMovements({
      variant_id: variant.variant_id,
      limit: 2,
      offset: 2,
    });

    expect(firstPage.total).toBe(5);
    expect(firstPage.rows).toHaveLength(2);
    expect(secondPage.rows).toHaveLength(2);
  });
});
