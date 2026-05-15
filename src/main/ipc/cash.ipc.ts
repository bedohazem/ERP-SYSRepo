import { ipcMain } from 'electron';

import {
  createCashMovement,
  getCashSummary,
  listCashMovements
} from '../database/repositories/cash.repo';

export function registerCashIpc(): void {
  ipcMain.handle('cash:summary', () => {
    return getCashSummary();
  });

  ipcMain.handle('cash:list', () => {
    return listCashMovements();
  });

  ipcMain.handle('cash:create-movement', (_, input) => {
    return createCashMovement(input);
  });
}