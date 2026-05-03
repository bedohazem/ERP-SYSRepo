import { getDb } from '../db';

export type CreateSaleLineInput = {
  variant_id: number;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  quantity: number;
  unit_price: number;
};

type CreateSaleInput = {
  user_id: number;
  customer_id?: number | null;

  sub_total: number;
  discount_value: number;
  grand_total: number;
  paid: number;
  change_amount: number;
  payment_method: string;
  notes?: string | null;

  loyalty_points_redeemed?: number;
  loyalty_discount_value?: number;

  items: Array<{
    variant_id: number;
    product_name: string;
    barcode?: string | null;
    size?: string | null;
    color?: string | null;
    quantity: number;
    unit_price: number;
  }>;
};

function getSetting(key: string, fallback: string) {
  const db = getDb();

  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ? LIMIT 1`)
    .get(key) as { value: string } | undefined;

  return row?.value ?? fallback;
}

function getLoyaltySettingsForSale() {
  return {
    enabled: getSetting('loyalty_enabled', 'true') === 'true',
    earnAmount: Number(getSetting('loyalty_earn_amount', '100')),
    earnPoints: Number(getSetting('loyalty_earn_points', '1')),
    pointValue: Number(getSetting('loyalty_point_value', '1')),
    minRedeemPoints: Number(getSetting('loyalty_min_redeem_points', '1'))
  };
}

export function createSale(input: CreateSaleInput) {
  const db = getDb();

  if (!input.user_id) {
    throw new Error('User ID is required');
  }

  if (!input.items?.length) {
    throw new Error('Sale items are required');
  }

  const loyalty = getLoyaltySettingsForSale();

  const customerId = input.customer_id ? Number(input.customer_id) : null;
  const requestedRedeemPoints = Number(input.loyalty_points_redeemed || 0);

  const tx = db.transaction(() => {
    let redeemPoints = 0;
    let loyaltyDiscountValue = 0;

    if (loyalty.enabled && customerId && requestedRedeemPoints > 0) {
      const customer = db
        .prepare(`SELECT points_balance FROM customers WHERE id = ? LIMIT 1`)
        .get(customerId) as { points_balance: number } | undefined;

      if (!customer) {
        throw new Error('العميل غير موجود');
      }

      if (requestedRedeemPoints < loyalty.minRedeemPoints) {
        throw new Error(`أقل عدد نقاط للاستخدام هو ${loyalty.minRedeemPoints}`);
      }

      if (requestedRedeemPoints > Number(customer.points_balance || 0)) {
        throw new Error('رصيد نقاط العميل غير كافي');
      }

      redeemPoints = requestedRedeemPoints;
      loyaltyDiscountValue = redeemPoints * loyalty.pointValue;
    }

    const subTotal = Number(input.sub_total || 0);
    const normalDiscount = Number(input.discount_value || 0);
    const grandTotal = Math.max(0, subTotal - normalDiscount - loyaltyDiscountValue);

    const earnedPoints =
      loyalty.enabled && customerId
        ? Math.floor(grandTotal / loyalty.earnAmount) * loyalty.earnPoints
        : 0;

    const saleResult = db
      .prepare(`
        INSERT INTO sales (
          type,
          customer_id,
          user_id,
          sub_total,
          discount_value,
          grand_total,
          paid,
          change_amount,
          payment_method,
          notes,
          loyalty_points_earned,
          loyalty_points_redeemed,
          loyalty_discount_value
        )
        VALUES (
          'sale',
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `)
      .run(
        customerId,
        input.user_id,
        subTotal,
        normalDiscount,
        grandTotal,
        Number(input.paid || grandTotal),
        Number(input.change_amount || 0),
        input.payment_method || 'cash',
        input.notes ?? null,
        earnedPoints,
        redeemPoints,
        loyaltyDiscountValue
      );

    const saleId = Number(saleResult.lastInsertRowid);

    const insertItem = db.prepare(`
      INSERT INTO sale_items (
        sale_id,
        variant_id,
        product_name,
        barcode,
        size,
        color,
        quantity,
        unit_cost,
        unit_price,
        line_total
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStock = db.prepare(`
      INSERT INTO stock_movements (
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes
      )
      VALUES (?, 'out', ?, ?, 'sale', ?)
    `);

    const getVariantCost = db.prepare(`
      SELECT buy_price
      FROM product_variants
      WHERE id = ?
      LIMIT 1
    `);

    for (const item of input.items) {
      const qty = Number(item.quantity || 0);
      const price = Number(item.unit_price || 0);
      const lineTotal = qty * price;

      const variant = getVariantCost.get(item.variant_id) as
        | { buy_price: number }
        | undefined;

      insertItem.run(
        saleId,
        item.variant_id,
        item.product_name,
        item.barcode ?? null,
        item.size ?? null,
        item.color ?? null,
        qty,
        Number(variant?.buy_price || 0),
        price,
        lineTotal
      );

      updateStock.run(
        item.variant_id,
        qty,
        saleId,
        `بيع فاتورة رقم ${saleId}`
      );
    }

    if (customerId && loyalty.enabled) {
      db.prepare(`
        UPDATE customers
        SET
          points_balance = points_balance + ? - ?,
          total_spent = total_spent + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(earnedPoints, redeemPoints, grandTotal, customerId);

      if (earnedPoints > 0) {
        db.prepare(`
          INSERT INTO loyalty_transactions (
            customer_id,
            sale_id,
            type,
            points,
            amount,
            notes
          )
          VALUES (?, ?, 'earn', ?, ?, ?)
        `).run(
          customerId,
          saleId,
          earnedPoints,
          grandTotal,
          `اكتساب نقاط من فاتورة رقم ${saleId}`
        );
      }

      if (redeemPoints > 0) {
        db.prepare(`
          INSERT INTO loyalty_transactions (
            customer_id,
            sale_id,
            type,
            points,
            amount,
            notes
          )
          VALUES (?, ?, 'redeem', ?, ?, ?)
        `).run(
          customerId,
          saleId,
          -redeemPoints,
          loyaltyDiscountValue,
          `استخدام نقاط في فاتورة رقم ${saleId}`
        );
      }
    }

    return {
      saleId,
      loyalty_points_earned: earnedPoints,
      loyalty_points_redeemed: redeemPoints,
      loyalty_discount_value: loyaltyDiscountValue,
      grand_total: grandTotal
    };
  });

  return tx();
}
