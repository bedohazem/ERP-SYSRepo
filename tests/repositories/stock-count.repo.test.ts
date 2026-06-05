import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createProduct,
  getVariantByBarcode
} from '../../src/main/database/repositories/product.repo';
import { getVariantStock } from '../../src/main/database/repositories/inventory.repo';
import {
  approveStockCountSession,
  cancelStockCountSession,
  createStockCountSession,
  getStockCountSession,
  listStockCountSessions,
  scanStockCountBarcode,
  updateStockCountItem
} from '../../src/main/database/repositories/stock-count.repo';

type StockCountVariantTestRow = {
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

type StockCountItemTestRow = {
  id: number;
  session_id: number;
  variant_id: number;
  system_stock: number;
  actual_stock: number | null;
  notes: string | null;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  difference: number;
  buy_difference_value: number;
  sell_difference_value: number;
};

type StockCountSessionListRow = {
  id: number;
  title: string;
  notes: string | null;
  status: 'open' | 'approved' | 'canceled';
  created_by: number | null;
  approved_by: number | null;
  canceled_by: number | null;
  items_count: number;
  counted_count: number;
  matched_count: number;
  shortage_count: number;
  surplus_count: number;
  buy_difference_value: number;
  sell_difference_value: number;
};

function seedStockCountProduct(options?: {
  name?: string;
  barcode?: string;
  openingQty?: number;
  minStock?: number;
  size?: string;
  color?: string;
  buyPrice?: number;
  sellPrice?: number;
}) {
  const barcode = options?.barcode ?? 'COUNT001';

  createProduct({
    name: options?.name ?? 'Stock Count Product',
    category_id: null,
    image_path: null,
    description: null,
    variants: [
      {
        barcode,
        size: options?.size ?? 'M',
        color: options?.color ?? 'Black',
        buy_price: options?.buyPrice ?? 100,
        sell_price: options?.sellPrice ?? 150,
        min_stock: options?.minStock ?? 5,
        opening_qty: options?.openingQty ?? 10
      }
    ]
  });

  const variant = getVariantByBarcode(barcode) as StockCountVariantTestRow | undefined;

  if (!variant) {
    throw new Error(`Failed to seed stock count variant: ${barcode}`);
  }

  return variant;
}

function getStockMovementCountForSession(sessionId: number) {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM stock_movements
      WHERE reference_type = 'stock_count'
        AND reference_id = ?
      `
    )
    .get(sessionId) as { count: number };

  return Number(row.count || 0);
}

describe('stock count repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  it('creates stock count session with active variants snapshot', () => {
    seedStockCountProduct({
      name: 'Count Product A',
      barcode: 'COUNT-A',
      openingQty: 10
    });

    seedStockCountProduct({
      name: 'Count Product B',
      barcode: 'COUNT-B',
      openingQty: 5
    });

    const session = createStockCountSession({
      title: '  June Count  ',
      notes: ' monthly count ',
      actor_id: 1
    });

    expect(session.id).toBeGreaterThan(0);
    expect(session.title).toBe('June Count');
    expect(session.status).toBe('open');
    expect(session.items_count).toBe(2);

    const details = getStockCountSession(session.id) as any;

    expect(details.session.id).toBe(session.id);
    expect(details.session.title).toBe('June Count');
    expect(details.session.notes).toBe('monthly count');
    expect(details.items).toHaveLength(2);

    const itemA = details.items.find((item: StockCountItemTestRow) => item.barcode === 'COUNT-A');

    expect(itemA.system_stock).toBe(10);
    expect(itemA.actual_stock).toBeNull();
  });

  it('rejects stock count session with empty title', () => {
    expect(() =>
      createStockCountSession({
        title: '   '
      })
    ).toThrow('اسم جلسة الجرد مطلوب');
  });

  it('lists stock count sessions with counts and differences', () => {
    seedStockCountProduct({
      name: 'Matched Product',
      barcode: 'MATCHED001',
      openingQty: 10,
      buyPrice: 100,
      sellPrice: 150
    });

    seedStockCountProduct({
      name: 'Shortage Product',
      barcode: 'SHORTAGE001',
      openingQty: 10,
      buyPrice: 100,
      sellPrice: 150
    });

    seedStockCountProduct({
      name: 'Surplus Product',
      barcode: 'SURPLUS001',
      openingQty: 10,
      buyPrice: 100,
      sellPrice: 150
    });

    const session = createStockCountSession({
      title: 'Count With Differences',
      actor_id: 1
    });

    const details = getStockCountSession(session.id) as any;

    for (const item of details.items as StockCountItemTestRow[]) {
      const actualStock =
        item.barcode === 'MATCHED001'
          ? 10
          : item.barcode === 'SHORTAGE001'
            ? 7
            : 12;

      updateStockCountItem({
        session_id: session.id,
        item_id: item.id,
        actual_stock: actualStock
      });
    }

    const rows = listStockCountSessions() as StockCountSessionListRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0].items_count).toBe(3);
    expect(rows[0].counted_count).toBe(3);
    expect(rows[0].matched_count).toBe(1);
    expect(rows[0].shortage_count).toBe(1);
    expect(rows[0].surplus_count).toBe(1);
    expect(rows[0].buy_difference_value).toBe(-100);
    expect(rows[0].sell_difference_value).toBe(-150);
  });

  it('updates stock count item actual stock and notes', () => {
    seedStockCountProduct({
      barcode: 'UPDATECOUNT001',
      openingQty: 10
    });

    const session = createStockCountSession({
      title: 'Update Count'
    });

    const details = getStockCountSession(session.id) as any;
    const item = details.items[0] as StockCountItemTestRow;

    const result = updateStockCountItem({
      session_id: session.id,
      item_id: item.id,
      actual_stock: 8,
      notes: 'Found shortage'
    });

    expect(result.success).toBe(true);

    const updated = getStockCountSession(session.id) as any;
    const updatedItem = updated.items[0] as StockCountItemTestRow;

    expect(updatedItem.actual_stock).toBe(8);
    expect(updatedItem.notes).toBe('Found shortage');
    expect(updatedItem.difference).toBe(-2);
    expect(updatedItem.buy_difference_value).toBe(-200);
    expect(updatedItem.sell_difference_value).toBe(-300);
  });

  it('rejects update item for missing session', () => {
    expect(() =>
      updateStockCountItem({
        session_id: 999999,
        item_id: 1,
        actual_stock: 1
      })
    ).toThrow('جلسة الجرد غير موجودة');
  });

  it('rejects update item with negative actual stock', () => {
    seedStockCountProduct({
      barcode: 'NEGCOUNT001',
      openingQty: 10
    });

    const session = createStockCountSession({
      title: 'Negative Count'
    });

    const details = getStockCountSession(session.id) as any;
    const item = details.items[0] as StockCountItemTestRow;

    expect(() =>
      updateStockCountItem({
        session_id: session.id,
        item_id: item.id,
        actual_stock: -1
      })
    ).toThrow('الكمية الفعلية غير صحيحة');
  });

  it('rejects update item with missing item id', () => {
    seedStockCountProduct({
      barcode: 'MISSINGITEM001',
      openingQty: 10
    });

    const session = createStockCountSession({
      title: 'Missing Item Count'
    });

    expect(() =>
      updateStockCountItem({
        session_id: session.id,
        item_id: 999999,
        actual_stock: 5
      })
    ).toThrow('بند الجرد غير موجود');
  });

  it('scans stock count barcode and increments actual stock', () => {
    seedStockCountProduct({
      name: 'Scan Product',
      barcode: 'SCAN001',
      openingQty: 10
    });

    const session = createStockCountSession({
      title: 'Scan Count'
    });

    const firstScan = scanStockCountBarcode({
      session_id: session.id,
      barcode: 'SCAN001'
    });

    expect(firstScan.success).toBe(true);
    expect(firstScan.actual_stock).toBe(1);
    expect(firstScan.product_name).toBe('Scan Product');

    const secondScan = scanStockCountBarcode({
      session_id: session.id,
      barcode: 'SCAN001',
      quantity: 4
    });

    expect(secondScan.actual_stock).toBe(5);

    const details = getStockCountSession(session.id) as any;
    const item = details.items[0] as StockCountItemTestRow;

    expect(item.actual_stock).toBe(5);
  });

  it('rejects scan with empty barcode and invalid quantity', () => {
    seedStockCountProduct({
      barcode: 'BADSCAN001',
      openingQty: 10
    });

    const session = createStockCountSession({
      title: 'Bad Scan Count'
    });

    expect(() =>
      scanStockCountBarcode({
        session_id: session.id,
        barcode: '   '
      })
    ).toThrow('الباركود مطلوب');

    expect(() =>
      scanStockCountBarcode({
        session_id: session.id,
        barcode: 'BADSCAN001',
        quantity: 0
      })
    ).toThrow('الكمية غير صحيحة');
  });

  it('rejects scan for missing barcode in session', () => {
    seedStockCountProduct({
      barcode: 'EXISTINGSCAN001',
      openingQty: 10
    });

    const session = createStockCountSession({
      title: 'Missing Barcode Scan'
    });

    expect(() =>
      scanStockCountBarcode({
        session_id: session.id,
        barcode: 'NOTFOUND'
      })
    ).toThrow('لم يتم العثور على صنف بهذا الباركود أو الاسم داخل جلسة الجرد');
  });

  it('rejects approving session with uncounted items', () => {
    seedStockCountProduct({
      barcode: 'UNCOUNTED001',
      openingQty: 10
    });

    const session = createStockCountSession({
      title: 'Uncounted Count'
    });

    expect(() =>
      approveStockCountSession({
        session_id: session.id,
        actor_id: 1
      })
    ).toThrow('يوجد 1 صنف لم يتم جرده');

    expect(getVariantStock(getVariantByBarcode('UNCOUNTED001')!.variant_id)).toBe(10);
  });

  it('approves stock count session and applies stock movements', () => {
    const shortageVariant = seedStockCountProduct({
      name: 'Approve Shortage',
      barcode: 'APPROVE-SHORT',
      openingQty: 10
    });

    const surplusVariant = seedStockCountProduct({
      name: 'Approve Surplus',
      barcode: 'APPROVE-SURPLUS',
      openingQty: 5
    });

    const matchedVariant = seedStockCountProduct({
      name: 'Approve Matched',
      barcode: 'APPROVE-MATCHED',
      openingQty: 7
    });

    const session = createStockCountSession({
      title: 'Approve Count',
      actor_id: 1
    });

    const details = getStockCountSession(session.id) as any;

    for (const item of details.items as StockCountItemTestRow[]) {
      const actualStock =
        item.barcode === 'APPROVE-SHORT'
          ? 8
          : item.barcode === 'APPROVE-SURPLUS'
            ? 9
            : 7;

      updateStockCountItem({
        session_id: session.id,
        item_id: item.id,
        actual_stock: actualStock
      });
    }

    const result = approveStockCountSession({
      session_id: session.id,
      actor_id: 1
    });

    expect(result.success).toBe(true);
    expect(result.changed_items).toBe(2);
    expect(result.shortage_items).toBe(1);
    expect(result.surplus_items).toBe(1);
    expect(result.total_shortage_qty).toBe(2);
    expect(result.total_surplus_qty).toBe(4);

    expect(getVariantStock(shortageVariant.variant_id)).toBe(8);
    expect(getVariantStock(surplusVariant.variant_id)).toBe(9);
    expect(getVariantStock(matchedVariant.variant_id)).toBe(7);
    expect(getStockMovementCountForSession(session.id)).toBe(2);

    const approved = getStockCountSession(session.id) as any;

    expect(approved.session.status).toBe('approved');
    expect(approved.session.approved_by).toBe(1);
    expect(approved.session.approved_at).toBeTruthy();
  });

  it('rejects editing or scanning approved session', () => {
    seedStockCountProduct({
      barcode: 'APPROVEDLOCK001',
      openingQty: 10
    });

    const session = createStockCountSession({
      title: 'Approved Lock Count'
    });

    const details = getStockCountSession(session.id) as any;
    const item = details.items[0] as StockCountItemTestRow;

    updateStockCountItem({
      session_id: session.id,
      item_id: item.id,
      actual_stock: 10
    });

    approveStockCountSession({
      session_id: session.id
    });

    expect(() =>
      updateStockCountItem({
        session_id: session.id,
        item_id: item.id,
        actual_stock: 9
      })
    ).toThrow('لا يمكن تعديل جرد غير مفتوح');

    expect(() =>
      scanStockCountBarcode({
        session_id: session.id,
        barcode: 'APPROVEDLOCK001'
      })
    ).toThrow('لا يمكن التعديل على جرد غير مفتوح');
  });

  it('cancels open stock count session', () => {
    seedStockCountProduct({
      barcode: 'CANCELCOUNT001',
      openingQty: 10
    });

    const session = createStockCountSession({
      title: 'Cancel Count',
      actor_id: 1
    });

    const result = cancelStockCountSession({
      session_id: session.id,
      actor_id: 1
    });

    expect(result.success).toBe(true);
    expect(result.session_id).toBe(session.id);

    const canceled = getStockCountSession(session.id) as any;

    expect(canceled.session.status).toBe('canceled');
    expect(canceled.session.canceled_by).toBe(1);
    expect(canceled.session.canceled_at).toBeTruthy();
  });

  it('rejects cancelling approved stock count session', () => {
    seedStockCountProduct({
      barcode: 'CANCELAPPROVED001',
      openingQty: 10
    });

    const session = createStockCountSession({
      title: 'Cancel Approved Count'
    });

    const details = getStockCountSession(session.id) as any;
    const item = details.items[0] as StockCountItemTestRow;

    updateStockCountItem({
      session_id: session.id,
      item_id: item.id,
      actual_stock: 10
    });

    approveStockCountSession({
      session_id: session.id
    });

    expect(() =>
      cancelStockCountSession({
        session_id: session.id
      })
    ).toThrow('لا يمكن إلغاء جلسة الجرد');
  });
});