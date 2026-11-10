import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createCategory,
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';
import {
  createPromotion,
  togglePromotion,
  updatePromotion,
} from '../../src/main/database/repositories/promotions.repo';
import {
  cancelSaleReturn,
  createSale,
  createSaleReturn,
} from '../../src/main/database/repositories/sales.repo';
import {
  createSaleExchange,
  getSaleExchangeState,
  cancelSaleExchange,
  listSaleExchanges,
} from '../../src/main/database/repositories/sales-exchange.repo';
import {
  closeCashShift,
  getCashShiftDetails,
  getOpenCashShift,
  openCashShift,
} from '../../src/main/database/repositories/cash-shifts.repo';
import { getSaleCurrentState } from '../../src/main/database/repositories/sales-current-state.repo';
import { getInventoryCostState } from '../../src/main/database/inventory-cost';
import {
  createCashMovement,
  getCashSummary,
} from '../../src/main/database/repositories/cash.repo';
import { createUser } from '../../src/main/database/repositories/user.repo';

type TestVariant = {
  variant_id: number;
  product_id: number;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  sell_price: number;
  stock: number;
};

function seedExchangeCatalog() {
  const promoCategory = createCategory({
    name: 'Exchange Promo Category',
  });

  const otherCategory = createCategory({
    name: 'Exchange Other Category',
  });

  createProduct({
    name: 'Exchange Promo Product',
    category_id: promoCategory.id,
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'EX150',
        size: '150',
        color: 'Black',
        buy_price: 70,
        sell_price: 150,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'EX200',
        size: '200',
        color: 'Black',
        buy_price: 90,
        sell_price: 200,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'EX250',
        size: '250',
        color: 'Black',
        buy_price: 110,
        sell_price: 250,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'EX300',
        size: '300',
        color: 'Black',
        buy_price: 130,
        sell_price: 300,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'EX350',
        size: '350',
        color: 'Black',
        buy_price: 150,
        sell_price: 350,
        min_stock: 1,
        opening_qty: 20,
      },
    ],
  });

  createProduct({
    name: 'Outside Promotion Product',
    category_id: otherCategory.id,
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'OUT999',
        size: '999',
        color: 'White',
        buy_price: 400,
        sell_price: 999,
        min_stock: 1,
        opening_qty: 20,
      },
    ],
  });

  const variants = {
    EX150: getVariantByBarcode('EX150') as TestVariant,
    EX200: getVariantByBarcode('EX200') as TestVariant,
    EX250: getVariantByBarcode('EX250') as TestVariant,
    EX300: getVariantByBarcode('EX300') as TestVariant,
    EX350: getVariantByBarcode('EX350') as TestVariant,
    OUT999: getVariantByBarcode('OUT999') as TestVariant,
  };

  return {
    promoCategoryId: Number(promoCategory.id),
    otherCategoryId: Number(otherCategory.id),
    variants,
  };
}

function createPromotionSale(
  barcodes: Array<'EX150' | 'EX200' | 'EX250' | 'EX300' | 'EX350'>,
) {
  const catalog = seedExchangeCatalog();

  const promotion = createPromotion({
    name: 'Original Buy 2 Get 1',
    type: 'buy_x_get_y',
    value: 0,
    buy_qty: 2,
    free_qty: 1,
    scope_type: 'category',
    category_id: catalog.promoCategoryId,
    product_ids: [],
    actor_id: 1,
  });

  togglePromotion(promotion.promotionId, 1);

  const saleItems = barcodes.map((barcode) => {
    const variant = catalog.variants[barcode];

    return {
      variant_id: variant.variant_id,
      product_name: variant.product_name,
      barcode: variant.barcode,
      size: variant.size,
      color: variant.color,
      quantity: 1,
      unit_price: variant.sell_price,
    };
  });

  const subTotal = saleItems.reduce((sum, item) => sum + item.unit_price, 0);

  const cheapest = Math.min(...saleItems.map((item) => item.unit_price));

  const grandTotal = subTotal - cheapest;

  const sale = createSale({
    user_id: 1,
    customer_id: null,
    promotion_id: promotion.promotionId,
    sub_total: subTotal,
    discount_value: 0,
    grand_total: grandTotal,
    change_amount: 0,
    payment_method: 'cash',
    paid: grandTotal,
    items: saleItems,
  });

  return {
    ...catalog,
    promotionId: promotion.promotionId,
    sale,
  };
}

function getPromotionUnits(saleId: number) {
  return getDb()
    .prepare(
      `
      SELECT *
      FROM sale_promotion_units
      WHERE sale_id = ?
      ORDER BY id ASC
      `,
    )
    .all(saleId) as any[];
}

function getUnitByPrice(saleId: number, price: number) {
  return getPromotionUnits(saleId).find(
    (unit) => Number(unit.current_unit_price) === price,
  );
}

function getStock(barcode: string) {
  return Number((getVariantByBarcode(barcode) as TestVariant)?.stock || 0);
}

function getFullReturnInput(saleId: number) {
  return getDb()
    .prepare(
      `
      SELECT
        id,
        variant_id,
        quantity
      FROM sale_items
      WHERE sale_id = ?
        AND promotion_group_id IS NOT NULL
      ORDER BY id ASC
      `,
    )
    .all(saleId)
    .map((item: any) => ({
      sale_item_id: Number(item.id),
      variant_id: Number(item.variant_id),
      quantity: Number(item.quantity),
    }));
}

function createRegularExchangeSale() {
  const category = createCategory({
    name: 'Regular Exchange Category',
  });

  createProduct({
    name: 'Regular Exchange Product',

    category_id: category.id,

    image_path: null,
    description: null,

    variants: [
      {
        barcode: 'REG100',

        size: 'M',
        color: 'Black',

        buy_price: 50,
        sell_price: 100,

        min_stock: 1,
        opening_qty: 20,
      },

      {
        barcode: 'REG150',

        size: 'L',
        color: 'Blue',

        buy_price: 70,
        sell_price: 150,

        min_stock: 1,
        opening_qty: 20,
      },
    ],
  });

  const oldVariant = getVariantByBarcode('REG100') as TestVariant;

  const newVariant = getVariantByBarcode('REG150') as TestVariant;

  const sale = createSale({
    user_id: 1,

    customer_id: null,

    promotion_id: null,

    sub_total: 100,

    discount_value: 0,

    grand_total: 100,

    paid: 100,

    change_amount: 0,

    payment_method: 'cash',

    items: [
      {
        variant_id: oldVariant.variant_id,

        product_name: oldVariant.product_name,

        barcode: oldVariant.barcode,

        size: oldVariant.size,

        color: oldVariant.color,

        quantity: 1,

        unit_price: 100,
      },
    ],
  });

  const saleItem = getDb()
    .prepare(
      `
        SELECT *
        FROM sale_items
        WHERE sale_id = ?
        LIMIT 1
        `,
    )
    .get(sale.saleId) as any;

  return {
    sale,
    saleItem,
    oldVariant,
    newVariant,
  };
}

describe('sale promotion exchanges', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();

    openCashShift({
      opening_counted_amount: 0,
      opened_by: 1,
    });
  }, 30_000);

  it('exchanges one gift unit and makes the new cheapest unit the gift', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150']);

    const giftUnit = getUnitByPrice(result.sale.saleId, 150);

    expect(giftUnit).toBeTruthy();
    expect(Number(giftUnit.current_is_gift)).toBe(1);

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      reason: 'تغيير الهدية',
      items: [
        {
          promotion_unit_id: Number(giftUnit.id),
          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    });

    expect(exchange.old_group_total).toBe(450);
    expect(exchange.new_group_total).toBe(550);
    expect(exchange.difference_amount).toBe(100);
    expect(exchange.amount_to_collect).toBe(100);
    expect(exchange.amount_to_refund).toBe(0);

    const units = getPromotionUnits(result.sale.saleId);

    expect(
      units
        .map((unit) => Number(unit.current_unit_price))
        .sort((a, b) => a - b),
    ).toEqual([200, 250, 300]);

    const currentGift = units.find(
      (unit) => Number(unit.current_is_gift) === 1,
    );

    expect(Number(currentGift.current_unit_price)).toBe(200);

    expect(getStock('EX150')).toBe(20);
    expect(getStock('EX300')).toBe(19);

    const cashMovement = getDb()
      .prepare(
        `
        SELECT *
        FROM cash_movements
        WHERE reference_type = 'sale_exchange'
          AND reference_id = ?
        LIMIT 1
        `,
      )
      .get(exchange.exchangeId) as any;

    expect(cashMovement.direction).toBe('in');
    expect(Number(cashMovement.amount)).toBe(100);
    const storeCashExchanges = listSaleExchanges({
      payment_method: 'store_cash',
    });

    expect(storeCashExchanges.total).toBe(1);
    expect(Number(storeCashExchanges.rows[0].id)).toBe(exchange.exchangeId);

    const bankExchanges = listSaleExchanges({
      payment_method: 'owner_bank',
    });

    expect(bankExchanges.total).toBe(0);
  });

  it('applies an active percentage promotion to a replacement product', () => {
    const result = createRegularExchangeSale();

    /*
     * الفاتورة الأصلية = 100 جنيه.
     * المنتج البديل = 150 جنيه.
     * العرض الجديد = خصم 20% على البديل.
     *
     * السعر بعد العرض = 120.
     * فرق الاستبدال المطلوب = 20.
     */
    createProduct({
      name: 'Active Exchange Promotion Replacement',
      category_id: null,
      image_path: null,
      description: null,
      variants: [
        {
          barcode: 'EX-ACTIVE-PROMO-150',
          size: 'M',
          color: 'Blue',
          buy_price: 70,
          sell_price: 150,
          min_stock: 1,
          opening_qty: 20,
        },
      ],
    });

    const replacement = getVariantByBarcode('EX-ACTIVE-PROMO-150')!;

    /*
     * تفعيل العرض بعد إنشاء الفاتورة،
     * حتى لا يؤثر بأثر رجعي على البيع القديم.
     */
    const promotion = createPromotion({
      name: 'Replacement Product 20 Percent',
      type: 'percent',
      value: 20,
      scope_type: 'products',
      category_id: null,
      product_ids: [replacement.product_id],
      actor_id: 1,
    });

    togglePromotion(promotion.promotionId, 1);

    const state = getSaleExchangeState(result.sale.saleId);

    const regularGroup = state.groups.find(
      (group: any) => group.group_kind === 'regular',
    );

    expect(regularGroup).toBeTruthy();

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(regularGroup!.units[0].id),
          new_variant_id: replacement.variant_id,
        },
      ],
    });

    // السعر القديم 100، الجديد بعد العرض 120.
    expect(exchange.difference_amount).toBe(20);
    expect(exchange.amount_to_collect).toBe(20);

    const exchangeRow = getDb()
      .prepare(
        `
      SELECT
        new_promotion_discount_value,
        new_invoice_grand_total
      FROM sale_exchanges
      WHERE id = ?
    `,
      )
      .get(exchange.exchangeId) as {
      new_promotion_discount_value: number;
      new_invoice_grand_total: number;
    };

    expect(Number(exchangeRow.new_promotion_discount_value)).toBe(30);

    expect(Number(exchangeRow.new_invoice_grand_total)).toBe(120);

    const current = getSaleCurrentState(result.sale.saleId);

    const updatedExchangeState = getSaleExchangeState(result.sale.saleId);

    const updatedRegularGroup = updatedExchangeState.groups.find(
      (group: any) => group.group_kind === 'regular',
    );

    expect(updatedRegularGroup).toBeTruthy();

    expect(
      Number(updatedRegularGroup!.units[0].effective_promotion_discount_value),
    ).toBe(30);

    expect(Number(current.financials.current_promotion_discount_value)).toBe(
      30,
    );

    expect(Number(current.financials.net_grand_total)).toBe(120);

    // إلغاء الاستبدال يرجع الفاتورة الأصلية بالكامل.
    cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Restore original promotion state',
    });

    const restored = getSaleCurrentState(result.sale.saleId);

    expect(Number(restored.financials.current_promotion_discount_value)).toBe(
      0,
    );

    expect(Number(restored.financials.net_grand_total)).toBe(100);
  });

  it('exchanges a regular invoice item without a promotion', () => {
    const result = createRegularExchangeSale();

    const state = getSaleExchangeState(result.sale.saleId);

    expect(state.snapshot).toBeNull();

    const regularGroup = state.groups.find(
      (group: any) => group.group_kind === 'regular',
    );

    expect(regularGroup).toBeTruthy();

    if (!regularGroup) {
      throw new Error('Regular exchange group was not created');
    }

    expect(regularGroup.units).toHaveLength(1);

    const unit = regularGroup.units[0];

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      reason: 'تغيير مقاس',

      items: [
        {
          promotion_unit_id: Number(unit.id),

          new_variant_id: result.newVariant.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(50);

    expect(exchange.amount_to_collect).toBe(50);

    expect(getStock('REG100')).toBe(20);

    expect(getStock('REG150')).toBe(19);

    const current = getSaleCurrentState(result.sale.saleId);

    expect(
      current.current_receipt.items.some(
        (item: any) =>
          Number(item.variant_id) === Number(result.newVariant.variant_id),
      ),
    ).toBe(true);

    const cashMovement = getDb()
      .prepare(
        `
          SELECT *
          FROM cash_movements
          WHERE
            reference_type =
              'sale_exchange'

            AND
              reference_id = ?
          LIMIT 1
          `,
      )
      .get(exchange.exchangeId) as any;

    expect(cashMovement.direction).toBe('in');

    expect(Number(cashMovement.amount)).toBe(50);
  });

  it('preserves inventory values through a regular exchange and its cancellation', () => {
    const result = createRegularExchangeSale();

    const state = getSaleExchangeState(result.sale.saleId);

    const regularGroup = state.groups.find(
      (group: any) => group.group_kind === 'regular',
    );

    if (!regularGroup) {
      throw new Error('Regular exchange group was not created');
    }

    const unit = regularGroup.units[0];

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      reason: 'Cost snapshot test',

      items: [
        {
          promotion_unit_id: Number(unit.id),

          new_variant_id: result.newVariant.variant_id,
        },
      ],
    });

    const db = getDb();

    const exchangeItem = db
      .prepare(
        `
      SELECT *

      FROM sale_exchange_items

      WHERE exchange_id = ?

      LIMIT 1
      `,
      )
      .get(exchange.exchangeId) as any;

    expect(Number(exchangeItem.old_unit_cost)).toBe(50);

    expect(Number(exchangeItem.new_unit_cost)).toBe(70);

    let oldState = getInventoryCostState(db, result.oldVariant.variant_id);

    let newState = getInventoryCostState(db, result.newVariant.variant_id);

    /*
     * REG100:
     * بدأ 20×50
     * البيع خرج 1
     * الاستبدال رجعه
     */
    expect(oldState.stock).toBe(20);

    expect(oldState.inventory_value).toBe(1000);

    /*
     * REG150:
     * بدأ 20×70
     * الاستبدال خرج 1
     */
    expect(newState.stock).toBe(19);

    expect(newState.inventory_value).toBe(1330);

    cancelSaleExchange({
      exchange_id: exchange.exchangeId,

      actor_id: 1,

      reason: 'Undo cost test',
    });

    oldState = getInventoryCostState(db, result.oldVariant.variant_id);

    newState = getInventoryCostState(db, result.newVariant.variant_id);

    /*
     * رجعنا بالضبط للحالة
     * التي كانت بعد البيع وقبل الاستبدال.
     */
    expect(oldState.stock).toBe(19);

    expect(oldState.inventory_value).toBe(950);

    expect(oldState.average_cost).toBe(50);

    expect(newState.stock).toBe(20);

    expect(newState.inventory_value).toBe(1400);

    expect(newState.average_cost).toBe(70);
  });

  it('returns the current replacement item after a regular exchange', () => {
    const result = createRegularExchangeSale();

    const state = getSaleExchangeState(result.sale.saleId);

    const regularGroup = state.groups.find(
      (group: any) => group.group_kind === 'regular',
    );

    if (!regularGroup) {
      throw new Error('Regular exchange group was not created');
    }

    const unit = regularGroup.units[0];

    createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      items: [
        {
          promotion_unit_id: Number(unit.id),

          new_variant_id: result.newVariant.variant_id,
        },
      ],
    });

    const saleReturn = createSaleReturn({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      refund_payment_method: 'store_cash',

      reason: 'مرتجع بعد الاستبدال',

      items: [
        {
          sale_item_id: Number(result.saleItem.id),

          variant_id: Number(result.newVariant.variant_id),

          quantity: 1,
        },
      ],
    });

    expect(saleReturn.return_value).toBe(150);

    expect(getStock('REG100')).toBe(20);

    expect(getStock('REG150')).toBe(20);

    const returnItem = getDb()
      .prepare(
        `
          SELECT *
          FROM sale_return_items
          WHERE return_id = ?
          LIMIT 1
          `,
      )
      .get(saleReturn.returnId) as any;

    expect(Number(returnItem.variant_id)).toBe(result.newVariant.variant_id);

    expect(Number(returnItem.promotion_unit_id)).toBeGreaterThan(0);
  });

  it('refunds the promotion-adjusted replacement price after a regular exchange', () => {
    const result = createRegularExchangeSale();

    /*
     * الفاتورة الأصلية = 100
     * البديل = 150
     * خصم العرض = 30
     * سعر البديل الفعلي = 120
     */
    const promotion = createPromotion({
      name: 'Exchange Return 20 Percent',
      type: 'percent',
      value: 20,
      scope_type: 'products',
      category_id: null,
      product_ids: [result.newVariant.product_id],
      actor_id: 1,
    });

    togglePromotion(promotion.promotionId, 1);

    const state = getSaleExchangeState(result.sale.saleId);

    const regularGroup = state.groups.find(
      (group: any) => group.group_kind === 'regular',
    );

    if (!regularGroup) {
      throw new Error('Regular exchange group missing');
    }

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(regularGroup.units[0].id),
          new_variant_id: result.newVariant.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(20);

    /*
     * نوفر رصيدًا إضافيًا للصندوق في الاختبار
     * لعزل صحة قيمة المرتجع عن فحص الرصيد.
     */
    const shift = getOpenCashShift();

    if (!shift) {
      throw new Error('Open shift missing');
    }

    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 100,
      payment_method: 'store_cash',
      created_by: 1,
      shift_id: shift.id,
      notes: 'Return promotion regression test float',
    });

    const saleReturn = createSaleReturn({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      reason: 'Return discounted replacement',
      items: [
        {
          sale_item_id: Number(result.saleItem.id),
          variant_id: result.newVariant.variant_id,
          quantity: 1,
        },
      ],
    });

    const returnRow = getDb()
      .prepare(
        `
        SELECT
          sub_total,
          promotion_discount_value,
          refund_amount
        FROM sale_returns
        WHERE id = ?
      `,
      )
      .get(saleReturn.returnId) as any;

    expect(Number(returnRow.sub_total)).toBe(150);

    expect(Number(returnRow.promotion_discount_value)).toBe(30);

    expect(Number(returnRow.refund_amount)).toBe(120);

    expect(saleReturn.return_value).toBe(120);

    const returnItem = getDb()
      .prepare(
        `
        SELECT promotion_discount_value
        FROM sale_return_items
        WHERE return_id = ?
        LIMIT 1
      `,
      )
      .get(saleReturn.returnId) as any;

    expect(Number(returnItem.promotion_discount_value)).toBe(30);

    /*
     * الرصيد:
     * بيع 100 + استبدال 20 + إيداع 100
     * - مرتجع 120 = 100
     */
    expect(
      getCashSummary({
        payment_method: 'store_cash',
      }).balance,
    ).toBe(100);

    // بعد المرتجع: الفاتورة تمت تسويتها بالكامل.
    const afterReturn = getSaleCurrentState(result.sale.saleId);

    expect(
      Number(afterReturn.financials.current_promotion_discount_value),
    ).toBe(30);

    expect(Number(afterReturn.financials.total_return_value)).toBe(120);

    expect(Number(afterReturn.financials.net_grand_total)).toBe(0);

    // إلغاء المرتجع يعيد البديل إلى الفاتورة.
    cancelSaleReturn({
      return_id: saleReturn.returnId,
      actor_id: 1,
      reason: 'Restore discounted replacement return',
    });

    const restored = getSaleCurrentState(result.sale.saleId);

    expect(Number(restored.financials.current_promotion_discount_value)).toBe(
      30,
    );

    expect(Number(restored.financials.total_return_value)).toBe(0);

    expect(Number(restored.financials.net_grand_total)).toBe(120);

    // التأكد من إعادة إتاحة القطعة للاستبدال والمرتجع.
    const restoredExchangeState = getSaleExchangeState(result.sale.saleId);

    const restoredRegularGroup = restoredExchangeState.groups.find(
      (group: any) => group.group_kind === 'regular',
    );

    expect(restoredRegularGroup).toBeTruthy();

    expect(Number(restoredRegularGroup!.units[0].is_returned)).toBe(0);

    expect(
      Number(restoredRegularGroup!.units[0].effective_promotion_discount_value),
    ).toBe(30);

    // القديم رجع للمخزون وقت الاستبدال.
    expect(getStock('REG100')).toBe(20);

    // البديل اترد للمخزون ثم خرج تاني عند إلغاء المرتجع.
    expect(getStock('REG150')).toBe(19);

    /*
     * رصيد الصندوق:
     * بيع 100 + استبدال 20 + إيداع 100
     * - مرتجع 120 + إلغاء المرتجع 120
     * = 220
     */
    expect(
      getCashSummary({
        payment_method: 'store_cash',
      }).balance,
    ).toBe(220);

    const cancelledReturn = getDb()
      .prepare(
        `
        SELECT cancelled_at
        FROM sale_returns
        WHERE id = ?
      `,
      )
      .get(saleReturn.returnId) as {
      cancelled_at: string | null;
    };

    expect(cancelledReturn.cancelled_at).not.toBeNull();
  });

  it('requires an open shift and links exchange cash movement to the current shift', () => {
    const db = getDb();

    const result = createPromotionSale(['EX250', 'EX200', 'EX150']);

    const originalShift = getOpenCashShift();

    expect(originalShift).toBeTruthy();

    closeCashShift({
      shift_id: originalShift!.id,
      closing_counted_amount: 450,
      left_for_next_shift: 450,
      closed_by: 1,
    });

    const giftUnit = getUnitByPrice(result.sale.saleId, 150);

    expect(() =>
      createSaleExchange({
        original_sale_id: result.sale.saleId,
        user_id: 1,
        payment_method: 'store_cash',
        items: [
          {
            promotion_unit_id: Number(giftUnit.id),
            new_variant_id: result.variants.EX300.variant_id,
          },
        ],
      }),
    ).toThrow('لا يمكن تسجيل استبدال بدون شفت مفتوح');

    const currentShift = openCashShift({
      opening_counted_amount: 450,
      opened_by: 1,
    });

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      reason: 'استبدال في شفت جديد',

      items: [
        {
          promotion_unit_id: Number(giftUnit.id),

          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    });

    expect(exchange.shift_id).toBe(currentShift.id);

    expect(exchange.shift_id).not.toBe(originalShift!.id);

    const exchangeRow = db
      .prepare(
        `
        SELECT shift_id
        FROM sale_exchanges
        WHERE id = ?
      `,
      )
      .get(exchange.exchangeId) as {
      shift_id: number;
    };

    expect(exchangeRow.shift_id).toBe(currentShift.id);

    const cashMovement = db
      .prepare(
        `
        SELECT shift_id
        FROM cash_movements
        WHERE reference_type =
          'sale_exchange'
          AND reference_id = ?
        LIMIT 1
      `,
      )
      .get(exchange.exchangeId) as {
      shift_id: number;
    };

    expect(cashMovement.shift_id).toBe(currentShift.id);
  });

  it('uses the original promotion scope even after the live promotion changes', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150']);

    updatePromotion({
      id: result.promotionId,
      name: 'Changed Promotion',
      type: 'buy_x_get_y',
      value: 0,
      buy_qty: 3,
      free_qty: 1,
      scope_type: 'category',
      category_id: result.otherCategoryId,
      product_ids: [],
      actor_id: 1,
    });

    const giftUnit = getUnitByPrice(result.sale.saleId, 150);

    expect(() =>
      createSaleExchange({
        original_sale_id: result.sale.saleId,
        user_id: 1,
        items: [
          {
            promotion_unit_id: Number(giftUnit.id),
            new_variant_id: result.variants.OUT999.variant_id,
          },
        ],
      }),
    ).toThrow('الصنف البديل خارج نطاق العرض الأصلي');

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(giftUnit.id),
          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(100);
  });

  it('supports exchanging the same promotion unit more than once', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150']);

    const giftUnit = getUnitByPrice(result.sale.saleId, 150);

    const firstExchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(giftUnit.id),
          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    });

    expect(firstExchange.difference_amount).toBe(100);

    const secondExchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(giftUnit.id),
          new_variant_id: result.variants.EX350.variant_id,
        },
      ],
    });

    expect(secondExchange.old_group_total).toBe(550);
    expect(secondExchange.new_group_total).toBe(600);
    expect(secondExchange.difference_amount).toBe(50);

    const currentUnit = getPromotionUnits(result.sale.saleId).find(
      (unit) => Number(unit.id) === Number(giftUnit.id),
    );

    expect(Number(currentUnit.current_variant_id)).toBe(
      result.variants.EX350.variant_id,
    );

    const exchangeCount = getDb()
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM sale_exchanges
        WHERE original_sale_id = ?
        `,
      )
      .get(result.sale.saleId) as any;

    expect(Number(exchangeCount.count)).toBe(2);
  });

  it('allows one unit or the whole bundle but rejects two units', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150']);

    const units = getPromotionUnits(result.sale.saleId);

    expect(units).toHaveLength(3);

    expect(() =>
      createSaleExchange({
        original_sale_id: result.sale.saleId,
        user_id: 1,
        items: [
          {
            promotion_unit_id: Number(units[0].id),
            new_variant_id: result.variants.EX300.variant_id,
          },
          {
            promotion_unit_id: Number(units[1].id),
            new_variant_id: result.variants.EX350.variant_id,
          },
        ],
      }),
    ).toThrow('الاستبدال داخل العرض مسموح لقطعة واحدة أو العرض كاملًا فقط');

    const wholeBundleItems = units.map((unit) => {
      const price = Number(unit.current_unit_price);

      let newVariantId = result.variants.EX300.variant_id;

      if (price === 200) {
        newVariantId = result.variants.EX350.variant_id;
      }

      if (price === 150) {
        newVariantId = result.variants.EX250.variant_id;
      }

      return {
        promotion_unit_id: Number(unit.id),
        new_variant_id: newVariantId,
      };
    });

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: wholeBundleItems,
    });

    expect(exchange.old_group_total).toBe(450);
    expect(exchange.new_group_total).toBe(650);
    expect(exchange.difference_amount).toBe(200);
  });

  it('refunds the difference when the recalculated bundle becomes cheaper', () => {
    const result = createPromotionSale(['EX300', 'EX250', 'EX200']);

    const unit300 = getUnitByPrice(result.sale.saleId, 300);

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(unit300.id),
          new_variant_id: result.variants.EX150.variant_id,
        },
      ],
    });

    expect(exchange.old_group_total).toBe(550);
    expect(exchange.new_group_total).toBe(450);
    expect(exchange.difference_amount).toBe(-100);
    expect(exchange.amount_to_collect).toBe(0);
    expect(exchange.amount_to_refund).toBe(100);

    const cashMovement = getDb()
      .prepare(
        `
        SELECT *
        FROM cash_movements
        WHERE reference_type = 'sale_exchange'
          AND reference_id = ?
        LIMIT 1
        `,
      )
      .get(exchange.exchangeId) as any;

    expect(cashMovement.direction).toBe('out');
    expect(Number(cashMovement.amount)).toBe(100);
  });

  it('returns the current bundle after an exchange and restores its state when the return is cancelled', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150']);

    const giftUnit = getUnitByPrice(result.sale.saleId, 150);

    createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      items: [
        {
          promotion_unit_id: Number(giftUnit.id),
          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    });

    const saleReturn = createSaleReturn({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: getFullReturnInput(result.sale.saleId),
    });

    expect(saleReturn.return_value).toBe(550);

    const returnedUnits = getPromotionUnits(result.sale.saleId);

    expect(returnedUnits.every((unit) => Number(unit.is_returned) === 1)).toBe(
      true,
    );

    const returnItems = getDb()
      .prepare(
        `
        SELECT *
        FROM sale_return_items
        WHERE return_id = ?
        ORDER BY id ASC
        `,
      )
      .all(saleReturn.returnId) as any[];

    expect(returnItems).toHaveLength(3);

    expect(
      returnItems.every((item) => Number(item.promotion_unit_id) > 0),
    ).toBe(true);

    expect(
      returnItems.map((item) => Number(item.unit_price)).sort((a, b) => a - b),
    ).toEqual([200, 250, 300]);

    expect(getStock('EX150')).toBe(20);
    expect(getStock('EX200')).toBe(20);
    expect(getStock('EX250')).toBe(20);
    expect(getStock('EX300')).toBe(20);

    cancelSaleReturn({
      return_id: saleReturn.returnId,
      reason: 'اختبار إلغاء المرتجع',
      actor_id: 1,
    });

    const restoredUnits = getPromotionUnits(result.sale.saleId);

    expect(restoredUnits.every((unit) => Number(unit.is_returned) === 0)).toBe(
      true,
    );

    expect(getStock('EX150')).toBe(20);
    expect(getStock('EX200')).toBe(19);
    expect(getStock('EX250')).toBe(19);
    expect(getStock('EX300')).toBe(19);
  });

  it('exposes the current exchange state for the future UI', () => {
    const result = createPromotionSale(['EX250', 'EX200', 'EX150']);

    const state = getSaleExchangeState(result.sale.saleId);

    expect(state.snapshot).toBeTruthy();

    if (!state.snapshot) {
      throw new Error('Promotion snapshot is missing');
    }

    expect(state.snapshot.promotion_type).toBe('buy_x_get_y');

    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].units).toHaveLength(3);
  });

  it('returns both current variants correctly after partially exchanging a quantity-two discounted item', () => {
    createProduct({
      name: 'Partial Product Discount Exchange',

      category_id: null,

      image_path: null,

      description: null,

      variants: [
        {
          barcode: 'PD-OLD',

          size: 'Old',
          color: 'Black',

          buy_price: 100,

          sell_price: 190,
          discount_price: 150,

          min_stock: 1,

          opening_qty: 20,
        },

        {
          barcode: 'PD-NEW',

          size: 'New',
          color: 'Blue',

          buy_price: 120,

          sell_price: 250,
          discount_price: 180,

          min_stock: 1,

          opening_qty: 20,
        },
      ],
    });

    const oldVariant = getVariantByBarcode('PD-OLD') as any;

    const newVariant = getVariantByBarcode('PD-NEW') as any;

    const sale = createSale({
      user_id: 1,

      customer_id: null,

      sub_total: 300,

      discount_value: 0,

      grand_total: 300,

      change_amount: 0,

      payment_method: 'store_cash',

      paid: 300,

      items: [
        {
          variant_id: oldVariant.variant_id,

          product_name: oldVariant.product_name,

          barcode: oldVariant.barcode,

          size: oldVariant.size,

          color: oldVariant.color,

          quantity: 2,

          unit_price: 150,

          list_unit_price: 190,
        },
      ],
    });

    const receipt = getDb()
      .prepare(
        `
        SELECT *
        FROM sale_items
        WHERE sale_id = ?
        LIMIT 1
        `,
      )
      .get(sale.saleId) as any;

    const exchangeState = getSaleExchangeState(sale.saleId);

    const regularUnits = exchangeState.groups
      .filter((group: any) => group.group_kind === 'regular')
      .flatMap((group: any) => group.units)
      .filter(
        (unit: any) =>
          Number(unit.original_sale_item_id) === Number(receipt.id),
      );

    expect(regularUnits).toHaveLength(2);

    const unitToExchange = regularUnits[0];

    if (!unitToExchange) {
      throw new Error('Regular exchange unit was not created');
    }

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      items: [
        {
          promotion_unit_id: Number(unitToExchange.id),

          new_variant_id: Number(newVariant.variant_id),
        },
      ],
    });

    /*
     * Actual price:
     * 150 -> 180
     */
    expect(Number(exchange.difference_amount)).toBe(30);

    const current = getSaleCurrentState(sale.saleId);

    expect(Number(current.sale.list_sub_total)).toBe(440);

    expect(Number(current.sale.sub_total)).toBe(330);

    expect(Number(current.sale.product_discount_value)).toBe(110);

    expect(Number(current.sale.grand_total)).toBe(330);

    const oldCurrent = current.current_receipt.items.find(
      (item: any) => Number(item.variant_id) === Number(oldVariant.variant_id),
    );

    const newCurrent = current.current_receipt.items.find(
      (item: any) => Number(item.variant_id) === Number(newVariant.variant_id),
    );

    expect(oldCurrent).toBeTruthy();

    expect(newCurrent).toBeTruthy();

    expect(Number(oldCurrent.quantity)).toBe(1);

    expect(Number(newCurrent.quantity)).toBe(1);

    /*
     * الاتنين مربوطين بنفس Sale Item الأصلي،
     * لكن Variant مختلف.
     *
     * ده السيناريو اللي كان ممكن الـUI
     * يدمج واحد منهم بالغلط.
     */
    expect(Number(oldCurrent.id)).toBe(Number(receipt.id));

    expect(Number(newCurrent.id)).toBe(Number(receipt.id));

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,

      user_id: 1,

      refund_payment_method: 'store_cash',

      items: [
        {
          sale_item_id: Number(receipt.id),

          variant_id: Number(oldVariant.variant_id),

          quantity: 1,
        },

        {
          sale_item_id: Number(receipt.id),

          variant_id: Number(newVariant.variant_id),

          quantity: 1,
        },
      ],
    });

    expect(Number(saleReturn.return_value)).toBe(330);

    const returnRow = getDb()
      .prepare(
        `
        SELECT
          sub_total,
          list_sub_total,
          product_discount_value,
          refund_amount

        FROM sale_returns

        WHERE id = ?
        `,
      )
      .get(saleReturn.returnId) as any;

    expect(Number(returnRow.sub_total)).toBe(330);

    expect(Number(returnRow.list_sub_total)).toBe(440);

    expect(Number(returnRow.product_discount_value)).toBe(110);

    expect(Number(returnRow.refund_amount)).toBe(330);

    const returnItems = getDb()
      .prepare(
        `
        SELECT
          variant_id,
          unit_price,
          list_unit_price,
          product_discount_value

        FROM sale_return_items

        WHERE return_id = ?

        ORDER BY unit_price ASC
        `,
      )
      .all(saleReturn.returnId) as any[];

    expect(returnItems).toHaveLength(2);

    expect(
      returnItems.map((item) => ({
        variant_id: Number(item.variant_id),

        unit_price: Number(item.unit_price),

        list_unit_price: Number(item.list_unit_price),

        product_discount: Number(item.product_discount_value),
      })),
    ).toEqual([
      {
        variant_id: Number(oldVariant.variant_id),

        unit_price: 150,

        list_unit_price: 190,

        product_discount: 40,
      },

      {
        variant_id: Number(newVariant.variant_id),

        unit_price: 180,

        list_unit_price: 250,

        product_discount: 70,
      },
    ]);
  });

  it('does not carry the old product discount to an undiscounted replacement', () => {
    createProduct({
      name: 'Exchange Discount Isolation',

      category_id: null,
      image_path: null,
      description: null,

      variants: [
        {
          barcode: 'DISC-OLD-150',
          size: 'Old',
          color: 'Black',
          buy_price: 90,
          sell_price: 190,
          discount_price: 150,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'DISC-NEW-200',
          size: 'New',
          color: 'Blue',
          buy_price: 110,
          sell_price: 200,
          min_stock: 1,
          opening_qty: 10,
        },
      ],
    });

    const oldVariant = getVariantByBarcode('DISC-OLD-150')!;

    const newVariant = getVariantByBarcode('DISC-NEW-200')!;

    const sale = createSale({
      user_id: 1,
      customer_id: null,

      sub_total: 150,
      discount_value: 0,
      grand_total: 150,

      paid: 150,
      change_amount: 0,
      payment_method: 'store_cash',

      items: [
        {
          variant_id: oldVariant.variant_id,
          product_name: oldVariant.product_name,
          barcode: oldVariant.barcode,
          size: oldVariant.size,
          color: oldVariant.color,
          quantity: 1,
          unit_price: 150,
          list_unit_price: 190,
        },
      ],
    });

    const state = getSaleExchangeState(sale.saleId);

    const regularGroup = state.groups.find(
      (group: any) => group.group_kind === 'regular',
    );

    if (!regularGroup) {
      throw new Error('Regular exchange group missing');
    }

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',

      items: [
        {
          promotion_unit_id: Number(regularGroup.units[0].id),
          new_variant_id: newVariant.variant_id,
        },
      ],
    });

    // القديم: 190 - 40 = 150
    // الجديد: 200 بدون خصم
    // الفرق الصحيح: 200 - 150 = 50
    expect(exchange.difference_amount).toBe(50);
    expect(exchange.amount_to_collect).toBe(50);

    const current = getSaleCurrentState(sale.saleId);

    expect(Number(current.financials.current_sub_total)).toBe(200);

    expect(Number(current.financials.current_product_discount_value)).toBe(0);

    expect(Number(current.financials.net_grand_total)).toBe(200);

    const exchangeRow = getDb()
      .prepare(
        `
        SELECT
          old_product_discount_value,
          new_product_discount_value
        FROM sale_exchanges
        WHERE id = ?
      `,
      )
      .get(exchange.exchangeId) as any;

    expect(Number(exchangeRow.old_product_discount_value)).toBe(40);

    expect(Number(exchangeRow.new_product_discount_value)).toBe(0);

    // الإلغاء يعيد سعر وخصم المنتج الأصلي فقط.
    cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Restore original product discount',
    });

    const restored = getSaleCurrentState(sale.saleId);

    expect(Number(restored.financials.current_sub_total)).toBe(150);

    expect(Number(restored.financials.current_product_discount_value)).toBe(40);

    expect(Number(restored.financials.net_grand_total)).toBe(150);
  });

  it('does not transfer an original invoice discount to a replacement', () => {
    createProduct({
      name: 'Invoice Discount Exchange Isolation',
      category_id: null,
      image_path: null,
      description: null,
      variants: [
        {
          barcode: 'INV-DISC-OLD',
          size: 'Old',
          color: 'Black',
          buy_price: 100,
          sell_price: 200,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'INV-DISC-NEW',
          size: 'New',
          color: 'Blue',
          buy_price: 120,
          sell_price: 250,
          min_stock: 1,
          opening_qty: 10,
        },
      ],
    });

    const oldVariant = getVariantByBarcode('INV-DISC-OLD')!;
    const newVariant = getVariantByBarcode('INV-DISC-NEW')!;

    // فاتورة قديمة: 200 - 40 خصم فاتورة = 160
    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 200,
      discount_value: 40,
      grand_total: 160,
      paid: 160,
      change_amount: 0,
      payment_method: 'store_cash',
      items: [
        {
          variant_id: oldVariant.variant_id,
          product_name: oldVariant.product_name,
          barcode: oldVariant.barcode,
          size: oldVariant.size,
          color: oldVariant.color,
          quantity: 1,
          unit_price: 200,
        },
      ],
    });

    const state = getSaleExchangeState(sale.saleId);

    const regularGroup = state.groups.find(
      (group: any) => group.group_kind === 'regular',
    );

    if (!regularGroup) {
      throw new Error('Regular exchange group missing');
    }

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(regularGroup.units[0].id),
          new_variant_id: newVariant.variant_id,
        },
      ],
    });

    // القديم كان صافي سعره 160، والبديل سعره 250.
    expect(exchange.difference_amount).toBe(90);
    expect(exchange.amount_to_collect).toBe(90);

    const current = getSaleCurrentState(sale.saleId);

    expect(Number(current.financials.current_sub_total)).toBe(250);

    expect(Number(current.financials.current_normal_discount_value)).toBe(0);

    expect(Number(current.financials.net_grand_total)).toBe(250);

    const exchangeRow = getDb()
      .prepare(
        `
        SELECT
          old_normal_discount_value,
          new_normal_discount_value
        FROM sale_exchanges
        WHERE id = ?
      `,
      )
      .get(exchange.exchangeId) as any;

    expect(Number(exchangeRow.old_normal_discount_value)).toBe(40);

    expect(Number(exchangeRow.new_normal_discount_value)).toBe(0);

    // إلغاء الاستبدال يرجع الخصم الأصلي.
    cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Restore original invoice discount',
    });

    const restored = getSaleCurrentState(sale.saleId);

    expect(Number(restored.financials.current_normal_discount_value)).toBe(40);

    expect(Number(restored.financials.net_grand_total)).toBe(160);
  });

  it('keeps only the unchanged item share of an original invoice discount', () => {
    createProduct({
      name: 'Multi Item Invoice Discount Exchange',
      category_id: null,
      image_path: null,
      description: null,
      variants: [
        {
          barcode: 'INVM-OLD200',
          size: 'Old',
          color: 'Black',
          buy_price: 100,
          sell_price: 200,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'INVM-OTHER100',
          size: 'Other',
          color: 'White',
          buy_price: 50,
          sell_price: 100,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'INVM-NEW250',
          size: 'New',
          color: 'Blue',
          buy_price: 120,
          sell_price: 250,
          min_stock: 1,
          opening_qty: 10,
        },
      ],
    });

    const oldVariant = getVariantByBarcode('INVM-OLD200')!;
    const otherVariant = getVariantByBarcode('INVM-OTHER100')!;
    const newVariant = getVariantByBarcode('INVM-NEW250')!;

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 40,
      grand_total: 260,
      paid: 260,
      change_amount: 0,
      payment_method: 'store_cash',
      items: [
        {
          variant_id: oldVariant.variant_id,
          product_name: oldVariant.product_name,
          barcode: oldVariant.barcode,
          size: oldVariant.size,
          color: oldVariant.color,
          quantity: 1,
          unit_price: 200,
        },
        {
          variant_id: otherVariant.variant_id,
          product_name: otherVariant.product_name,
          barcode: otherVariant.barcode,
          size: otherVariant.size,
          color: otherVariant.color,
          quantity: 1,
          unit_price: 100,
        },
      ],
    });

    const state = getSaleExchangeState(sale.saleId);

    const oldGroup = state.groups.find(
      (group: any) =>
        group.group_kind === 'regular' &&
        Number(group.units[0]?.current_variant_id) ===
          Number(oldVariant.variant_id),
    );

    expect(oldGroup).toBeTruthy();

    /*
     * قبل تنفيذ الاستبدال، الـBackend
     * يقدر يحسب خصم الفاتورة المتبقي.
     *
     * الخصم الأصلي = 40
     * نصيب القطعة التي ستظل = 13
     */
    expect(Number(oldGroup!.retained_normal_discount_after_exchange)).toBe(13);

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(oldGroup!.units[0].id),
          new_variant_id: newVariant.variant_id,
        },
      ],
    });

    /*
     * خصم الفاتورة الأصلي = 40
     *
     * نصيب القطعة القديمة = 26.67
     * نصيب القطعة المتبقية = 13.33
     *
     * التقريب النقدي المعتمد:
     * الخصم المتبقي = 13
     *
     * إجمالي الفاتورة الجديد:
     * 250 + 100 - 13 = 337
     *
     * فرق الاستبدال:
     * 337 - 260 = 77
     */
    expect(exchange.difference_amount).toBe(77);
    expect(exchange.amount_to_collect).toBe(77);

    const current = getSaleCurrentState(sale.saleId);

    expect(Number(current.financials.current_normal_discount_value)).toBe(13);

    expect(Number(current.financials.net_grand_total)).toBe(337);

    // القطعة التي لم تتبدل تستحق نصيبها الأصلي من الخصم.
    const otherItem = getDb()
      .prepare(
        `
        SELECT id
        FROM sale_items
        WHERE sale_id = ?
          AND variant_id = ?
        LIMIT 1
      `,
      )
      .get(sale.saleId, otherVariant.variant_id) as {
      id: number;
    };

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: otherItem.id,
          variant_id: otherVariant.variant_id,
          quantity: 1,
        },
      ],
    });

    // القطعة المتبقية نصيبها 13 جنيه خصم.
    // المستحق عند إرجاعها = 100 - 13 = 87.
    expect(saleReturn.return_value).toBe(87);

    const returnRow = getDb()
      .prepare(
        `
        SELECT normal_discount_value
        FROM sale_returns
        WHERE id = ?
      `,
      )
      .get(saleReturn.returnId) as {
      normal_discount_value: number;
    };

    expect(Number(returnRow.normal_discount_value)).toBe(13);

    cancelSaleReturn({
      return_id: saleReturn.returnId,
      actor_id: 1,
      reason: 'Restore unchanged item',
    });

    cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Restore original invoice',
    });

    const restored = getSaleCurrentState(sale.saleId);

    expect(Number(restored.financials.current_normal_discount_value)).toBe(40);

    expect(Number(restored.financials.net_grand_total)).toBe(260);
  });

  it('allocates invoice discount remainder to the 120-pound item', () => {
    createProduct({
      name: 'Invoice Discount Remainder Test',
      category_id: null,
      image_path: null,
      description: null,
      variants: [
        {
          barcode: 'ALLOC-100-A',
          size: 'A',
          color: 'Black',
          buy_price: 50,
          sell_price: 100,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'ALLOC-100-B',
          size: 'B',
          color: 'Black',
          buy_price: 50,
          sell_price: 100,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'ALLOC-120',
          size: 'C',
          color: 'Black',
          buy_price: 60,
          sell_price: 120,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'ALLOC-80',
          size: 'D',
          color: 'Blue',
          buy_price: 40,
          sell_price: 80,
          min_stock: 1,
          opening_qty: 10,
        },
      ],
    });

    const old100A = getVariantByBarcode('ALLOC-100-A')!;
    const old100B = getVariantByBarcode('ALLOC-100-B')!;
    const old120 = getVariantByBarcode('ALLOC-120')!;
    const replacement80 = getVariantByBarcode('ALLOC-80')!;

    const sale = createSale({
      user_id: 1,
      customer_id: null,

      sub_total: 320,
      discount_value: 20,
      grand_total: 300,
      paid: 300,

      change_amount: 0,
      payment_method: 'store_cash',

      items: [old100A, old100B, old120].map((variant) => ({
        variant_id: variant.variant_id,
        product_name: variant.product_name,
        barcode: variant.barcode,
        size: variant.size,
        color: variant.color,
        quantity: 1,
        unit_price: variant.sell_price,
      })),
    });

    const before = getSaleCurrentState(sale.saleId);

    expect(before.financials.net_grand_total).toBe(300);

    const state = getSaleExchangeState(sale.saleId);

    const group120 = state.groups.find(
      (group: any) =>
        group.group_kind === 'regular' &&
        Number(group.units[0]?.current_variant_id) ===
          Number(old120.variant_id),
    );

    if (!group120) {
      throw new Error('120-pound regular group missing');
    }

    /*
     * الخصم الأصلي = 20
     *
     * التوزيع الصحيح:
     * 100 -> 6
     * 100 -> 6
     * 120 -> 8
     *
     * عند استبدال 120 بـ 80:
     * الخصم المتبقي = 12
     * الصافي الجديد = 280 - 12 = 268
     * رد العميل = 300 - 268 = 32
     */
    expect(Number(group120.retained_normal_discount_after_exchange)).toBe(12);

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',

      items: [
        {
          promotion_unit_id: Number(group120.units[0].id),
          new_variant_id: replacement80.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(-32);
    expect(exchange.amount_to_refund).toBe(32);

    const after = getSaleCurrentState(sale.saleId);

    expect(after.financials.current_sub_total).toBe(280);

    expect(after.financials.current_normal_discount_value).toBe(12);

    expect(after.financials.net_grand_total).toBe(268);

    /*
     * نستبدل القطعتين المتبقيتين.
     * لا يجوز أن يضيع جنيه بسبب ترتيب العمليات.
     */
    const exchangeAnother100 = (variantId: number) => {
      const latest = getSaleExchangeState(sale.saleId);

      const group = latest.groups.find(
        (entry: any) =>
          entry.group_kind === 'regular' &&
          Number(entry.units[0]?.current_variant_id) === variantId,
      );

      if (!group) {
        throw new Error('Remaining 100-pound group missing');
      }

      return createSaleExchange({
        original_sale_id: sale.saleId,
        user_id: 1,
        payment_method: 'store_cash',
        items: [
          {
            promotion_unit_id: Number(group.units[0].id),
            new_variant_id: replacement80.variant_id,
          },
        ],
      });
    };

    const exchangeA = exchangeAnother100(old100A.variant_id);

    expect(exchangeA.difference_amount).toBe(-14);
    expect(exchangeA.amount_to_refund).toBe(14);

    const afterA = getSaleCurrentState(sale.saleId);

    expect(afterA.financials.current_normal_discount_value).toBe(6);
    expect(afterA.financials.net_grand_total).toBe(254);

    const exchangeB = exchangeAnother100(old100B.variant_id);

    expect(exchangeB.difference_amount).toBe(-14);
    expect(exchangeB.amount_to_refund).toBe(14);

    const finalState = getSaleCurrentState(sale.saleId);

    expect(finalState.financials.current_sub_total).toBe(240);
    expect(finalState.financials.current_normal_discount_value).toBe(0);
    expect(finalState.financials.net_grand_total).toBe(240);

    // إجمالي الرد = صافي الفاتورة الأصلية - صافي الفاتورة النهائي.
    expect(
      exchange.amount_to_refund +
        exchangeA.amount_to_refund +
        exchangeB.amount_to_refund,
    ).toBe(60);

    /*
     * إعادة استبدال نفس الوحدة الأصلية:
     * 80 -> 120
     *
     * نصيبها الأصلي من الخصم اتشال بالفعل،
     * فلا يجوز إزالته مرة ثانية.
     */
    const repeatedExchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(group120.units[0].id),
          new_variant_id: old120.variant_id,
        },
      ],
    });

    expect(repeatedExchange.difference_amount).toBe(40);
    expect(repeatedExchange.amount_to_collect).toBe(40);

    const afterRepeated = getSaleCurrentState(sale.saleId);

    expect(afterRepeated.financials.current_normal_discount_value).toBe(0);
    expect(afterRepeated.financials.net_grand_total).toBe(280);

    /*
     * إلغاء الاستبدال المتكرر:
     * نرجع إلى حالة الثلاث قطع بسعر 80.
     */
    cancelSaleExchange({
      exchange_id: repeatedExchange.exchangeId,
      actor_id: 1,
      reason: 'Cancel repeated exchange',
    });

    const afterRepeatedCancellation = getSaleCurrentState(sale.saleId);

    expect(
      afterRepeatedCancellation.financials.current_normal_discount_value,
    ).toBe(0);

    expect(afterRepeatedCancellation.financials.net_grand_total).toBe(240);

    /*
     * إلغاء العمليات الأقدم بالترتيب العكسي.
     */
    cancelSaleExchange({
      exchange_id: exchangeB.exchangeId,
      actor_id: 1,
      reason: 'Restore B',
    });

    const restoredB = getSaleCurrentState(sale.saleId);

    expect(restoredB.financials.current_normal_discount_value).toBe(6);
    expect(restoredB.financials.net_grand_total).toBe(254);

    cancelSaleExchange({
      exchange_id: exchangeA.exchangeId,
      actor_id: 1,
      reason: 'Restore A',
    });

    const restoredA = getSaleCurrentState(sale.saleId);

    expect(restoredA.financials.current_normal_discount_value).toBe(12);
    expect(restoredA.financials.net_grand_total).toBe(268);

    cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Restore original invoice',
    });

    const restoredOriginal = getSaleCurrentState(sale.saleId);

    expect(restoredOriginal.financials.current_sub_total).toBe(320);
    expect(restoredOriginal.financials.current_normal_discount_value).toBe(20);
    expect(restoredOriginal.financials.net_grand_total).toBe(300);
  });

  it('preserves fixed invoice discount allocation across exchange and returns', () => {
    createProduct({
      name: 'Fixed Invoice Discount Return',
      category_id: null,
      image_path: null,
      description: null,
      variants: [
        {
          barcode: 'FIX-100-A',
          size: 'A',
          color: 'Black',
          buy_price: 50,
          sell_price: 100,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'FIX-100-B',
          size: 'B',
          color: 'Black',
          buy_price: 50,
          sell_price: 100,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'FIX-100-C',
          size: 'C',
          color: 'Black',
          buy_price: 50,
          sell_price: 100,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'FIX-80',
          size: 'New',
          color: 'Blue',
          buy_price: 40,
          sell_price: 80,
          min_stock: 1,
          opening_qty: 10,
        },
      ],
    });

    const a = getVariantByBarcode('FIX-100-A')!;
    const b = getVariantByBarcode('FIX-100-B')!;
    const c = getVariantByBarcode('FIX-100-C')!;
    const replacement = getVariantByBarcode('FIX-80')!;

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 1,
      grand_total: 299,
      paid: 299,
      change_amount: 0,
      payment_method: 'store_cash',
      items: [a, b, c].map((variant) => ({
        variant_id: variant.variant_id,
        product_name: variant.product_name,
        barcode: variant.barcode,
        size: variant.size,
        color: variant.color,
        quantity: 1,
        unit_price: 100,
      })),
    });

    const state = getSaleExchangeState(sale.saleId);

    const groupB = state.groups.find(
      (group: any) =>
        group.group_kind === 'regular' &&
        Number(group.units[0]?.current_variant_id) === Number(b.variant_id),
    );

    if (!groupB) {
      throw new Error('Regular group B missing');
    }

    // خصم الجنيه يخص A، وليس B.
    expect(groupB.retained_normal_discount_after_exchange).toBe(1);

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(groupB.units[0].id),
          new_variant_id: replacement.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(-20);

    const itemA = getDb()
      .prepare(
        `
        SELECT id
        FROM sale_items
        WHERE sale_id = ?
          AND variant_id = ?
      `,
      )
      .get(sale.saleId, a.variant_id) as { id: number };

    const firstReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: itemA.id,
          variant_id: a.variant_id,
          quantity: 1,
        },
      ],
    });

    // A سعره 100، ونصيبه الثابت من الخصم 1.
    expect(firstReturn.return_value).toBe(99);

    const firstReturnRow = getDb()
      .prepare(
        `
        SELECT normal_discount_value
        FROM sale_returns
        WHERE id = ?
      `,
      )
      .get(firstReturn.returnId) as {
      normal_discount_value: number;
    };

    expect(Number(firstReturnRow.normal_discount_value)).toBe(1);

    const itemC = getDb()
      .prepare(
        `
        SELECT id
        FROM sale_items
        WHERE sale_id = ?
          AND variant_id = ?
      `,
      )
      .get(sale.saleId, c.variant_id) as { id: number };

    const secondReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: itemC.id,
          variant_id: c.variant_id,
          quantity: 1,
        },
      ],
    });

    // C ليس عليه خصم، فلا نخصم منه جنيه A مرة ثانية.
    expect(secondReturn.return_value).toBe(100);

    expect(firstReturn.return_value + secondReturn.return_value).toBe(199);
  });

  it('preserves percentage invoice discount through exchange and returns', () => {
    const { variants } = seedExchangeCatalog();

    const first = variants.EX150;
    const second = variants.EX200;
    const third = variants.EX350;
    const replacement = variants.EX300;

    /*
     * 7.5% من 700 = 52.5
     * الخصم النقدي بعد التقريب = 53
     *
     * توزيعه الثابت:
     * 150 -> 11
     * 200 -> 15
     * 350 -> 27
     */
    const subTotal = 700;
    const discountPercent = 7.5;
    const discountValue = Math.round((subTotal * discountPercent) / 100);

    expect(discountValue).toBe(53);

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: subTotal,
      discount_value: discountValue,
      grand_total: 647,
      paid: 647,
      change_amount: 0,
      payment_method: 'store_cash',
      items: [first, second, third].map((variant) => ({
        variant_id: variant.variant_id,
        product_name: variant.product_name,
        barcode: variant.barcode,
        size: variant.size,
        color: variant.color,
        quantity: 1,
        unit_price: variant.sell_price,
      })),
    });

    const before = getSaleCurrentState(sale.saleId);

    expect(before.financials.net_grand_total).toBe(647);

    const state = getSaleExchangeState(sale.saleId);

    const group = state.groups.find(
      (entry: any) =>
        entry.group_kind === 'regular' &&
        Number(entry.units[0]?.current_variant_id) === Number(third.variant_id),
    );

    if (!group) {
      throw new Error('350-pound exchange group missing');
    }

    // بعد إزالة نصيب 350، يظل خصم 11 + 15.
    expect(group.retained_normal_discount_after_exchange).toBe(26);

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(group.units[0].id),
          new_variant_id: replacement.variant_id,
        },
      ],
    });

    /*
     * الإجمالي الجديد:
     * 150 + 200 + 300 - 26 = 624
     *
     * الرد:
     * 647 - 624 = 23
     */
    expect(exchange.difference_amount).toBe(-23);
    expect(exchange.amount_to_refund).toBe(23);

    const afterExchange = getSaleCurrentState(sale.saleId);

    expect(afterExchange.financials.current_normal_discount_value).toBe(26);

    expect(afterExchange.financials.net_grand_total).toBe(624);

    const returnOriginalItem = (variant: TestVariant) => {
      const item = getDb()
        .prepare(
          `
          SELECT id
          FROM sale_items
          WHERE sale_id = ?
            AND variant_id = ?
          LIMIT 1
        `,
        )
        .get(sale.saleId, variant.variant_id) as { id: number } | undefined;

      if (!item) {
        throw new Error('Original sale item missing');
      }

      return createSaleReturn({
        original_sale_id: sale.saleId,
        user_id: 1,
        refund_payment_method: 'store_cash',
        items: [
          {
            sale_item_id: item.id,
            variant_id: variant.variant_id,
            quantity: 1,
          },
        ],
      });
    };

    const firstReturn = returnOriginalItem(first);

    // المنتج 150 نصيبه من الخصم 11.
    expect(firstReturn.return_value).toBe(139);

    const secondReturn = returnOriginalItem(second);

    // المنتج 200 نصيبه من الخصم 15.
    expect(secondReturn.return_value).toBe(185);

    const finalState = getSaleCurrentState(sale.saleId);

    // البديل 300 بدون أي خصم فاتورة موروث.
    expect(finalState.financials.net_grand_total).toBe(300);

    /*
     * إجمالي الأموال التي خرجت:
     * 23 + 139 + 185 = 347
     *
     * المتبقي من أصل 647 = 300.
     */
    expect(
      exchange.amount_to_refund +
        firstReturn.return_value +
        secondReturn.return_value,
    ).toBe(347);
  });

  it('preserves invoice discount when regular exchange and promotion return coexist', () => {
    const { promoCategoryId, variants } = seedExchangeCatalog();

    createProduct({
      name: 'Mixed Promotion Invoice Discount',
      category_id: null,
      image_path: null,
      description: null,
      variants: [
        {
          barcode: 'MIX-PROMO-OLD100',
          size: 'Old',
          color: 'Black',
          buy_price: 50,
          sell_price: 100,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'MIX-PROMO-NEW120',
          size: 'New',
          color: 'Blue',
          buy_price: 60,
          sell_price: 120,
          min_stock: 1,
          opening_qty: 10,
        },
      ],
    });

    const regularOld = getVariantByBarcode('MIX-PROMO-OLD100')!;
    const regularNew = getVariantByBarcode('MIX-PROMO-NEW120')!;

    const promotion = createPromotion({
      name: 'Mixed Invoice Buy 2 Get 1',
      type: 'buy_x_get_y',
      value: 0,
      buy_qty: 2,
      free_qty: 1,
      scope_type: 'category',
      category_id: promoCategoryId,
      product_ids: [],
      actor_id: 1,
    });

    togglePromotion(promotion.promotionId, 1);

    /*
     * الأسعار: 250 + 200 + 150 + 100 = 700
     *
     * خصم العرض = 150
     * المتبقي بعد العرض = 550
     * خصم الفاتورة = 20
     * الصافي = 530
     *
     * توزيع الخصم الثابت:
     * 250 -> 9
     * 200 -> 7
     * 150 (هدية) -> 0
     * 100 -> 4
     */
    const sale = createSale({
      user_id: 1,
      customer_id: null,
      promotion_id: promotion.promotionId,
      sub_total: 700,
      discount_value: 20,
      grand_total: 530,
      paid: 530,
      change_amount: 0,
      payment_method: 'store_cash',
      items: [variants.EX250, variants.EX200, variants.EX150, regularOld].map(
        (variant) => ({
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 1,
          unit_price: variant.sell_price,
        }),
      ),
    });

    const original = getSaleCurrentState(sale.saleId);

    expect(original.financials.current_sub_total).toBe(700);
    expect(original.financials.current_promotion_discount_value).toBe(150);
    expect(original.financials.current_normal_discount_value).toBe(20);
    expect(original.financials.net_grand_total).toBe(530);

    const state = getSaleExchangeState(sale.saleId);

    const regularGroup = state.groups.find(
      (group: any) =>
        group.group_kind === 'regular' &&
        Number(group.units[0]?.current_variant_id) ===
          Number(regularOld.variant_id),
    );

    if (!regularGroup) {
      throw new Error('Regular item outside promotion is missing');
    }

    // استبدال 100 يلغي نصيبه 4 من الخصم.
    // الخصم المتبقي = 9 + 7 = 16.
    expect(regularGroup.retained_normal_discount_after_exchange).toBe(16);

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(regularGroup.units[0].id),
          new_variant_id: regularNew.variant_id,
        },
      ],
    });

    /*
     * الفاتورة بعد الاستبدال:
     * 250 + 200 + 150 + 120 = 720
     * خصم العرض = 150
     * خصم الفاتورة المتبقي = 16
     *
     * الصافي الجديد = 554
     * فرق الاستبدال = 554 - 530 = 24
     */
    expect(exchange.difference_amount).toBe(24);
    expect(exchange.amount_to_collect).toBe(24);

    const afterExchange = getSaleCurrentState(sale.saleId);

    expect(afterExchange.financials.current_sub_total).toBe(720);
    expect(afterExchange.financials.current_promotion_discount_value).toBe(150);
    expect(afterExchange.financials.current_normal_discount_value).toBe(16);
    expect(afterExchange.financials.net_grand_total).toBe(554);

    /*
     * إرجاع مجموعة العرض كاملة:
     *
     * قيمتها بعد خصم الهدية = 450
     * نصيبها من خصم الفاتورة = 16
     * المستحق للعميل = 434
     */
    const promotionItems = getFullReturnInput(sale.saleId);

    expect(promotionItems).toHaveLength(3);

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: promotionItems,
    });

    expect(saleReturn.return_value).toBe(434);

    const returnRow = getDb()
      .prepare(
        `
        SELECT
          promotion_discount_value,
          normal_discount_value
        FROM sale_returns
        WHERE id = ?
      `,
      )
      .get(saleReturn.returnId) as {
      promotion_discount_value: number;
      normal_discount_value: number;
    };

    expect(Number(returnRow.promotion_discount_value)).toBe(150);
    expect(Number(returnRow.normal_discount_value)).toBe(16);

    const finalState = getSaleCurrentState(sale.saleId);

    // المتبقي هو المنتج البديل 120 بلا خصم موروث.
    expect(finalState.financials.net_grand_total).toBe(120);

    // مراجعة التسوية النقدية كاملة.
    expect(530 + exchange.amount_to_collect - saleReturn.return_value).toBe(
      120,
    );
  });

  it('does not transfer an untouched item discount to a promotion return', () => {
    const { promoCategoryId, variants } = seedExchangeCatalog();

    createProduct({
      name: 'Mixed One Pound Discount',
      category_id: null,
      image_path: null,
      description: null,
      variants: [
        {
          barcode: 'MIX-ONE-100',
          size: 'Old',
          color: 'Black',
          buy_price: 50,
          sell_price: 100,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'MIX-ONE-120',
          size: 'New',
          color: 'Blue',
          buy_price: 60,
          sell_price: 120,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'MIX-ONE-300',
          size: 'Other',
          color: 'White',
          buy_price: 150,
          sell_price: 300,
          min_stock: 1,
          opening_qty: 10,
        },
      ],
    });

    const old100 = getVariantByBarcode('MIX-ONE-100')!;
    const new120 = getVariantByBarcode('MIX-ONE-120')!;
    const other300 = getVariantByBarcode('MIX-ONE-300')!;

    const promotion = createPromotion({
      name: 'Mixed One Pound Buy 2 Get 1',
      type: 'buy_x_get_y',
      value: 0,
      buy_qty: 2,
      free_qty: 1,
      scope_type: 'category',
      category_id: promoCategoryId,
      product_ids: [],
      actor_id: 1,
    });

    togglePromotion(promotion.promotionId, 1);

    /*
     * الإجمالي = 1000
     * خصم الهدية = 150
     * خصم الفاتورة = 1
     * الصافي = 849
     *
     * جنيه الخصم يخص المنتج 300،
     * لأنه صاحب أكبر وزن فردي.
     */
    const sale = createSale({
      user_id: 1,
      customer_id: null,
      promotion_id: promotion.promotionId,
      sub_total: 1000,
      discount_value: 1,
      grand_total: 849,
      paid: 849,
      change_amount: 0,
      payment_method: 'store_cash',
      items: [
        variants.EX250,
        variants.EX200,
        variants.EX150,
        old100,
        other300,
      ].map((variant) => ({
        variant_id: variant.variant_id,
        product_name: variant.product_name,
        barcode: variant.barcode,
        size: variant.size,
        color: variant.color,
        quantity: 1,
        unit_price: variant.sell_price,
      })),
    });

    const state = getSaleExchangeState(sale.saleId);

    const regularGroup = state.groups.find(
      (group: any) =>
        group.group_kind === 'regular' &&
        Number(group.units[0]?.current_variant_id) ===
          Number(old100.variant_id),
    );

    if (!regularGroup) {
      throw new Error('Regular 100-pound group missing');
    }

    // استبدال 100 لا يلغي جنيه خصم المنتج 300.
    expect(regularGroup.retained_normal_discount_after_exchange).toBe(1);

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(regularGroup.units[0].id),
          new_variant_id: new120.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(20);
    expect(exchange.amount_to_collect).toBe(20);

    /*
     * العرض قيمته بعد الهدية = 450.
     * لا يوجد أي خصم فاتورة مخصص له.
     *
     * لذلك مرتجعه الصحيح = 450 بالكامل.
     */
    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: getFullReturnInput(sale.saleId),
    });

    expect(saleReturn.return_value).toBe(450);

    const returnRow = getDb()
      .prepare(
        `
        SELECT normal_discount_value
        FROM sale_returns
        WHERE id = ?
      `,
      )
      .get(saleReturn.returnId) as {
      normal_discount_value: number;
    };

    expect(Number(returnRow.normal_discount_value)).toBe(0);

    const finalState = getSaleCurrentState(sale.saleId);

    // المتبقي: البديل 120 + المنتج 300 - خصمه 1.
    expect(finalState.financials.net_grand_total).toBe(419);

    expect(849 + exchange.amount_to_collect - saleReturn.return_value).toBe(
      419,
    );

    /*
     * إلغاء مرتجع العرض:
     * يرجع كامل قيمة العرض 450 للفاتورة،
     * ويظل جنيه الخصم مخصصًا للمنتج 300.
     */
    cancelSaleReturn({
      return_id: saleReturn.returnId,
      actor_id: 1,
      reason: 'Restore promotion return',
    });

    const afterReturnCancellation = getSaleCurrentState(sale.saleId);

    expect(
      afterReturnCancellation.financials.current_normal_discount_value,
    ).toBe(1);

    expect(
      afterReturnCancellation.financials.current_promotion_discount_value,
    ).toBe(150);

    expect(afterReturnCancellation.financials.net_grand_total).toBe(869);

    /*
     * إلغاء الاستبدال:
     * ترجع الفاتورة لحالتها الأصلية بالكامل،
     * دون زيادة أو فقدان أي جنيه خصم.
     */
    cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Restore original mixed invoice',
    });

    const restored = getSaleCurrentState(sale.saleId);

    expect(restored.financials.current_sub_total).toBe(1000);
    expect(restored.financials.current_promotion_discount_value).toBe(150);
    expect(restored.financials.current_normal_discount_value).toBe(1);
    expect(restored.financials.total_return_value).toBe(0);
    expect(restored.financials.net_grand_total).toBe(849);

    /*
     * بعد إلغاء الاستبدال والمرتجع السابقين،
     * نختبر مرتجعين متتاليين بدون استبدال نشط.
     *
     * جنيه الخصم مخصص للمنتج 300 فقط.
     */

    const old100Item = getDb()
      .prepare(
        `
        SELECT id
        FROM sale_items
        WHERE sale_id = ?
          AND variant_id = ?
        LIMIT 1
      `,
      )
      .get(sale.saleId, old100.variant_id) as { id: number } | undefined;

    if (!old100Item) {
      throw new Error('Original 100-pound item missing');
    }

    // المرتجع الأول: منتج 100 بدون نصيب خصم.
    const regularReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: old100Item.id,
          variant_id: old100.variant_id,
          quantity: 1,
        },
      ],
    });

    expect(regularReturn.return_value).toBe(100);

    // المرتجع الثاني: العرض كاملًا بدون خصم فاتورة.
    const promotionReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: getFullReturnInput(sale.saleId),
    });

    expect(promotionReturn.return_value).toBe(450);

    const promotionReturnRow = getDb()
      .prepare(
        `
        SELECT normal_discount_value
        FROM sale_returns
        WHERE id = ?
      `,
      )
      .get(promotionReturn.returnId) as {
      normal_discount_value: number;
    };

    expect(Number(promotionReturnRow.normal_discount_value)).toBe(0);

    const afterSequentialReturns = getSaleCurrentState(sale.saleId);

    expect(afterSequentialReturns.financials.total_return_value).toBe(550);
    expect(afterSequentialReturns.financials.net_grand_total).toBe(299);

    // المجموع المحاسبي لازم يقفل بدون جنيه زيادة أو ناقص.
    expect(
      849 - regularReturn.return_value - promotionReturn.return_value,
    ).toBe(299);
  });

  it('keeps fixed invoice discount when a return precedes an exchange', () => {
    const { variants } = seedExchangeCatalog();

    const first = variants.EX150;
    const second = variants.EX200;
    const third = variants.EX250;
    const replacement = variants.EX300;

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 600,
      discount_value: 1,
      grand_total: 599,
      paid: 599,
      change_amount: 0,
      payment_method: 'store_cash',
      items: [first, second, third].map((variant) => ({
        variant_id: variant.variant_id,
        product_name: variant.product_name,
        barcode: variant.barcode,
        size: variant.size,
        color: variant.color,
        quantity: 1,
        unit_price: variant.sell_price,
      })),
    });

    // تجهيز وحدات الفاتورة قبل أول مرتجع.
    getSaleExchangeState(sale.saleId);

    const returnedItem = getDb()
      .prepare(
        `
        SELECT id
        FROM sale_items
        WHERE sale_id = ?
          AND variant_id = ?
        LIMIT 1
      `,
      )
      .get(sale.saleId, third.variant_id) as { id: number } | undefined;

    if (!returnedItem) {
      throw new Error('Original 250-pound item missing');
    }

    /*
     * الجنيه الأصلي مخصص للمنتج 250.
     *
     * مرتجعه الصحيح = 250 - 1 = 249.
     */
    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: returnedItem.id,
          variant_id: third.variant_id,
          quantity: 1,
        },
      ],
    });

    expect(saleReturn.return_value).toBe(249);

    const returnRow = getDb()
      .prepare(
        `
        SELECT normal_discount_value
        FROM sale_returns
        WHERE id = ?
      `,
      )
      .get(saleReturn.returnId) as {
      normal_discount_value: number;
    };

    expect(Number(returnRow.normal_discount_value)).toBe(1);

    const afterReturn = getSaleCurrentState(sale.saleId);

    // المتبقي: 150 + 200 = 350.
    expect(afterReturn.financials.net_grand_total).toBe(350);

    /*
     * استبدال منتج 150 بـ300 بعد المرتجع.
     * فرق الاستبدال = 150 جنيه.
     */
    const state = getSaleExchangeState(sale.saleId);

    const group = state.groups.find(
      (entry: any) =>
        entry.group_kind === 'regular' &&
        Number(entry.units[0]?.current_variant_id) === Number(first.variant_id),
    );

    if (!group) {
      throw new Error('150-pound exchange group missing');
    }

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(group.units[0].id),
          new_variant_id: replacement.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(150);
    expect(exchange.amount_to_collect).toBe(150);

    const afterExchange = getSaleCurrentState(sale.saleId);

    // المتبقي: البديل 300 + المنتج 200.
    expect(afterExchange.financials.net_grand_total).toBe(500);

    // 599 - 249 + 150 = 500.
    expect(599 - saleReturn.return_value + exchange.amount_to_collect).toBe(
      500,
    );

    /*
     * إلغاء الاستبدال ثم المرتجع
     * يرجع الفاتورة الأصلية بالكامل.
     */
    cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Restore exchange after earlier return',
    });

    expect(getSaleCurrentState(sale.saleId).financials.net_grand_total).toBe(
      350,
    );

    cancelSaleReturn({
      return_id: saleReturn.returnId,
      actor_id: 1,
      reason: 'Restore earlier return',
    });

    const restored = getSaleCurrentState(sale.saleId);

    expect(restored.financials.current_normal_discount_value).toBe(1);
    expect(restored.financials.total_return_value).toBe(0);
    expect(restored.financials.net_grand_total).toBe(599);
  });

  it('preserves fixed discount across quantity-three returns and exchange', () => {
    createProduct({
      name: 'Quantity Three Invoice Discount',
      category_id: null,
      image_path: null,
      description: null,
      variants: [
        {
          barcode: 'QTY3-OLD100',
          size: 'Old',
          color: 'Black',
          buy_price: 50,
          sell_price: 100,
          min_stock: 1,
          opening_qty: 10,
        },
        {
          barcode: 'QTY3-NEW80',
          size: 'New',
          color: 'Blue',
          buy_price: 40,
          sell_price: 80,
          min_stock: 1,
          opening_qty: 10,
        },
      ],
    });

    const oldVariant = getVariantByBarcode('QTY3-OLD100')!;
    const newVariant = getVariantByBarcode('QTY3-NEW80')!;

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 2,
      grand_total: 298,
      paid: 298,
      change_amount: 0,
      payment_method: 'store_cash',
      items: [
        {
          variant_id: oldVariant.variant_id,
          product_name: oldVariant.product_name,
          barcode: oldVariant.barcode,
          size: oldVariant.size,
          color: oldVariant.color,
          quantity: 3,
          unit_price: 100,
        },
      ],
    });

    const originalItem = getDb()
      .prepare(
        `
        SELECT id
        FROM sale_items
        WHERE sale_id = ?
          AND variant_id = ?
        LIMIT 1
      `,
      )
      .get(sale.saleId, oldVariant.variant_id) as {
      id: number;
    };

    const state = getSaleExchangeState(sale.saleId);

    const groups = state.groups
      .filter((group: any) => group.group_kind === 'regular')
      .sort((a: any, b: any) => Number(a.units[0].id) - Number(b.units[0].id));

    expect(groups).toHaveLength(3);

    /*
     * خصم الفاتورة = 2 جنيه.
     *
     * الوحدة الأولى نصيبها 1
     * الوحدة الثانية نصيبها 1
     * الوحدة الثالثة نصيبها 0
     *
     * القيم هنا تمثل الخصم الذي
     * سيظل بعد استبدال كل وحدة.
     */
    expect(
      groups.map((group) =>
        Number(group.retained_normal_discount_after_exchange),
      ),
    ).toEqual([1, 1, 2]);

    /*
     * 1. مرتجع الوحدة الأولى.
     * السعر 100 - خصم 1 = 99.
     */
    const firstReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: originalItem.id,
          variant_id: oldVariant.variant_id,
          quantity: 1,
        },
      ],
    });

    expect(firstReturn.return_value).toBe(99);

    const firstReturnItem = getDb()
      .prepare(
        `
        SELECT promotion_unit_id
        FROM sale_return_items
        WHERE return_id = ?
        LIMIT 1
      `,
      )
      .get(firstReturn.returnId) as {
      promotion_unit_id: number;
    };

    expect(Number(firstReturnItem.promotion_unit_id)).toBe(
      Number(groups[0].units[0].id),
    );

    expect(getSaleCurrentState(sale.saleId).financials.net_grand_total).toBe(
      199,
    );

    /*
     * 2. استبدال الوحدة الثانية:
     * 100 -> 80.
     *
     * نصيبها من الخصم = 1.
     * قيمتها الفعلية القديمة = 99.
     * البديل = 80.
     *
     * رد العميل = 19.
     */
    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(groups[1].units[0].id),
          new_variant_id: newVariant.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(-19);
    expect(exchange.amount_to_refund).toBe(19);

    const afterExchange = getSaleCurrentState(sale.saleId);

    expect(afterExchange.financials.current_normal_discount_value).toBe(1);
    expect(afterExchange.financials.net_grand_total).toBe(180);

    /*
     * 3. مرتجع الوحدة الثالثة.
     *
     * نصيبها الأصلي من الخصم = 0.
     * الرد الصحيح = 100 كاملين.
     */
    const secondReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: originalItem.id,
          variant_id: oldVariant.variant_id,
          quantity: 1,
        },
      ],
    });

    expect(secondReturn.return_value).toBe(100);

    const secondReturnRow = getDb()
      .prepare(
        `
        SELECT normal_discount_value
        FROM sale_returns
        WHERE id = ?
      `,
      )
      .get(secondReturn.returnId) as {
      normal_discount_value: number;
    };

    expect(Number(secondReturnRow.normal_discount_value)).toBe(0);

    const finalState = getSaleCurrentState(sale.saleId);

    expect(finalState.financials.current_normal_discount_value).toBe(1);
    expect(finalState.financials.net_grand_total).toBe(80);

    /*
     * مراجعة إجمالي الأموال:
     *
     * 298 - 99 - 19 - 100 = 80
     */
    expect(
      298 -
        firstReturn.return_value -
        exchange.amount_to_refund -
        secondReturn.return_value,
    ).toBe(80);

    /*
     * 4. إلغاء العمليات بالترتيب العكسي.
     */
    cancelSaleReturn({
      return_id: secondReturn.returnId,
      actor_id: 1,
      reason: 'Restore third unit',
    });

    expect(getSaleCurrentState(sale.saleId).financials.net_grand_total).toBe(
      180,
    );

    cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Restore second unit',
    });

    expect(getSaleCurrentState(sale.saleId).financials.net_grand_total).toBe(
      199,
    );

    cancelSaleReturn({
      return_id: firstReturn.returnId,
      actor_id: 1,
      reason: 'Restore first unit',
    });

    const restored = getSaleCurrentState(sale.saleId);

    expect(restored.financials.current_sub_total).toBe(300);
    expect(restored.financials.current_normal_discount_value).toBe(2);
    expect(restored.financials.total_return_value).toBe(0);
    expect(restored.financials.net_grand_total).toBe(298);
  });

  it('restores original product discount snapshots when a discounted exchange is cancelled', () => {
    createProduct({
      name: 'Cancel Product Discount Exchange',

      category_id: null,

      image_path: null,

      description: null,

      variants: [
        {
          barcode: 'PD-CANCEL-OLD',

          size: 'Old',
          color: 'Black',

          buy_price: 100,

          sell_price: 190,
          discount_price: 150,

          min_stock: 1,

          opening_qty: 10,
        },

        {
          barcode: 'PD-CANCEL-NEW',

          size: 'New',
          color: 'Blue',

          buy_price: 120,

          sell_price: 250,
          discount_price: 180,

          min_stock: 1,

          opening_qty: 10,
        },
      ],
    });

    const oldVariant = getVariantByBarcode('PD-CANCEL-OLD') as any;

    const newVariant = getVariantByBarcode('PD-CANCEL-NEW') as any;

    const sale = createSale({
      user_id: 1,

      customer_id: null,

      sub_total: 150,

      discount_value: 0,

      grand_total: 150,

      change_amount: 0,

      payment_method: 'store_cash',

      paid: 150,

      items: [
        {
          variant_id: oldVariant.variant_id,

          product_name: oldVariant.product_name,

          barcode: oldVariant.barcode,

          size: oldVariant.size,

          color: oldVariant.color,

          quantity: 1,

          unit_price: 150,

          list_unit_price: 190,
        },
      ],
    });

    const exchangeState = getSaleExchangeState(sale.saleId);

    const regularGroup = exchangeState.groups.find(
      (group: any) => group.group_kind === 'regular',
    );

    if (!regularGroup) {
      throw new Error('Regular group missing');
    }

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      items: [
        {
          promotion_unit_id: Number(regularGroup.units[0].id),

          new_variant_id: Number(newVariant.variant_id),
        },
      ],
    });

    let current = getSaleCurrentState(sale.saleId);

    expect(Number(current.sale.list_sub_total)).toBe(250);

    expect(Number(current.sale.sub_total)).toBe(180);

    expect(Number(current.sale.product_discount_value)).toBe(70);

    const exchangeRow = listSaleExchanges({
      search: String(exchange.exchangeId),
    }).rows[0] as any;

    expect(Number(exchangeRow.old_product_discount_value)).toBe(40);

    expect(Number(exchangeRow.new_product_discount_value)).toBe(70);

    expect(Number(exchangeRow.items[0].old_list_unit_price)).toBe(190);

    expect(Number(exchangeRow.items[0].new_list_unit_price)).toBe(250);

    cancelSaleExchange({
      exchange_id: exchange.exchangeId,

      actor_id: 1,

      reason: 'Regression cancel',
    });

    current = getSaleCurrentState(sale.saleId);

    expect(Number(current.sale.list_sub_total)).toBe(190);

    expect(Number(current.sale.sub_total)).toBe(150);

    expect(Number(current.sale.product_discount_value)).toBe(40);

    expect(Number(current.sale.grand_total)).toBe(150);
  });

  it('blocks cashier from cancelling an exchange from a previous shift', () => {
    const db = getDb();

    const initialShift = getOpenCashShift()!;

    closeCashShift({
      shift_id: initialShift.id,
      closing_counted_amount: 0,
      left_for_next_shift: 0,
      closed_by: 1,
    });

    const cashier = createUser(
      'Exchange Shift Cashier',
      'exchange_shift_cashier',
      'Cashier1234',
      'cashier',
    );

    const shift1 = openCashShift({
      opening_counted_amount: 0,
      opened_by: cashier.id,
    });

    const catalog = seedExchangeCatalog();

    const oldVariant = catalog.variants.EX150;
    const newVariant = catalog.variants.EX200;

    const sale = createSale({
      user_id: cashier.id,
      customer_id: null,
      sub_total: 150,
      discount_value: 0,
      grand_total: 150,
      paid: 150,
      change_amount: 0,
      payment_method: 'store_cash',
      items: [
        {
          variant_id: oldVariant.variant_id,
          product_name: oldVariant.product_name,
          barcode: oldVariant.barcode,
          size: oldVariant.size,
          color: oldVariant.color,
          quantity: 1,
          unit_price: 150,
        },
      ],
    });

    const state = getSaleExchangeState(sale.saleId);

    const group = state.groups.find(
      (item: any) => item.group_kind === 'regular',
    );

    const unit = group?.units.find(
      (item: any) => Number(item.is_returned || 0) === 0,
    );

    expect(unit).toBeTruthy();

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: cashier.id,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(unit!.id),
          new_variant_id: newVariant.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(50);
    expect(exchange.shift_id).toBe(shift1.id);

    // إغلاق الشيفت الأول بعد تحصيل 200 جنيه.
    closeCashShift({
      shift_id: shift1.id,
      closing_counted_amount: 200,
      left_for_next_shift: 200,
      closed_by: cashier.id,
    });

    const shift2 = openCashShift({
      opening_counted_amount: 200,
      opened_by: cashier.id,
    });

    expect(shift2.id).not.toBe(shift1.id);

    // قائمة الاستبدالات لا تسمح بإلغاء العملية القديمة.
    const listed = listSaleExchanges({
      actor_id: cashier.id,
    });

    const exchangeRow = listed.rows.find(
      (row: any) => Number(row.id) === exchange.exchangeId,
    ) as any;

    expect(exchangeRow).toBeTruthy();
    expect(exchangeRow.can_cancel).toBe(false);
    expect(exchangeRow.cancel_block_reason).toContain('نفس الشفت');

    // الحماية الفعلية داخل الـRepository.
    expect(() =>
      cancelSaleExchange({
        exchange_id: exchange.exchangeId,
        actor_id: cashier.id,
        reason: 'Attempt to cancel previous shift exchange',
      }),
    ).toThrow('لا يمكن إلغاء الاستبدال إلا داخل نفس الشفت الذي تم فيه');

    // الاستبدال يظل فعالًا.
    const storedExchange = db
      .prepare(
        `
    SELECT cancelled_at, cancelled_shift_id
    FROM sale_exchanges
    WHERE id = ?
  `,
      )
      .get(exchange.exchangeId) as {
      cancelled_at: string | null;
      cancelled_shift_id: number | null;
    };

    expect(storedExchange.cancelled_at).toBeNull();
    expect(storedExchange.cancelled_shift_id).toBeNull();

    // لم تُسجّل أي حركة رد أموال.
    const reversals = db
      .prepare(
        `
    SELECT COUNT(*) AS count
    FROM cash_movements
    WHERE reference_type = 'sale_exchange_cancel'
      AND reference_id = ?
  `,
      )
      .get(exchange.exchangeId) as { count: number };

    expect(reversals.count).toBe(0);
  });

  it('rejects exchange cancellation when drawer balance is insufficient without changing financial or inventory state', () => {
    const db = getDb();

    const result = createRegularExchangeSale();

    const state = getSaleExchangeState(result.sale.saleId);

    const regularGroup = state.groups.find(
      (group: any) => group.group_kind === 'regular',
    );

    expect(regularGroup).toBeTruthy();

    const unit = regularGroup!.units[0];

    // استبدال قطعة بـ100 بقطعة بـ150
    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      reason: 'Insufficient balance regression',
      items: [
        {
          promotion_unit_id: Number(unit.id),
          new_variant_id: result.newVariant.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(50);
    expect(exchange.amount_to_collect).toBe(50);

    // رصيد الدرج = 100 بيع + 50 فرق استبدال
    expect(getCashSummary({ payment_method: 'store_cash' }).balance).toBe(150);

    const shift = getOpenCashShift()!;

    // نسحب 130 جنيه، فيتبقى 20 فقط
    createCashMovement({
      type: 'withdraw',
      direction: 'out',
      amount: 130,
      payment_method: 'store_cash',
      created_by: 1,
      shift_id: shift.id,
      notes: 'Test withdrawal before exchange cancellation',
    });

    expect(getCashSummary({ payment_method: 'store_cash' }).balance).toBe(20);

    // نحفظ حالة المخزون والفاتورة قبل محاولة الإلغاء
    const oldStockBefore = getInventoryCostState(
      db,
      result.oldVariant.variant_id,
    );

    const newStockBefore = getInventoryCostState(
      db,
      result.newVariant.variant_id,
    );

    const netBefore = getSaleCurrentState(result.sale.saleId).financials
      .net_grand_total;

    // إلغاء الاستبدال يحتاج رد 50، لكن المتاح 20 فقط
    expect(() =>
      cancelSaleExchange({
        exchange_id: exchange.exchangeId,
        actor_id: 1,
        reason: 'Attempt cancellation with insufficient cash',
      }),
    ).toThrow(/رصيد.*غير كاف/);

    // الاستبدال لم يُلغَ
    const exchangeRow = db
      .prepare(
        `
    SELECT cancelled_at, cancelled_shift_id
    FROM sale_exchanges
    WHERE id = ?
  `,
      )
      .get(exchange.exchangeId) as {
      cancelled_at: string | null;
      cancelled_shift_id: number | null;
    };

    expect(exchangeRow.cancelled_at).toBeNull();
    expect(exchangeRow.cancelled_shift_id).toBeNull();

    // لا توجد حركة رد فلوس بسبب الإلغاء الفاشل
    const reverseMovements = db
      .prepare(
        `
    SELECT COUNT(*) AS count
    FROM cash_movements
    WHERE reference_type = 'sale_exchange_cancel'
      AND reference_id = ?
  `,
      )
      .get(exchange.exchangeId) as { count: number };

    expect(reverseMovements.count).toBe(0);

    // الدرج يفضل فيه 20 جنيه
    expect(getCashSummary({ payment_method: 'store_cash' }).balance).toBe(20);

    // المخزون لم يتغير
    const oldStockAfter = getInventoryCostState(
      db,
      result.oldVariant.variant_id,
    );

    const newStockAfter = getInventoryCostState(
      db,
      result.newVariant.variant_id,
    );

    expect(oldStockAfter.stock).toBe(oldStockBefore.stock);
    expect(oldStockAfter.inventory_value).toBe(oldStockBefore.inventory_value);

    expect(newStockAfter.stock).toBe(newStockBefore.stock);
    expect(newStockAfter.inventory_value).toBe(newStockBefore.inventory_value);

    // قيمة الفاتورة لم تتغير
    expect(
      getSaleCurrentState(result.sale.saleId).financials.net_grand_total,
    ).toBe(netBefore);
  });

  it('allows admin debt-only exchange on store_cash without an open shift', () => {
    const db = getDb();
    const catalog = seedExchangeCatalog();

    const shift = getOpenCashShift()!;

    const customerResult = db
      .prepare(
        `
    INSERT INTO customers (name, phone)
    VALUES (?, ?)
  `,
      )
      .run('Debt Only Exchange Customer', '01088889999');

    const customerId = Number(customerResult.lastInsertRowid);

    const oldVariant = catalog.variants.EX200;
    const newVariant = catalog.variants.EX150;

    // فاتورة آجل 200 جنيه بدون تحصيل
    const sale = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 200,
      discount_value: 0,
      grand_total: 200,
      paid: 0,
      remaining_amount: 200,
      payment_status: 'unpaid',
      change_amount: 0,
      payment_method: 'store_cash',
      items: [
        {
          variant_id: oldVariant.variant_id,
          product_name: oldVariant.product_name,
          barcode: oldVariant.barcode,
          size: oldVariant.size,
          color: oldVariant.color,
          quantity: 1,
          unit_price: 200,
        },
      ],
    });

    const state = getSaleExchangeState(sale.saleId);

    const group = state.groups.find(
      (item: any) => item.group_kind === 'regular',
    );

    expect(group).toBeTruthy();

    const unit = group!.units[0];

    // نقفل الشيفت ومش هنفتح غيره
    closeCashShift({
      shift_id: shift.id,
      closing_counted_amount: 0,
      left_for_next_shift: 0,
      closed_by: 1,
    });

    expect(getOpenCashShift()).toBeNull();

    const movementsBefore = db
      .prepare(
        `
    SELECT COUNT(*) AS count FROM cash_movements
  `,
      )
      .get() as { count: number };

    // استبدال 200 بقطعة 150
    // الفرق كله خفض مديونية
    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      reason: 'Debt-only exchange without shift',
      items: [
        {
          promotion_unit_id: Number(unit.id),
          new_variant_id: newVariant.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(-50);
    expect(exchange.amount_to_collect).toBe(0);
    expect(exchange.amount_to_refund).toBe(0);
    expect(exchange.debt_reduction_amount).toBe(50);

    // العملية تمت بدون شيفت
    expect(exchange.shift_id).toBeNull();

    // مديونية العميل أصبحت 150
    const customer = db
      .prepare(
        `
    SELECT balance FROM customers WHERE id = ?
  `,
      )
      .get(customerId) as { balance: number };

    expect(Number(customer.balance)).toBe(150);

    // لا توجد حركة مالية جديدة
    const movementsAfter = db
      .prepare(
        `
    SELECT COUNT(*) AS count FROM cash_movements
  `,
      )
      .get() as { count: number };

    expect(movementsAfter.count).toBe(movementsBefore.count);

    // الاستبدال محفوظ فعليًا
    const exchangeRow = db
      .prepare(
        `
    SELECT shift_id, debt_reduction_amount,
           cash_collection_amount, cash_refund_amount
    FROM sale_exchanges
    WHERE id = ?
  `,
      )
      .get(exchange.exchangeId) as any;

    expect(exchangeRow.shift_id).toBeNull();
    expect(Number(exchangeRow.debt_reduction_amount)).toBe(50);
    expect(Number(exchangeRow.cash_collection_amount)).toBe(0);
    expect(Number(exchangeRow.cash_refund_amount)).toBe(0);
  });

  it('preserves closed shift history when admin cancels a debt-only exchange without a shift', () => {
    const db = getDb();
    const catalog = seedExchangeCatalog();
    const shift1 = getOpenCashShift()!;

    const customerResult = db
      .prepare(
        `
    INSERT INTO customers (name, phone)
    VALUES (?, ?)
  `,
      )
      .run('Historical Debt Exchange Customer', '01077778888');

    const customerId = Number(customerResult.lastInsertRowid);

    const oldVariant = catalog.variants.EX200;
    const newVariant = catalog.variants.EX150;

    // فاتورة آجل 200 جنيه.
    const sale = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 200,
      discount_value: 0,
      grand_total: 200,
      paid: 0,
      remaining_amount: 200,
      payment_status: 'unpaid',
      change_amount: 0,
      payment_method: 'store_cash',
      items: [
        {
          variant_id: oldVariant.variant_id,
          product_name: oldVariant.product_name,
          barcode: oldVariant.barcode,
          size: oldVariant.size,
          color: oldVariant.color,
          quantity: 1,
          unit_price: 200,
        },
      ],
    });

    const state = getSaleExchangeState(sale.saleId);

    const group = state.groups.find(
      (item: any) => item.group_kind === 'regular',
    );

    expect(group).toBeTruthy();

    // استبدال 200 بقطعة 150 داخل Shift 1.
    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,
      payment_method: 'store_cash',
      items: [
        {
          promotion_unit_id: Number(group!.units[0].id),
          new_variant_id: newVariant.variant_id,
        },
      ],
    });

    expect(exchange.difference_amount).toBe(-50);
    expect(exchange.debt_reduction_amount).toBe(50);
    expect(exchange.amount_to_collect).toBe(0);
    expect(exchange.amount_to_refund).toBe(0);

    const before = getCashShiftDetails(shift1.id);

    expect(before.sales_summary.net_sales).toBe(150);
    expect(before.operations_summary.exchange_difference).toBe(-50);

    const closingAmount = Number(before.preview.expected_closing_amount);

    expect(closingAmount).toBe(0);

    // نقفل الشيفت القديم.
    closeCashShift({
      shift_id: shift1.id,
      closing_counted_amount: closingAmount,
      left_for_next_shift: closingAmount,
      closed_by: 1,
    });

    expect(getOpenCashShift()).toBeNull();

    const movementsBefore = (
      db.prepare('SELECT COUNT(*) AS count FROM cash_movements').get() as {
        count: number;
      }
    ).count;

    // الأدمن يلغي الاستبدال خارج أي شيفت.
    const cancelled = cancelSaleExchange({
      exchange_id: exchange.exchangeId,
      actor_id: 1,
      reason: 'Cancel debt-only exchange outside shift',
    });

    expect(cancelled.ok).toBe(true);
    expect(cancelled.cancelled_shift_id).toBeNull();
    expect(cancelled.cash_refunded).toBe(0);
    expect(cancelled.cash_collected).toBe(0);
    expect(cancelled.debt_restored).toBe(50);

    // المديونية رجعت إلى 200.
    const customer = db
      .prepare(
        `
    SELECT balance FROM customers WHERE id = ?
  `,
      )
      .get(customerId) as { balance: number };

    expect(Number(customer.balance)).toBe(200);

    const saleRow = db
      .prepare(
        `
    SELECT remaining_amount FROM sales WHERE id = ?
  `,
      )
      .get(sale.saleId) as { remaining_amount: number };

    expect(Number(saleRow.remaining_amount)).toBe(200);

    // مفيش حركة فلوس جديدة.
    const movementsAfter = (
      db.prepare('SELECT COUNT(*) AS count FROM cash_movements').get() as {
        count: number;
      }
    ).count;

    expect(movementsAfter).toBe(movementsBefore);

    // المخزون رجع لحالته بعد البيع وقبل الاستبدال.
    expect(getStock('EX200')).toBe(19);
    expect(getStock('EX150')).toBe(20);

    // الأهم: تاريخ الشيفت المقفول لا يتغير.
    const after = getCashShiftDetails(shift1.id);

    expect(after.sales_summary.net_sales).toBe(150);
    expect(after.operations_summary.exchange_difference).toBe(-50);

    expect(after.sales_summary).toEqual(before.sales_summary);
    expect(after.operations_summary).toEqual(before.operations_summary);
    expect(after.preview).toEqual(before.preview);
  });

  it('allows admin exchange on store safe without an open shift', () => {
    const db = getDb();

    const result = createPromotionSale(['EX250', 'EX200', 'EX150']);

    const currentShift = getOpenCashShift();

    expect(currentShift).toBeTruthy();

    closeCashShift({
      shift_id: currentShift!.id,
      closing_counted_amount: 450,
      left_for_next_shift: 0,
      closed_by: 1,
    });

    expect(getOpenCashShift()).toBeNull();

    const giftUnit = getUnitByPrice(result.sale.saleId, 150);

    const exchange = createSaleExchange({
      original_sale_id: result.sale.saleId,

      user_id: 1,

      payment_method: 'store_safe',

      items: [
        {
          promotion_unit_id: Number(giftUnit.id),

          new_variant_id: result.variants.EX300.variant_id,
        },
      ],
    });

    expect(exchange.amount_to_collect).toBe(100);

    expect(exchange.shift_id).toBeNull();

    const row = db
      .prepare(
        `
      SELECT
        shift_id,
        payment_method

      FROM sale_exchanges

      WHERE id = ?
      `,
      )
      .get(exchange.exchangeId) as any;

    expect(row.shift_id).toBeNull();

    expect(row.payment_method).toBe('store_safe');

    const movement = db
      .prepare(
        `
      SELECT
        shift_id,
        payment_method,
        direction,
        amount

      FROM cash_movements

      WHERE reference_type = 'sale_exchange'
        AND reference_id = ?

      LIMIT 1
      `,
      )
      .get(exchange.exchangeId) as any;

    expect(movement.shift_id).toBeNull();

    expect(movement.payment_method).toBe('store_safe');

    expect(movement.direction).toBe('in');

    expect(Number(movement.amount)).toBe(100);
  });
});
