import { app, BrowserWindow, nativeImage } from 'electron';
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

let mainWindow: BrowserWindow | null = null;

if (process.platform === 'win32') {
  app.setAppUserModelId('ERP.SYS.Desktop.DynamicLogo');
}

function getSavedAppIcon() {
  try {
    const status = getAppLicenseStatus();
    const logoUrl = status.app_logo_url || '';

    if (!logoUrl.startsWith('data:image')) {
      return nativeImage.createEmpty();
    }

    const image = nativeImage.createFromDataURL(logoUrl);

    if (image.isEmpty()) {
      return nativeImage.createEmpty();
    }

    return image.resize({
      width: 256,
      height: 256,
      quality: 'best'
    });
  } catch (error) {
    console.error('Failed to load saved app icon:', error);
    return nativeImage.createEmpty();
  }
}

const appIconPath = path.join(process.cwd(), 'build', 'icon.ico');

if (process.platform === 'win32') {
  app.setAppUserModelId('ERP.SYS.Desktop');
}

function createWindow(): void {
  const preloadPath = path.join(process.cwd(), 'preload.cjs');
  const appIcon = getSavedAppIcon();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 390,
    minHeight: 650,
    backgroundColor: '#0f172a',
    title: 'ERP SYS',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath
    }
  });

  if (!appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
  }

  mainWindow.maximize();

  const isDev = !app.isPackaged;

  if (isDev) {
    void mainWindow.loadURL('http://localhost:3000');
    
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {


  getDb();
  registerAuthIpc();
  createWindow();
  registerProductsIpc();
  registerSettingsIpc();
  registerSalesIpc();
  registerCustomersIpc();
  registerReportsIpc();
  registerInventoryIpc();
  registerSuppliersIpc();
  registerPurchasesIpc();
  registerCashIpc();
  registerExpenseIpc();
  registerActivityIpc();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});