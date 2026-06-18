import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type SavePdfInput = {
  html: string;
  defaultFileName?: string;
  landscape?: boolean;
};

function cleanFileName(value: string) {
  const safeName = String(value || 'report.pdf')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
}

export function registerPrintIpc(): void {
  ipcMain.handle('print:save-pdf', async (_event, input: SavePdfInput) => {
    const html = String(input?.html || '').trim();

    if (!html) {
      throw new Error('لا يوجد محتوى لإنشاء PDF');
    }

    const defaultFileName = cleanFileName(
      input.defaultFileName || `inventory-employees-${new Date().toISOString().slice(0, 10)}.pdf`
    );

    const saveResult = await dialog.showSaveDialog({
      title: 'حفظ ملف PDF',
      defaultPath: path.join(app.getPath('documents'), defaultFileName),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, canceled: true };
    }

    const filePath = saveResult.filePath.toLowerCase().endsWith('.pdf')
      ? saveResult.filePath
      : `${saveResult.filePath}.pdf`;

    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    let tempHtmlPath = '';

    try {
      tempHtmlPath = path.join(os.tmpdir(), `erp-inventory-pdf-${Date.now()}.html`);

      await fs.writeFile(tempHtmlPath, html, 'utf8');
      await pdfWindow.loadFile(tempHtmlPath);

      const pdfBuffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        landscape: input.landscape !== false,
        pageSize: 'A4'
      });

      await fs.writeFile(filePath, pdfBuffer);

      return {
        ok: true,
        filePath
      };
    } finally {
      pdfWindow.destroy();

      if (tempHtmlPath) {
        await fs.unlink(tempHtmlPath).catch(() => {});
      }
    }
  });
}