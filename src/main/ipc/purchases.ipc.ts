import { ipcMain } from 'electron';
import { getActorId, logAction } from './activity-helper';
import {
  createPurchaseInvoice,
  getPurchaseInvoice,
  listPurchaseInvoices,
  recordSupplierPayment,
  getSupplierStatement
} from '../database/repositories/purchases.repo';

export function registerPurchasesIpc(): void {
  
  ipcMain.handle('purchases:create', (_, input) => {
    const result = createPurchaseInvoice(input);

    logAction({
      actor_id: getActorId(input),
      action: 'purchase_created',
      entity: 'purchase_invoices',
      entity_id: result.purchaseId,
      details: {
        supplier_id: input.supplier_id,
        total_amount: result.total_amount,
        paid_amount: result.paid_amount,
        remaining_amount: result.remaining_amount,
        payment_status: result.payment_status,
        items_count: input.items?.length || 0
      }
    });

    return result;
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