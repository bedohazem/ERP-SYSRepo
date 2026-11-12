import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createCategory,
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';
import {
  createSale,
  createSaleReturn,
} from '../../src/main/database/repositories/sales.repo';
import {
  createSaleExchange,
  cancelSaleExchange,
  getSaleExchangeState,
} from '../../src/main/database/repositories/sales-exchange.repo';
import { getSaleCurrentState } from '../../src/main/database/repositories/sales-current-state.repo';
import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo';

function setup() {
  const category = createCategory({ name: 'Discount exchange tests' });
  createProduct({
    name: 'Exchange disc item',
    category_id: category.id,
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'ED100',
        size: '1',
        color: 'Black',
        buy_price: 40,
        sell_price: 100,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'ED150',
        size: '2',
        color: 'Black',
        buy_price: 60,
        sell_price: 150,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'ED200',
        size: '3',
        color: 'Black',
        buy_price: 80,
        sell_price: 200,
        min_stock: 1,
        opening_qty: 20,
      },
    ],
  });
  const oldVariant = getVariantByBarcode('ED100') as any;
  const nextVariant = getVariantByBarcode('ED150') as any;
  const lastVariant = getVariantByBarcode('ED200') as any;
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
  const state = getSaleExchangeState(sale.saleId);
  const group = state.groups.find((g: any) => g.group_kind === 'regular');
  if (!group || group.units.length !== 1)
    throw new Error('Missing regular unit');
  const saleItem = getDb()
    .prepare('SELECT id FROM sale_items WHERE sale_id = ?')
    .get(sale.saleId) as { id: number };
  return {
    saleId: sale.saleId,
    unitId: Number(group.units[0].id),
    nextVariant,
    lastVariant,
    saleItemId: saleItem.id,
  };
}

function swap(
  data: ReturnType<typeof setup>,
  variantId: number,
  amount: number,
  type: 'amount' | 'percent' = 'amount',
) {
  return createSaleExchange({
    original_sale_id: data.saleId,
    user_id: 1,
    payment_method: 'store_cash',
    discount_type: type,
    discount_input: amount,
    items: [{ promotion_unit_id: data.unitId, new_variant_id: variantId }],
  });
}

function persisted(exchangeId: number) {
  return getDb()
    .prepare(
      `
    SELECT exchange_discount_value, exchange_discount_delta, difference_amount,
           discount_input, discount_type, cash_collection_amount
    FROM sale_exchanges WHERE id = ?
  `,
    )
    .get(exchangeId) as any;
}

describe('discretionary exchange discount repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
    openCashShift({ opening_counted_amount: 0, opened_by: 1 });
  }, 30_000);

  it('applies a fixed discount only to the positive difference and persists the unit share', () => {
    const data = setup();
    const ex = swap(data, data.nextVariant.variant_id, 10);
    expect(ex.exchange_discount_value).toBe(10);
    expect(ex.difference_amount).toBe(40);
    expect(ex.amount_to_collect).toBe(40);
    expect(persisted(ex.exchangeId)).toMatchObject({
      exchange_discount_value: 10,
      exchange_discount_delta: 10,
      difference_amount: 40,
      cash_collection_amount: 40,
      discount_input: 10,
      discount_type: 'amount',
    });
    expect(
      Number(
        getSaleCurrentState(data.saleId).financials
          .current_exchange_discount_value,
      ),
    ).toBe(10);
    expect(
      Number(getSaleCurrentState(data.saleId).financials.current_grand_total),
    ).toBe(140);
    const unit = getDb()
      .prepare(
        'SELECT current_exchange_discount_value FROM sale_promotion_units WHERE id = ?',
      )
      .get(data.unitId) as any;
    expect(unit.current_exchange_discount_value).toBe(10);
  });

  it('calculates a percent against the positive difference and caps overlarge grants', () => {
    const data = setup();
    const ex = swap(data, data.nextVariant.variant_id, 20, 'percent');
    expect(ex.exchange_discount_value).toBe(10);
    expect(ex.difference_amount).toBe(40);
    expect(
      cancelSaleExchange({ exchange_id: ex.exchangeId, actor_id: 1 }).ok,
    ).toBe(true);
    const capped = swap(data, data.nextVariant.variant_id, 999);
    expect(capped.exchange_discount_value).toBe(50);
    expect(capped.difference_amount).toBe(0);
    expect(capped.amount_to_collect).toBe(0);
    expect(
      Number(getSaleCurrentState(data.saleId).financials.current_grand_total),
    ).toBe(100);
  });

  it('keeps the previous grant on a repeat exchange and applies only the new grant', () => {
    const data = setup();
    const first = swap(data, data.nextVariant.variant_id, 10);
    expect(first.difference_amount).toBe(40);
    const second = swap(data, data.lastVariant.variant_id, 5);
    expect(second.exchange_discount_value).toBe(5);
    expect(second.exchange_discount_delta).toBe(5);
    expect(second.difference_amount).toBe(45);
    const state = getSaleCurrentState(data.saleId);
    expect(state.financials.current_exchange_discount_value).toBe(15);
    expect(state.financials.current_grand_total).toBe(185);
    expect(state.financials.financial_integrity_delta).toBe(0);
  });

  it('does not refund the discount when returning the replacement', () => {
    const data = setup();
    const exchange = swap(data, data.nextVariant.variant_id, 10);
    expect(exchange.difference_amount).toBe(40);
    const saleReturn = createSaleReturn({
      original_sale_id: data.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: data.saleItemId,
          variant_id: Number(data.nextVariant.variant_id),
          quantity: 1,
        },
      ],
    });
    expect(saleReturn.return_value).toBe(140);
    const refund = getDb()
      .prepare(
        'SELECT refund_amount, exchange_discount_value FROM sale_returns WHERE id = ?',
      )
      .get(saleReturn.returnId) as any;
    expect(Number(refund.refund_amount)).toBe(140);
    expect(Number(refund.exchange_discount_value)).toBe(10);
    const returnedItem = getDb()
      .prepare(
        'SELECT exchange_discount_value FROM sale_return_items WHERE return_id = ?',
      )
      .get(saleReturn.returnId) as any;
    expect(Number(returnedItem.exchange_discount_value)).toBe(10);
    expect(getSaleCurrentState(data.saleId).financials.net_grand_total).toBe(0);
  });

  it('restores the original unit and discount when cancelling the exchange', () => {
    const data = setup();
    const exchange = swap(data, data.nextVariant.variant_id, 10);
    expect(
      cancelSaleExchange({ exchange_id: exchange.exchangeId, actor_id: 1 }).ok,
    ).toBe(true);
    const state = getSaleCurrentState(data.saleId);
    expect(state.financials.current_exchange_discount_value).toBe(0);
    expect(state.financials.current_grand_total).toBe(100);
    expect(state.financials.financial_integrity_delta).toBe(0);
    const unit = getDb()
      .prepare(
        'SELECT current_exchange_discount_value FROM sale_promotion_units WHERE id = ?',
      )
      .get(data.unitId) as any;
    expect(unit.current_exchange_discount_value).toBe(0);
  });

  it('rejects invalid discounts without changing invoice or stock', () => {
    const data = setup();
    expect(() => swap(data, data.nextVariant.variant_id, -10)).toThrow();
    expect(() =>
      swap(data, data.nextVariant.variant_id, 101, 'percent'),
    ).toThrow();
    expect(
      getSaleCurrentState(data.saleId).financials.current_grand_total,
    ).toBe(100);
    expect(
      (getDb().prepare('SELECT COUNT(*) AS c FROM sale_exchanges').get() as any)
        .c,
    ).toBe(0);
  });
});
