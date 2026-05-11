import { ipcMain } from 'electron';
import {
  createPurchaseInvoice,
  getPurchaseInvoice,
  listPurchaseInvoices,
  recordSupplierPayment,
  getSupplierStatement
} from '../database/repositories/purchases.repo';

export function registerPurchasesIpc(): void {
  ipcMain.handle('purchases:create', (_, input) => {
    return createPurchaseInvoice(input);
  });

  ipcMain.handle('purchases:list', (_, input) => {
    return listPurchaseInvoices(input);
  });

  ipcMain.handle('purchases:get-by-id', (_, purchaseId: number) => {
    return getPurchaseInvoice(Number(purchaseId));
  });

  ipcMain.handle('suppliers:record-payment', (_, input) => {
    return recordSupplierPayment(input);
  });

  ipcMain.handle('suppliers:statement', (_, supplierId: number) => {
    return getSupplierStatement(Number(supplierId));
  });
  
}