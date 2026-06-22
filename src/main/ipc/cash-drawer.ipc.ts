import { BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '../database/db';
import { getActorId, logAction } from './activity-helper';
import { requireAdmin } from './permission-helper';

const execFileAsync = promisify(execFile);

type CashDrawerSettings = {
  printer_name: string;
  auto_open_cash_sale: boolean;
};

type SaveCashDrawerSettingsInput = {
  printer_name?: string | null;
  auto_open_cash_sale?: boolean;
  actor_id?: number;
};

type OpenCashDrawerInput = {
  actor_id?: number;
  reason?: 'manual' | 'sale' | 'test' | string;
  sale_id?: number | null;
};

const DEFAULT_SETTINGS: CashDrawerSettings = {
  printer_name: '',
  auto_open_cash_sale: true
};

function getSetting(key: string, fallback: string) {
  const db = getDb();

  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ? LIMIT 1`)
    .get(key) as { value: string } | undefined;

  return row?.value ?? fallback;
}

function saveSetting(key: string, value: string) {
  const db = getDb();

  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function getCashDrawerSettings(): CashDrawerSettings {
  return {
    printer_name: getSetting('cash_drawer_printer_name', DEFAULT_SETTINGS.printer_name),
    auto_open_cash_sale:
      getSetting('cash_drawer_auto_open_cash_sale', String(DEFAULT_SETTINGS.auto_open_cash_sale)) === 'true'
  };
}

function saveCashDrawerSettings(input: SaveCashDrawerSettingsInput): CashDrawerSettings {
  const printerName = String(input.printer_name || '').trim();
  const autoOpenCashSale = Boolean(input.auto_open_cash_sale);

  saveSetting('cash_drawer_printer_name', printerName);
  saveSetting('cash_drawer_auto_open_cash_sale', String(autoOpenCashSale));

  return getCashDrawerSettings();
}

function getCashDrawerPulseBytes() {
  // ESC/POS command:
  // ESC p m t1 t2
  // 27, 112, 0, 25, 250
  return [27, 112, 0, 25, 250];
}

function buildPowerShellScript(printerName: string) {
  const printerNameBase64 = Buffer.from(printerName, 'utf8').toString('base64');
  const pulseBytes = getCashDrawerPulseBytes().join(',');

  return `
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)]
        public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)]
        public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)]
        public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendBytesToPrinter(string printerName, byte[] bytes)
    {
        IntPtr printerHandle;
        DOCINFOA documentInfo = new DOCINFOA();
        documentInfo.pDocName = "ERP Cash Drawer";
        documentInfo.pDataType = "RAW";

        if (!OpenPrinter(printerName.Normalize(), out printerHandle, IntPtr.Zero))
        {
            return false;
        }

        try
        {
            if (!StartDocPrinter(printerHandle, 1, documentInfo))
            {
                return false;
            }

            try
            {
                if (!StartPagePrinter(printerHandle))
                {
                    return false;
                }

                IntPtr unmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);

                try
                {
                    Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);

                    int written;
                    return WritePrinter(printerHandle, unmanagedBytes, bytes.Length, out written) && written == bytes.Length;
                }
                finally
                {
                    Marshal.FreeCoTaskMem(unmanagedBytes);
                    EndPagePrinter(printerHandle);
                }
            }
            finally
            {
                EndDocPrinter(printerHandle);
            }
        }
        finally
        {
            ClosePrinter(printerHandle);
        }
    }
}
"@

$printerName = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${printerNameBase64}"))
[byte[]]$bytes = @(${pulseBytes})

$ok = [RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)

if (-not $ok) {
  $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  throw "Failed to open cash drawer. Win32Error=$err"
}
`;
}

async function sendCashDrawerPulse(printerName: string) {
  if (process.platform !== 'win32') {
    throw new Error('فتح درج الكاشير مدعوم على ويندوز فقط');
  }

  const cleanPrinterName = String(printerName || '').trim();

  if (!cleanPrinterName) {
    throw new Error('اختار طابعة درج الكاشير من الإعدادات أولًا');
  }

  const scriptPath = path.join(
    os.tmpdir(),
    `erp-cash-drawer-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`
  );

  await fs.writeFile(scriptPath, buildPowerShellScript(cleanPrinterName), 'utf8');

  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath
    ], {
      windowsHide: true,
      timeout: 8000
    });
  } finally {
    await fs.unlink(scriptPath).catch(() => {});
  }
}

export function registerCashDrawerIpc(): void {
  ipcMain.handle('cash-drawer:get-settings', () => {
    return getCashDrawerSettings();
  });

  ipcMain.handle('cash-drawer:save-settings', (_event, input: SaveCashDrawerSettingsInput) => {
    requireAdmin(getActorId(input));

    const settings = saveCashDrawerSettings(input);

    logAction({
      actor_id: getActorId(input),
      action: 'cash_drawer_settings_saved',
      entity: 'settings',
      entity_id: null,
      details: settings
    });

    return {
      success: true,
      settings,
      message: 'تم حفظ إعدادات درج الكاشير'
    };
  });

  ipcMain.handle('cash-drawer:list-printers', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);

    if (!parentWindow) {
      return [];
    }

    const printers = await parentWindow.webContents.getPrintersAsync();

    return printers.map((printer: any) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      description: printer.description || '',
      status: printer.status,
      isDefault: Boolean(printer.isDefault)
    }));
  });

  ipcMain.handle('cash-drawer:open', async (_event, input?: OpenCashDrawerInput) => {
    const settings = getCashDrawerSettings();

    try {
      await sendCashDrawerPulse(settings.printer_name);

      logAction({
        actor_id: getActorId(input),
        action: 'cash_drawer_opened',
        entity: input?.sale_id ? 'sale' : 'cash_drawer',
        entity_id: input?.sale_id ?? null,
        details: {
          reason: input?.reason || 'manual',
          printer_name: settings.printer_name
        }
      });

      return {
        success: true,
        message: 'تم إرسال أمر فتح درج الكاشير'
      };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'فشل فتح درج الكاشير';

      logAction({
        actor_id: getActorId(input),
        action: 'cash_drawer_open_failed',
        entity: input?.sale_id ? 'sale' : 'cash_drawer',
        entity_id: input?.sale_id ?? null,
        details: {
          reason: input?.reason || 'manual',
          printer_name: settings.printer_name,
          error: message
        }
      });

      return {
        success: false,
        message
      };
    }
  });
}