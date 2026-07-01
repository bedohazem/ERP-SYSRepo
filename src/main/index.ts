import { app, BrowserWindow, nativeImage, Menu } from 'electron';
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
import { registerSyncIpc } from './ipc/sync.ipc';

let mainWindow: BrowserWindow | null = null;
let hourlyBackupTimer: NodeJS.Timeout | null = null;
let shutdownBackupDone = false;

function startAutoBackupScheduler() {
  setTimeout(() => {
    void createAutoBackup('startup');
  }, 10000);

  hourlyBackupTimer = setInterval(() => {
    void createAutoBackup('hourly');
  }, 60 * 60 * 1000);
}

const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
const appIconPath = path.join(appRoot, 'build', 'icon.ico');

if (process.platform === 'win32') {
  app.setAppUserModelId('ERP.SYS.Desktop');
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
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath
    }
  });

  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);

  if (!appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
  }

  mainWindow.maximize();

  const isDev = !app.isPackaged;

  if (isDev) {
    void mainWindow.loadURL('http://localhost:3000');
    
  } else {
    void mainWindow.loadFile(path.join(appRoot, 'dist', 'renderer', 'index.html'));
  }

    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow?.setTitle(appName);
    });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {

  getDb();

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
  registerSyncIpc();
  
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