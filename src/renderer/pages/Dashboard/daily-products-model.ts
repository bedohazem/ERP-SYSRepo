export type DailyProductRow = {
  variant_id: number;
  product_name: string;
  size: string;
  color: string;
  sold_quantity: number;
  returned_quantity: number;
  exchange_quantity: number;
  cancellation_quantity: number;
  net_quantity: number;
};

export function filterDailyProducts(
  rows: readonly DailyProductRow[],
  search: string,
): DailyProductRow[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return [...rows];

  return rows.filter((item) =>
    [item.product_name, item.size, item.color, String(item.variant_id)]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query),
  );
}

export function paginateDailyProducts(
  rows: readonly DailyProductRow[],
  page: number,
  pageSize = 50,
): DailyProductRow[] {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error('Invalid daily products page size');
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const requestedPage = Number.isFinite(page) ? Math.trunc(page) : 1;
  const safePage = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (safePage - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function summarizeDailyProducts(rows: readonly DailyProductRow[]) {
  return rows.reduce(
    (total, row) => ({
      sold: total.sold + row.sold_quantity,
      returned: total.returned + row.returned_quantity,
      exchanged: total.exchanged + row.exchange_quantity,
      cancelled: total.cancelled + row.cancellation_quantity,
      net: total.net + row.net_quantity,
    }),
    { sold: 0, returned: 0, exchanged: 0, cancelled: 0, net: 0 },
  );
}
