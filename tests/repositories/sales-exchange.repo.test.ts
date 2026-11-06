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
