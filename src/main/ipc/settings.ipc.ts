import { ipcMain } from 'electron';
import {
  getBarcodePrintSettings,
  saveBarcodePrintSettings,
  getLoyaltySettings,
  saveLoyaltySettings
} from '../database/repositories/settings.repo';


export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get-barcode-print', () => {
    return getBarcodePrintSettings();
  });

  ipcMain.handle('settings:save-barcode-print', (_, input) => {
    return saveBarcodePrintSettings(input);
  });

  ipcMain.handle('settings:get-loyalty', () => {
    return getLoyaltySettings();
  });

  ipcMain.handle('settings:save-loyalty', (_, input) => {
    return saveLoyaltySettings(input);
  });
}