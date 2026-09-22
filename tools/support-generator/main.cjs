const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');

const LICENSE_SECRET = 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_ERP_STORE_2026';

function normalizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function formatCode(value) {
  return value.match(/.{1,4}/g)?.join('-') || value;
}

function generateActivationCode(deviceCode) {
  const cleanDeviceCode = normalizeCode(deviceCode);

  if (!cleanDeviceCode) {
    throw new Error('اكتب كود الجهاز');
  }

  const hash = crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(cleanDeviceCode)
    .digest('hex')
    .toUpperCase();

  const codeBody = hash.slice(0, 16);

  return `ERPS-${formatCode(codeBody)}`;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 620,
    height: 520,
    resizable: false,
    title: 'ERP License Generator',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('license:generate', (_, deviceCode) => {
  try {
    const activationCode = generateActivationCode(deviceCode);

    return {
      success: true,
      activationCode
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'حدث خطأ'
    };
  }
});

ipcMain.handle('clipboard:copy', (_, text) => {
  clipboard.writeText(String(text || ''));

  return { success: true };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});