import { ipcMain } from 'electron';
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
    return createSale(input);
  });

  ipcMain.handle('sales:get-receipt', (_, saleId: number) => {
    return getSaleReceipt(Number(saleId));
  });

  ipcMain.handle('sales:list', (_, input) => {
    return listSales(input);
  });

  ipcMain.handle('sales:return', (_, input) => {
    return createSaleReturn(input);
  });

}