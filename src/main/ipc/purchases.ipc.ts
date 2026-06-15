import { ipcMain } from 'electron';
import { getActorId, logAction } from './activity-helper';
import {
  createPurchaseInvoice,
  getPurchaseInvoice,
  listPurchaseInvoices,
  recordSupplierPayment,
  getSupplierStatement,
  cancelPurchaseInvoice,
  createPurchaseReturn,
  listPurchaseReturns,
  getPurchaseReturn
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

  ipcMain.handle('purchases:cancel', (_, input) => {
    const result = cancelPurchaseInvoice({
      purchase_id: Number(input.purchase_id),
      reason: input.reason || '',
      actor_id: getActorId(input)
    });

    logAction({
      actor_id: getActorId(input),
      action: 'purchase_cancelled',
      entity: 'purchase_invoices',
      entity_id: Number(input.purchase_id),
      details: {
        purchase_id: Number(input.purchase_id),
        reason: input.reason || '',
        reversed_total: result.reversed_total,
        reversed_paid: result.reversed_paid,
        reversed_remaining: result.reversed_remaining,
        items_count: result.items_count
      }
    });

    return result;
  });

  ipcMain.handle('purchases:returns:create', (_, input) => {
    const result = createPurchaseReturn({
      ...input,
      purchase_id: Number(input.purchase_id),
      actor_id: getActorId(input)
    });

    logAction({
      actor_id: getActorId(input),
      action: 'purchase_return_created',
      entity: 'purchase_returns',
      entity_id: result.return_id,
      details: {
        purchase_id: Number(input.purchase_id),
        supplier_id: result.supplier_id,
        total_amount: result.total_amount,
        items_count: input.items?.length || 0,
        notes: input.notes || ''
      }
    });

    return result;
  });

  ipcMain.handle('purchases:returns:list', (_, input) => {
    return listPurchaseReturns(input);
  });

  ipcMain.handle('purchases:returns:get-by-id', (_, returnId: number) => {
    return getPurchaseReturn(Number(returnId));
  });

  ipcMain.handle('suppliers:record-payment', (_, input) => {
    return recordSupplierPayment(input);
  });

  ipcMain.handle('suppliers:statement', (_, supplierId: number) => {
    return getSupplierStatement(Number(supplierId));
  });
}