import { ipcMain } from 'electron';
import {
  createSupplier,
  deleteSupplier,
  getSupplierById,
  getSuppliers,
  updateSupplier
} from '../database/repositories/suppliers.repo';

export function registerSuppliersIpc(): void {
  ipcMain.handle('suppliers:list', (_, search?: string) => {
    return getSuppliers(search ?? '');
  });

  ipcMain.handle('suppliers:get-by-id', (_, id: number) => {
    return getSupplierById(Number(id));
  });

  ipcMain.handle('suppliers:create', (_, input) => {
    return createSupplier(input);
  });

  ipcMain.handle('suppliers:update', (_, input) => {
    return updateSupplier(input);
  });

  ipcMain.handle('suppliers:delete', (_, id: number) => {
    return deleteSupplier(Number(id));
  });
}