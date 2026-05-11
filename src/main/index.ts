import { app, BrowserWindow } from 'electron';
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

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const preloadPath = path.join(process.cwd(), 'preload.cjs');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath
    }
  });

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