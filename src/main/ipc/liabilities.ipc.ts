import { ipcMain } from 'electron';
import {
  cancelLiability,
  createLiability,
  getLiabilitiesSummary,
  getLiabilityStatement,
  listLiabilities,
  recordLiabilityPayment
} from '../database/repositories/liabilities.repo';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع';
}

export function registerLiabilitiesIpc(): void {
  ipcMain.handle('liabilities:list', (_, input) => {
    return listLiabilities(input);
  });

  ipcMain.handle('liabilities:create', (_, input) => {
    try {
      return createLiability(input);
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('liabilities:record-payment', (_, input) => {
    try {
      return recordLiabilityPayment(input);
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('liabilities:statement', (_, liabilityId: number) => {
    return getLiabilityStatement(liabilityId);
  });

  ipcMain.handle('liabilities:cancel', (_, input) => {
    try {
      return cancelLiability(input);
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('liabilities:summary', (_, input) => {
    return getLiabilitiesSummary(input);
  });
}