import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  getBarcodePrintSettings,
  getLoyaltySettings,
  saveBarcodePrintSettings,
  saveLoyaltySettings
} from '../database/repositories/settings.repo';
import { closeDb, getDb, getDbPath } from '../database/db';

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'حدث خطأ غير متوقع';
}

function getDefaultBackupName() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0')
  ].join('-');

  return `erp-backup-${stamp}.db`;
}

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

  ipcMain.handle('settings:backup-database', async (event) => {
    try {
      const parentWindow = BrowserWindow.fromWebContents(event.sender) || undefined;

      const result = await dialog.showSaveDialog(parentWindow, {
        title: 'حفظ نسخة احتياطية',
        defaultPath: path.join(app.getPath('documents'), getDefaultBackupName()),
        filters: [
          { name: 'SQLite Database', extensions: ['db'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          canceled: true,
          message: 'تم إلغاء حفظ النسخة الاحتياطية'
        };
      }

      const db = getDb();

      await db.backup(result.filePath);

      return {
        success: true,
        path: result.filePath,
        message: 'تم حفظ النسخة الاحتياطية بنجاح'
      };
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('settings:restore-database', async (event) => {
    try {
      const parentWindow = BrowserWindow.fromWebContents(event.sender) || undefined;

      const result = await dialog.showOpenDialog(parentWindow, {
        title: 'اختيار نسخة احتياطية للاسترجاع',
        properties: ['openFile'],
        filters: [
          { name: 'SQLite Database', extensions: ['db'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePaths[0]) {
        return {
          success: false,
          canceled: true,
          message: 'تم إلغاء استرجاع النسخة الاحتياطية'
        };
      }

      const selectedFile = result.filePaths[0];
      const targetDbPath = getDbPath();
      const backupBeforeRestorePath = `${targetDbPath}.before-restore-${Date.now()}.bak`;

      closeDb();

      if (fs.existsSync(targetDbPath)) {
        fs.copyFileSync(targetDbPath, backupBeforeRestorePath);
      }

      fs.copyFileSync(selectedFile, targetDbPath);

      getDb();

      return {
        success: true,
        path: selectedFile,
        safetyBackupPath: backupBeforeRestorePath,
        message: 'تم استرجاع النسخة الاحتياطية بنجاح'
      };
    } catch (error) {
      try {
        getDb();
      } catch {
        // Ignore reopen errors here; the original error is more useful.
      }

      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });
}