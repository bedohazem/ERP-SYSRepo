import { BrowserWindow, app, dialog, ipcMain, nativeImage } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import { getActorId, logAction } from './activity-helper';
import fs from 'node:fs';
import path from 'node:path';
import {
  getBarcodePrintSettings,
  getLoyaltySettings,
  saveBarcodePrintSettings,
  saveLoyaltySettings,
  getAppLicenseStatus,
  activateApp,
  saveAppLogoUrl,
  deactivateApp,
  saveAppName,
  saveAppTheme
} from '../database/repositories/settings.repo';
import { closeDb, getDb, getDbPath, resetDatabaseData } from '../database/db';
import { requireAdmin } from './permission-helper';


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

function getImageMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';

  return 'image/png';
}

function updateOpenWindowsIcon(logoUrl: string) {
  if (!logoUrl.startsWith('data:image')) return;

  const image = nativeImage.createFromDataURL(logoUrl);

  if (image.isEmpty()) return;

  const appIcon = image.resize({
    width: 256,
    height: 256,
    quality: 'best'
  });

  BrowserWindow.getAllWindows().forEach((window) => {
    window.setIcon(appIcon);
  });
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

  ipcMain.handle('settings:backup-database', async (event,input?: { actor_id?: number }) => {
    try {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);

      const options: SaveDialogOptions = {
        title: 'حفظ نسخة احتياطية',
        defaultPath: path.join(app.getPath('documents'), getDefaultBackupName()),
        filters: [
          { name: 'SQLite Database', extensions: ['db'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      };

      const result = parentWindow
        ? await dialog.showSaveDialog(parentWindow, options)
        : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          canceled: true,
          message: 'تم إلغاء حفظ النسخة الاحتياطية'
        };
      }

      const db = getDb();

      await db.backup(result.filePath);


      logAction({
        actor_id: getActorId(input),
        action: 'database_backup_created',
        entity: 'settings',
        entity_id: null,
        details: {
          path: result.filePath
        }
      });

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

  ipcMain.handle('settings:restore-database', async (event,input?: { actor_id?: number }) => {
    try {
      requireAdmin(getActorId(input));
      const parentWindow = BrowserWindow.fromWebContents(event.sender);

      const options: OpenDialogOptions = {
        title: 'اختيار نسخة احتياطية للاسترجاع',
        properties: ['openFile'],
        filters: [
          { name: 'SQLite Database', extensions: ['db'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      };

      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);

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

      logAction({
        actor_id: getActorId(input),
        action: 'database_restored',
        entity: 'settings',
        entity_id: null,
        details: {
          restored_from: selectedFile,
          safety_backup: backupBeforeRestorePath
        }
      });

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

  ipcMain.handle('settings:reset-database', async (event, input?: { actor_id?: number }) => {
    try {
      requireAdmin(getActorId(input));
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const saveResult = parentWindow
        ? await dialog.showSaveDialog(parentWindow, {
            title: 'اختيار مكان حفظ نسخة الأمان قبل التصفير',
            defaultPath: path.join(app.getPath('documents'), getDefaultBackupName()),
            filters: [
              { name: 'SQLite Database', extensions: ['db'] },
              { name: 'Backup Files', extensions: ['bak'] },
              { name: 'All Files', extensions: ['*'] }
            ]
          })
        : await dialog.showSaveDialog({
            title: 'اختيار مكان حفظ نسخة الأمان قبل التصفير',
            defaultPath: path.join(app.getPath('documents'), getDefaultBackupName()),
            filters: [
              { name: 'SQLite Database', extensions: ['db'] },
              { name: 'Backup Files', extensions: ['bak'] },
              { name: 'All Files', extensions: ['*'] }
            ]
          });

      if (saveResult.canceled || !saveResult.filePath) {
        return {
          success: false,
          canceled: true,
          message: 'تم إلغاء التصفير لأنك لم تختر مكان حفظ نسخة الأمان'
        };
      }

      const safetyBackupPath = saveResult.filePath;
      const confirmResult = parentWindow
        ? await dialog.showMessageBox(parentWindow, {
            type: 'warning',
            buttons: ['إلغاء', 'تصفير البرنامج'],
            defaultId: 0,
            cancelId: 0,
            title: 'تصفير البرنامج',
            message: 'هل أنت متأكد من تصفير البرنامج؟',
            detail:
              'سيتم مسح كل المنتجات والمبيعات والفواتير والعملاء والموردين وحركات المخزون. سيتم إنشاء نسخة أمان قبل المسح.'
          })
        : await dialog.showMessageBox({
            type: 'warning',
            buttons: ['إلغاء', 'تصفير البرنامج'],
            defaultId: 0,
            cancelId: 0,
            title: 'تصفير البرنامج',
            message: 'هل أنت متأكد من تصفير البرنامج؟',
            detail:
              'سيتم مسح كل المنتجات والمبيعات والفواتير والعملاء والموردين وحركات المخزون. سيتم إنشاء نسخة أمان قبل المسح.'
          });

      if (confirmResult.response !== 1) {
        return {
          success: false,
          canceled: true,
          message: 'تم إلغاء تصفير البرنامج'
        };
      }

      const db = getDb();

      await db.backup(safetyBackupPath);

      resetDatabaseData();

      logAction({
        actor_id: getActorId(input),
        action: 'database_reset',
        entity: 'settings',
        entity_id: null,
        details: {
          safety_backup: safetyBackupPath
        }
      });

      return {
        success: true,
        safetyBackupPath,
        message: 'تم تصفير البرنامج بنجاح'
      };
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('settings:get-license-status', () => {
    return getAppLicenseStatus();
  });

  ipcMain.handle('settings:activate-app', (_, code: string) => {
    return activateApp(code);
  });

  ipcMain.handle('settings:deactivate-app', () => {
    return deactivateApp();
  });

  ipcMain.handle('settings:save-app-logo-url', (_, url: string, input?: { actor_id?: number }) => {
      try {
        requireAdmin(getActorId(input));

        const saved = saveAppLogoUrl(url);

        if (String(url || '').startsWith('data:image')) {
          updateOpenWindowsIcon(url);
        }

        return saved;
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error)
        };
      }
    }
  );

  ipcMain.handle('settings:choose-app-logo', async (event) => {
    try {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);

      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, {
            title: 'اختيار صورة التطبيق',
            properties: ['openFile'],
            filters: [
              { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
            ]
          })
        : await dialog.showOpenDialog({
            title: 'اختيار صورة التطبيق',
            properties: ['openFile'],
            filters: [
              { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
            ]
          });

      if (result.canceled || !result.filePaths[0]) {
        return {
          success: false,
          canceled: true
        };
      }

      const selectedPath = result.filePaths[0];
      const mimeType = getImageMimeType(selectedPath);
      const buffer = fs.readFileSync(selectedPath);

      const logoUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

      const saved = saveAppLogoUrl(logoUrl);
      updateOpenWindowsIcon(logoUrl);

      return {
        success: true,
        logoUrl,
        status: saved.status
      };
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('settings:save-app-name', (_, name: string, input?: { actor_id?: number }) => {
    try {
      requireAdmin(getActorId(input));

      const saved = saveAppName(name);

      BrowserWindow.getAllWindows().forEach((window) => {
        window.setTitle(saved.status.app_name || 'ERP Store');
      });

      return saved;
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('settings:save-app-theme',(_, theme: 'dark' | 'light', input?: { actor_id?: number }) => {
    try {
      requireAdmin(getActorId(input));

      return saveAppTheme(theme);
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });
  
}