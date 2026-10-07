import {
  app,
  BrowserWindow,
  nativeImage,
  Menu,
  session,
  shell,
  powerMonitor,
} from 'electron';
import path from 'node:path';
import { getDb } from './database/db';
import { registerAuthIpc } from './ipc/auth.ipc';
import { registerProductsIpc } from './ipc/products.ipc';
import { registerSettingsIpc } from './ipc/settings.ipc';
import { registerSalesIpc } from './ipc/sales.ipc';
import { registerCustomersIpc } from './ipc/customers.ipc';
import { registerReportsIpc } from './ipc/reports.ipc';
import { registerInventoryIpc } from './ipc/inventory.ipc';
import { registerSuppliersIpc } from './ipc/suppliers.ipc';
import { registerPurchasesIpc } from './ipc/purchases.ipc';
import { registerCashIpc } from './ipc/cash.ipc';
import { registerExpenseIpc } from './ipc/expense.ipc';
import { registerActivityIpc } from './ipc/activity.ipc';
import { getAppLicenseStatus } from './database/repositories/settings.repo';
import { createAutoBackup } from './database/auto-backup';
import { registerStockCountIpc } from './ipc/stock-count.ipc';
import { registerLiabilitiesIpc } from './ipc/liabilities.ipc';
import { registerPrintIpc } from './ipc/print.ipc';
import { registerCashDrawerIpc } from './ipc/cash-drawer.ipc';
import { registerPromotionsIpc } from './ipc/promotions.ipc';
import {
  configureMainWindowSecurity,
  configureSessionPermissions,
  getSecureWebPreferences,
} from './electron-security';

import {
  handleSystemResume,
  markSystemSuspended,
} from './database/system-clock-guard';

let mainWindow: BrowserWindow | null = null;
let hourlyBackupTimer: NodeJS.Timeout | null = null;
let shutdownBackupDone = false;

const e2eSmokeEnabled = process.env.ERP_E2E_SMOKE === '1';

const e2eUserDataDir = String(process.env.ERP_E2E_USER_DATA_DIR || '').trim();

if (e2eSmokeEnabled && e2eUserDataDir) {
  /*
   * الـE2E ممنوع يلمس
   * قاعدة بيانات المستخدم الحقيقية.
   */
  app.setPath('userData', e2eUserDataDir);
}

function startAutoBackupScheduler() {
  setTimeout(() => {
    void createAutoBackup('startup');
  }, 10000);

  hourlyBackupTimer = setInterval(
    () => {
      void createAutoBackup('hourly');
    },
    60 * 60 * 1000,
  );
}

const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
const appIconPath = path.join(appRoot, 'build', 'icon.ico');
const runtimeSecurityOptions = {
  appRoot,
  isPackaged: app.isPackaged,
  openExternal: (url: string) => shell.openExternal(url),
};

if (process.platform === 'win32') {
  app.setAppUserModelId('com.abdelrahmanhazem.erpstore');
}

Menu.setApplicationMenu(null);

function createWindow(): void {
  const preloadPath = path.join(appRoot, 'preload.cjs');
  const appStatus = getAppLicenseStatus();
  const appName = appStatus.app_name || 'ERP Store';
  const appIcon = nativeImage.createFromPath(appIconPath);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 390,
    minHeight: 650,
    backgroundColor: '#0f172a',
    title: appName,
    autoHideMenuBar: true,
    icon: appIcon.isEmpty() ? undefined : appIcon,
    webPreferences: {
      ...getSecureWebPreferences(app.isPackaged),
      preload: preloadPath,
    },
  });

  configureMainWindowSecurity(mainWindow, runtimeSecurityOptions);

  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);

  if (!appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
  }

  mainWindow.maximize();

  const isDev = !app.isPackaged && !e2eSmokeEnabled;

  if (isDev) {
    void mainWindow.loadURL('http://localhost:3000');
  } else {
    void mainWindow.loadFile(
      path.join(appRoot, 'dist', 'renderer', 'index.html'),
    );
  }

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.setTitle(appName);

    if (!e2eSmokeEnabled || !mainWindow) {
      return;
    }

    /*
     * Smoke حقيقي:
     *
     * Renderer اتحمل
     * Preload اتحمل
     * window.api موجود
     * IPC شغال
     * DB اشتغلت
     */
    void mainWindow.webContents
      .executeJavaScript(
        `
        (async () => {
          await new Promise(
            (resolve) =>
              setTimeout(resolve, 300)
          )

          const rootExists =
            Boolean(
              document.getElementById(
                'root'
              )
            )

          const apiExists =
            typeof window.api
              ?.getLicenseStatus ===
            'function'

          let ipcReady = false

          if (apiExists) {
            const status =
              await window.api
                .getLicenseStatus()

            ipcReady =
              Boolean(
                status &&
                typeof status ===
                  'object'
              )
          }

          const bodyHasText =
            document.body
              .innerText
              .trim()
              .length > 0

          return {
            rootExists,
            apiExists,
            ipcReady,
            bodyHasText,
          }
        })()
      `,
      )
      .then((result) => {
        const ok =
          Boolean(result?.rootExists) &&
          Boolean(result?.apiExists) &&
          Boolean(result?.ipcReady) &&
          Boolean(result?.bodyHasText);

        if (!ok) {
          console.error('ERP_E2E_SMOKE_FAILED', JSON.stringify(result));

          setTimeout(() => app.exit(1), 100);

          return;
        }

        console.log('ERP_E2E_SMOKE_READY', JSON.stringify(result));

        setTimeout(() => app.exit(0), 100);
      })
      .catch((error) => {
        console.error('ERP_E2E_SMOKE_FAILED', error);

        setTimeout(() => app.exit(1), 100);
      });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });

  app.whenReady().then(() => {
    configureSessionPermissions(session.defaultSession, runtimeSecurityOptions);

    getDb();

    powerMonitor.on('suspend', () => {
      markSystemSuspended();
    });

    powerMonitor.on('resume', () => {
      handleSystemResume();
    });

    registerAuthIpc();
    registerProductsIpc();
    registerSettingsIpc();
    registerSalesIpc();
    registerCustomersIpc();
    registerReportsIpc();
    registerInventoryIpc();
    registerStockCountIpc();
    registerSuppliersIpc();
    registerPurchasesIpc();
    registerCashIpc();
    registerExpenseIpc();
    registerActivityIpc();
    registerLiabilitiesIpc();
    registerPrintIpc();
    registerCashDrawerIpc();
    registerPromotionsIpc();

    createWindow();
    startAutoBackupScheduler();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('before-quit', async (event) => {
    if (shutdownBackupDone) {
      return;
    }

    event.preventDefault();
    shutdownBackupDone = true;

    if (hourlyBackupTimer) {
      clearInterval(hourlyBackupTimer);
      hourlyBackupTimer = null;
    }

    try {
      await createAutoBackup('shutdown');
    } catch (error) {
      console.error('Shutdown backup failed:', error);
    }

    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
