import { ipcMain } from 'electron';
import {
  adjustVariantStock,
  getInventoryList,
  getStockMovements
} from '../database/repositories/inventory.repo';

export function registerInventoryIpc(): void {
  ipcMain.handle('inventory:list', (_, input) => {
    return getInventoryList(input);
  });

  ipcMain.handle('inventory:adjust-stock', (_, input) => {
    return adjustVariantStock(input);
  });

  ipcMain.handle('inventory:movements', (_, input) => {
    return getStockMovements(input);
  });
}