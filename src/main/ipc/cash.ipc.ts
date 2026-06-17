import { ipcMain } from 'electron';

import {
  createCashMovement,
  createCashTransfer,
  getCashSummary,
  listCashMovements
} from '../database/repositories/cash.repo';

export function registerCashIpc(): void {
  ipcMain.handle('cash:summary', (_, input) => {
    return getCashSummary(input);
  });

  ipcMain.handle('cash:transfer', (_, input) => {
    return createCashTransfer(input);
  });

  ipcMain.handle('cash:list', (_, input) => {
    return listCashMovements(input);
  });

  ipcMain.handle('cash:create-movement', (_, input) => {
    return createCashMovement(input);
  });
}