/**
 * Immutable financial events used by period-based sales reports.
 * The caller supplies the existing shift-aware date expressions.
 */
export type FinancialJournalDates = {
  sale: string;
  saleCancel: string;
  saleReturn: string;
  saleReturnCancel: string;
  exchange: string;
  exchangeCancel: string;
};

export const saleCancelledLater = (alias: string) => `
  ${alias}.cancelled_at IS NOT NULL AND (
    COALESCE(${alias}.cancelled_outside_shift, 0) = 1
    OR (
      ${alias}.cancelled_shift_id IS NOT NULL
      AND (
        ${alias}.shift_id IS NULL
        OR ${alias}.cancelled_shift_id <> ${alias}.shift_id
      )
    )
  )
`;

export const returnCancelledLater = (alias: string) => `
  ${alias}.cancelled_at IS NOT NULL AND (
    COALESCE(${alias}.cancelled_outside_shift, 0) = 1
    OR (
      ${alias}.cancelled_shift_id IS NOT NULL
      AND (
        ${alias}.shift_id IS NULL
        OR ${alias}.cancelled_shift_id <> ${alias}.shift_id
      )
    )
  )
`;

export const exchangeCancelledLater = (alias: string) => `
  ${alias}.cancelled_at IS NOT NULL AND (
    COALESCE(${alias}.cancelled_outside_shift, 0) = 1
    OR (
      ${alias}.cancelled_shift_id IS NOT NULL
      AND (
        ${alias}.shift_id IS NULL
        OR ${alias}.cancelled_shift_id <> ${alias}.shift_id
      )
    )
  )
`;

const originalSaleVisible = (alias: string) => `
  (${alias}.cancelled_at IS NULL OR (${saleCancelledLater(alias)}))
`;
const originalReturnVisible = (alias: string) => `
  (${alias}.cancelled_at IS NULL OR (${returnCancelledLater(alias)}))
`;
const originalExchangeVisible = (alias: string) => `
  (${alias}.cancelled_at IS NULL OR (${exchangeCancelledLater(alias)}))
`;

export function buildSalesFinancialJournalSql(dates: FinancialJournalDates) {
  const saleCost = `COALESCE((
    SELECT SUM(COALESCE(si.cost_value, si.unit_cost * si.quantity, 0))
    FROM sale_items si WHERE si.sale_id = s.id
  ), 0)`;
  const saleList = `COALESCE((
    SELECT SUM(COALESCE(si.list_unit_price, si.unit_price, 0) * si.quantity)
    FROM sale_items si WHERE si.sale_id = s.id
  ), 0)`;
  const returnCost = `COALESCE((
    SELECT SUM(COALESCE(sri.cost_value, sri.unit_cost * sri.quantity, 0))
    FROM sale_return_items sri WHERE sri.return_id = sr.id
  ), 0)`;
  const returnList = `COALESCE((
    SELECT SUM(COALESCE(sri.list_unit_price, sri.unit_price, 0) * sri.quantity)
    FROM sale_return_items sri WHERE sri.return_id = sr.id
  ), 0)`;
  const exchangeCost = `COALESCE((
    SELECT SUM(
      COALESCE(sei.new_cost_value, sei.new_unit_cost * sei.quantity, 0)
      - COALESCE(sei.old_cost_value, sei.old_unit_cost * sei.quantity, 0)
    ) FROM sale_exchange_items sei WHERE sei.exchange_id = se.id
  ), 0)`;
  const exchangeList = `COALESCE((
    SELECT SUM(
      (COALESCE(sei.new_list_unit_price, sei.new_unit_price, 0)
      - COALESCE(sei.old_list_unit_price, sei.old_unit_price, 0)) * sei.quantity
    ) FROM sale_exchange_items sei WHERE sei.exchange_id = se.id
  ), 0)`;
  const returnNormalDiscount = `CASE
    WHEN sr.normal_discount_value IS NOT NULL THEN sr.normal_discount_value
    ELSE MAX(0, sr.sub_total - sr.refund_amount
      - COALESCE(sr.loyalty_discount_value, 0)
      - COALESCE(sr.promotion_discount_value, 0))
  END`;

  const saleEvent = (reversal: boolean) => {
    const sign = reversal ? -1 : 1;
    return `
      SELECT
        ${reversal ? dates.saleCancel : dates.sale} AS business_date,
        s.user_id AS user_id,
        s.user_id AS cashier_id,
        s.salesperson_id, s.salesperson_name, s.customer_id,
        ${reversal ? 0 : 1} AS sales_count,
        0 AS returns_count, 0 AS exchange_count,
        (${sign}) * s.grand_total AS sale_amount,
        0 AS return_amount, 0 AS exchange_adjustment,
        0 AS exchange_discount_adjustment,
        0 AS exchange_cash_collection, 0 AS exchange_cash_refund,
        0 AS exchange_debt_reduction,
        (${sign}) * COALESCE(s.product_discount_value, 0) AS product_discounts,
        (${sign}) * COALESCE(s.discount_value, 0) AS normal_discounts,
        (${sign}) * COALESCE(s.promotion_discount_value, 0) AS promotion_discounts,
        (${sign}) * COALESCE(s.loyalty_discount_value, 0) AS loyalty_discounts,
        (${sign}) * (${saleList} - ${saleCost}) AS gross_profit,
        (${sign}) * (s.grand_total - ${saleCost}) AS net_profit
      FROM sales s
      WHERE COALESCE(s.type, 'sale') = 'sale'
        AND (${reversal ? saleCancelledLater('s') : originalSaleVisible('s')})
    `;
  };

  const returnEvent = (reversal: boolean) => {
    const sign = reversal ? -1 : 1;
    return `
      SELECT
        ${reversal ? dates.saleReturnCancel : dates.saleReturn} AS business_date,
        sr.user_id AS user_id,
        os.user_id AS cashier_id,
        os.salesperson_id, os.salesperson_name, os.customer_id,
        0 AS sales_count, ${reversal ? 0 : 1} AS returns_count,
        0 AS exchange_count,
        0 AS sale_amount,
        (${sign}) * sr.refund_amount AS return_amount,
        0 AS exchange_adjustment,
        0 AS exchange_discount_adjustment,
        0 AS exchange_cash_collection, 0 AS exchange_cash_refund,
        0 AS exchange_debt_reduction,
        -(${sign}) * COALESCE(sr.product_discount_value, 0) AS product_discounts,
        -(${sign}) * (${returnNormalDiscount}) AS normal_discounts,
        -(${sign}) * COALESCE(sr.promotion_discount_value, 0) AS promotion_discounts,
        -(${sign}) * COALESCE(sr.loyalty_discount_value, 0) AS loyalty_discounts,
        -(${sign}) * (${returnList} - ${returnCost}) AS gross_profit,
        -(${sign}) * (sr.refund_amount - ${returnCost}) AS net_profit
      FROM sale_returns sr
      JOIN sales os ON os.id = sr.original_sale_id
      WHERE COALESCE(os.type, 'sale') = 'sale'
        AND (${originalSaleVisible('os')})
        AND (${reversal ? returnCancelledLater('sr') : originalReturnVisible('sr')})
    `;
  };

  const exchangeEvent = (reversal: boolean) => {
    const sign = reversal ? -1 : 1;
    const discount = (type: string) =>
      `COALESCE(se.new_${type}_discount_value, se.old_${type}_discount_value, 0)
        - COALESCE(se.old_${type}_discount_value, 0)`;
    return `
      SELECT
        ${reversal ? dates.exchangeCancel : dates.exchange} AS business_date,
        se.user_id AS user_id,
        os.user_id AS cashier_id,
        os.salesperson_id, os.salesperson_name, os.customer_id,
        0 AS sales_count, 0 AS returns_count,
        ${reversal ? 0 : 1} AS exchange_count,
        0 AS sale_amount, 0 AS return_amount,
        (${sign}) * se.difference_amount AS exchange_adjustment,
        (${sign}) * (${exchangeList} - se.difference_amount) AS exchange_discount_adjustment,
        (${sign}) * COALESCE(se.cash_collection_amount,0) AS exchange_cash_collection,
        (${sign}) * COALESCE(se.cash_refund_amount,0) AS exchange_cash_refund,
        (${sign}) * COALESCE(se.debt_reduction_amount,0) AS exchange_debt_reduction,
        (${sign}) * (${discount('product')}) AS product_discounts,
        (${sign}) * (${discount('normal')}) AS normal_discounts,
        (${sign}) * (${discount('promotion')}) AS promotion_discounts,
        (${sign}) * (${discount('loyalty')}) AS loyalty_discounts,
        (${sign}) * (${exchangeList} - ${exchangeCost}) AS gross_profit,
        (${sign}) * (se.difference_amount - ${exchangeCost}) AS net_profit
      FROM sale_exchanges se
      JOIN sales os ON os.id = se.original_sale_id
      WHERE COALESCE(os.type, 'sale') = 'sale'
        AND (${originalSaleVisible('os')})
        AND (${reversal ? exchangeCancelledLater('se') : originalExchangeVisible('se')})
    `;
  };

  return [
    saleEvent(false),
    saleEvent(true),
    returnEvent(false),
    returnEvent(true),
    exchangeEvent(false),
    exchangeEvent(true),
  ].join('\nUNION ALL\n');
}

export function buildSalesProductJournalSql(dates: FinancialJournalDates) {
  const sale = (reverse: boolean) => `
    SELECT si.variant_id, si.product_name, si.size, si.color,
      (${reverse ? -1 : 1}) * si.quantity AS quantity,
      (${reverse ? -1 : 1}) * si.line_total AS total,
      ${reverse ? dates.saleCancel : dates.sale} AS business_date,
      s.user_id AS user_id
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE COALESCE(s.type, 'sale') = 'sale'
      AND (${reverse ? saleCancelledLater('s') : originalSaleVisible('s')})
  `;
  const returned = (reverse: boolean) => `
    SELECT sri.variant_id, sri.product_name, sri.size, sri.color,
      (${reverse ? 1 : -1}) * sri.quantity AS quantity,
      (${reverse ? 1 : -1}) * sri.line_total AS total,
      ${reverse ? dates.saleReturnCancel : dates.saleReturn} AS business_date,
      sr.user_id AS user_id
    FROM sale_return_items sri
    JOIN sale_returns sr ON sr.id = sri.return_id
    JOIN sales os ON os.id = sr.original_sale_id
    WHERE COALESCE(os.type, 'sale') = 'sale'
      AND (${originalSaleVisible('os')})
      AND (${reverse ? returnCancelledLater('sr') : originalReturnVisible('sr')})
  `;
  const exchanged = (old: boolean, reverse: boolean) => {
    const variant = old ? 'old' : 'new';
    const sign = (old ? -1 : 1) * (reverse ? -1 : 1);
    return `
      SELECT sei.${variant}_variant_id AS variant_id,
        p.name AS product_name, pv.size, pv.color,
        (${sign}) * sei.quantity AS quantity,
        (${sign}) * sei.${variant}_unit_price * sei.quantity AS total,
        ${reverse ? dates.exchangeCancel : dates.exchange} AS business_date,
        se.user_id AS user_id
      FROM sale_exchange_items sei
      JOIN sale_exchanges se ON se.id = sei.exchange_id
      JOIN sales os ON os.id = se.original_sale_id
      JOIN product_variants pv ON pv.id = sei.${variant}_variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE COALESCE(os.type, 'sale') = 'sale'
        AND (${originalSaleVisible('os')})
        AND (${reverse ? exchangeCancelledLater('se') : originalExchangeVisible('se')})
    `;
  };
  return [
    sale(false),
    sale(true),
    returned(false),
    returned(true),
    exchanged(true, false),
    exchanged(false, false),
    exchanged(true, true),
    exchanged(false, true),
  ].join('\nUNION ALL\n');
}
