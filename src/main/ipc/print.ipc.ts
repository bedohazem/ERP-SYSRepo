import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  clampWindowDimension,
  getSecureWebPreferences,
  hardenAuxiliaryWindow,
} from '../electron-security';
import {
  requireAuthenticatedAdmin,
  requireAuthenticatedUser,
  requirePermission,
} from '../auth-session';

import {
  optionalBooleanValue,
  optionalNonNegativeNumber,
  optionalStringValue,
  optionalTrimmedString,
  requireObjectInput,
} from './input-validation';

let dialogPrintInProgress = false;

const PRINT_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob: file: https:",
  "font-src 'self' data: file:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ');

function hardenPrintHtml(html: string) {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">`;

  const headPattern = /<head(\s[^>]*)?>/i;

  if (headPattern.test(html)) {
    return html.replace(headPattern, (headTag) => `${headTag}\n${cspMeta}`);
  }

  return `<head>${cspMeta}</head>${html}`;
}

function cleanFileName(value: string) {
  const safeName = String(value || 'report.pdf')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
}

function cleanCsvFileName(value: string) {
  const safeName = String(value || 'report.csv')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return safeName.toLowerCase().endsWith('.csv') ? safeName : `${safeName}.csv`;
}

function normalizePrintHtmlInput(input: unknown, label: string) {
  const payload = requireObjectInput(input, label);

  const html = (
    optionalStringValue(payload.html, 'محتوى الطباعة', 5_000_000) ?? ''
  ).trim();

  return {
    payload,
    html,
  };
}

export function registerPrintIpc(): void {
  ipcMain.handle('print:save-pdf', async (event, input: unknown) => {
    /*
     * Export PDF مستخدم حاليًا في
     * المخزون وكشف الموردين فقط.
     */
    requireAuthenticatedAdmin(event);

    const { payload, html } = normalizePrintHtmlInput(input, 'بيانات PDF');

    const landscape =
      optionalBooleanValue(payload.landscape, 'اتجاه صفحة PDF') ?? true;

    const requestedFileName =
      optionalTrimmedString(payload.defaultFileName, 'اسم ملف PDF', 500) ?? '';

    if (!html) {
      throw new Error('لا يوجد محتوى لإنشاء PDF');
    }

    const defaultFileName = cleanFileName(
      requestedFileName ||
        `inventory-employees-${new Date().toISOString().slice(0, 10)}.pdf`,
    );

    const saveResult = await dialog.showSaveDialog({
      title: 'حفظ ملف PDF',
      defaultPath: path.join(app.getPath('documents'), defaultFileName),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, canceled: true };
    }

    const filePath = saveResult.filePath.toLowerCase().endsWith('.pdf')
      ? saveResult.filePath
      : `${saveResult.filePath}.pdf`;

    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: getSecureWebPreferences(app.isPackaged),
    });

    hardenAuxiliaryWindow(pdfWindow);

    let tempHtmlPath = '';

    try {
      tempHtmlPath = path.join(
        os.tmpdir(),
        `erp-inventory-pdf-${Date.now()}.html`,
      );

      await fs.writeFile(tempHtmlPath, hardenPrintHtml(html), 'utf8');
      await pdfWindow.loadFile(tempHtmlPath);

      const pdfBuffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        landscape,
        pageSize: 'A4',
      });

      await fs.writeFile(filePath, pdfBuffer);

      return {
        ok: true,
        filePath,
      };
    } finally {
      pdfWindow.destroy();

      if (tempHtmlPath) {
        await fs.unlink(tempHtmlPath).catch(() => {});
      }
    }
  });

  ipcMain.handle('print:save-report-pdf', async (event, input: unknown) => {
    requirePermission(event, 'reports.view');

    const { payload, html } = normalizePrintHtmlInput(
      input,
      'بيانات تقرير PDF',
    );

    const landscape =
      optionalBooleanValue(payload.landscape, 'اتجاه صفحة PDF') ?? true;

    const requestedFileName =
      optionalTrimmedString(payload.defaultFileName, 'اسم ملف PDF', 500) ?? '';

    if (!html) {
      throw new Error('لا يوجد محتوى لإنشاء PDF');
    }

    const defaultFileName = cleanFileName(
      requestedFileName ||
        `report-${new Date().toISOString().slice(0, 10)}.pdf`,
    );

    const saveResult = await dialog.showSaveDialog({
      title: 'حفظ تقرير PDF',

      defaultPath: path.join(
        app.getPath('documents'),

        defaultFileName,
      ),

      filters: [
        {
          name: 'PDF Files',

          extensions: ['pdf'],
        },
      ],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return {
        ok: false,
        canceled: true,
      };
    }

    const filePath = saveResult.filePath.toLowerCase().endsWith('.pdf')
      ? saveResult.filePath
      : `${saveResult.filePath}.pdf`;

    const pdfWindow = new BrowserWindow({
      show: false,

      webPreferences: getSecureWebPreferences(app.isPackaged),
    });

    hardenAuxiliaryWindow(pdfWindow);

    let tempHtmlPath = '';

    try {
      tempHtmlPath = path.join(
        os.tmpdir(),

        `erp-report-pdf-${Date.now()}.html`,
      );

      await fs.writeFile(
        tempHtmlPath,

        hardenPrintHtml(html),

        'utf8',
      );

      await pdfWindow.loadFile(tempHtmlPath);

      const pdfBuffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,

        landscape,

        pageSize: 'A4',
      });

      await fs.writeFile(filePath, pdfBuffer);

      return {
        ok: true,
        filePath,
      };
    } finally {
      pdfWindow.destroy();

      if (tempHtmlPath) {
        await fs.unlink(tempHtmlPath).catch(() => {});
      }
    }
  });

  ipcMain.handle('print:save-report-csv', async (event, input: unknown) => {
    requirePermission(event, 'reports.view');

    const payload = requireObjectInput(input, 'بيانات CSV');

    const text = (
      optionalStringValue(payload.text, 'محتوى CSV', 5_000_000) ?? ''
    ).trim();

    const requestedFileName =
      optionalTrimmedString(payload.defaultFileName, 'اسم ملف CSV', 500) ?? '';

    if (!text) {
      throw new Error('لا توجد بيانات لتصدير CSV');
    }

    const defaultFileName = cleanCsvFileName(
      requestedFileName ||
        `report-${new Date().toISOString().slice(0, 10)}.csv`,
    );

    const saveResult = await dialog.showSaveDialog({
      title: 'حفظ تقرير CSV',

      defaultPath: path.join(
        app.getPath('documents'),

        defaultFileName,
      ),

      filters: [
        {
          name: 'CSV Files',

          extensions: ['csv'],
        },
      ],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return {
        ok: false,
        canceled: true,
      };
    }

    const filePath = saveResult.filePath.toLowerCase().endsWith('.csv')
      ? saveResult.filePath
      : `${saveResult.filePath}.csv`;

    /*
     * BOM مهم علشان Excel
     * يقرأ العربي UTF-8 صح.
     */
    await fs.writeFile(
      filePath,

      `\uFEFF${text}`,

      'utf8',
    );

    return {
      ok: true,
      filePath,
    };
  });

  ipcMain.handle('print:silent-html', async (event, input: unknown) => {
    requireAuthenticatedUser(event);

    const { html } = normalizePrintHtmlInput(input, 'بيانات الطباعة الصامتة');

    if (!html) {
      throw new Error('لا يوجد محتوى للطباعة');
    }

    const printWindow = new BrowserWindow({
      show: false,
      opacity: 0,
      skipTaskbar: true,
      focusable: false,
      backgroundColor: '#ffffff',

      webPreferences: {
        ...getSecureWebPreferences(app.isPackaged),
        backgroundThrottling: false,
      },
    });

    hardenAuxiliaryWindow(printWindow);
    let tempHtmlPath = '';

    try {
      tempHtmlPath = path.join(
        os.tmpdir(),
        `erp-silent-print-${Date.now()}.html`,
      );

      await fs.writeFile(tempHtmlPath, hardenPrintHtml(html), 'utf8');

      await printWindow.loadFile(tempHtmlPath);

      /*
       * الطباعة الصامتة تحتاج أن تتعمل للصفحة
       * Render فعلي قبل إرسالها للطابعة.
       * النافذة شفافة ولا تظهر للمستخدم.
       */
      printWindow.showInactive();

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250);
      });

      await new Promise<void>((resolve, reject) => {
        printWindow.webContents.print(
          {
            silent: true,
            printBackground: true,
          },
          (success, failureReason) => {
            if (success) {
              resolve();
              return;
            }

            reject(
              new Error(
                failureReason || 'فشل إرسال الفاتورة للطابعة الافتراضية',
              ),
            );
          },
        );
      });

      return {
        ok: true,
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : 'فشل تنفيذ الطباعة الصامتة',
      };
    } finally {
      printWindow.destroy();

      if (tempHtmlPath) {
        await fs.unlink(tempHtmlPath).catch(() => {});
      }
    }
  });

  ipcMain.handle('print:dialog-html', async (event, input: unknown) => {
    requireAuthenticatedUser(event);

    const { payload, html } = normalizePrintHtmlInput(
      input,
      'بيانات معاينة الطباعة',
    );

    const previewWidth = clampWindowDimension(
      optionalNonNegativeNumber(payload.previewWidth, 'عرض معاينة الطباعة'),
      1000,
      420,
      1400,
    );

    const previewHeight = clampWindowDimension(
      optionalNonNegativeNumber(payload.previewHeight, 'ارتفاع معاينة الطباعة'),
      800,
      600,
      1000,
    );

    if (!html) {
      return {
        ok: false,
        message: 'لا يوجد محتوى للطباعة',
      };
    }

    if (dialogPrintInProgress) {
      return {
        ok: false,
        busy: true,
        message: 'نافذة الطباعة مفتوحة بالفعل',
      };
    }

    dialogPrintInProgress = true;

    const parentWindow = BrowserWindow.fromWebContents(event.sender);

    let printWindow: BrowserWindow | null = null;
    let tempHtmlPath = '';

    try {
      const activePrintWindow = new BrowserWindow({
        show: false,

        parent: parentWindow ?? undefined,

        modal: Boolean(parentWindow),

        skipTaskbar: true,

        width: previewWidth,
        height: previewHeight,

        backgroundColor: '#ffffff',

        title: 'معاينة الطباعة',

        webPreferences: getSecureWebPreferences(app.isPackaged),
      });

      printWindow = activePrintWindow;

      hardenAuxiliaryWindow(activePrintWindow);

      tempHtmlPath = path.join(
        os.tmpdir(),
        `erp-dialog-print-${Date.now()}.html`,
      );

      await fs.writeFile(tempHtmlPath, hardenPrintHtml(html), 'utf8');

      await activePrintWindow.loadFile(tempHtmlPath);

      /*
       * نعرض معاينة آمنة أنشأها الـMain Process
       * قبل فتح Print Dialog.
       */
      activePrintWindow.show();
      activePrintWindow.focus();

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 200);
      });

      const result = await new Promise<{
        ok: boolean;
        canceled?: boolean;
        message?: string;
      }>((resolve) => {
        activePrintWindow.webContents.print(
          {
            silent: false,
            printBackground: true,
          },
          (success, failureReason) => {
            if (success) {
              resolve({
                ok: true,
              });

              return;
            }

            const reason = String(failureReason || '').trim();

            if (reason.toLowerCase().includes('cancel')) {
              resolve({
                ok: false,
                canceled: true,
              });

              return;
            }

            resolve({
              ok: false,

              message: reason || 'تعذر فتح نافذة الطباعة',
            });
          },
        );
      });

      return result;
    } catch (error) {
      return {
        ok: false,

        message:
          error instanceof Error ? error.message : 'تعذر فتح نافذة الطباعة',
      };
    } finally {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.destroy();
      }

      if (tempHtmlPath) {
        await fs.unlink(tempHtmlPath).catch(() => {});
      }

      dialogPrintInProgress = false;

      if (parentWindow && !parentWindow.isDestroyed()) {
        parentWindow.focus();
      }
    }
  });
}
