import { ipcMain } from 'electron';
import { getActorId, logAction } from './activity-helper';
import {
  createSale,
  getSaleReceipt,
  listSales,
  createSaleReturn
} from '../database/repositories/sales.repo';

import { getVariantByBarcode, searchSaleVariants } from '../database/repositories/product.repo';

export function registerSalesIpc(): void {
  ipcMain.handle('sales:search-variants', (_, query: string) => {
    return searchSaleVariants(query ?? '');
  });

  ipcMain.handle('sales:get-variant-by-barcode', (_, barcode: string) => {
    return getVariantByBarcode(barcode ?? '');
  });

  ipcMain.handle('sales:create', (_, input) => {
    const result = createSale(input);

    logAction({
      actor_id: getActorId(input),
      action: 'sale_created',
      entity: 'sales',
      entity_id: result.saleId,
      details: {
        customer_id: input.customer_id ?? null,
        grand_total: result.grand_total ?? input.grand_total,
        paid: input.paid,
        payment_method: input.payment_method,
        items_count: input.items?.length || 0
      }
    });

    return result;
  });

  ipcMain.handle('sales:get-receipt', (_, saleId: number) => {
    return getSaleReceipt(Number(saleId));
  });

  ipcMain.handle('sales:list', (_, input) => {
    return listSales(input);
  });

  ipcMain.handle('sales:return', (_, input) => {
    const result = createSaleReturn(input);

    logAction({
      actor_id: getActorId(input),
      action: 'sale_return_created',
      entity: 'sales',
      entity_id: result.returnSaleId,
      details: {
        original_sale_id: result.originalSaleId,
        refund_amount: result.refundAmount,
        reason: input.reason,
        items_count: input.items?.length || 0
      }
    });

    return result;
  });

}