import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

type PreloadApi = Record<string, (...args: any[]) => Promise<any>>;

function loadPreload(invoke: Invoke): PreloadApi {
  let exposedApi!: PreloadApi;
  let apiExposed = false;

  const source = fs.readFileSync(
    path.join(process.cwd(), 'preload.cjs'),
    'utf8',
  );

  const context = vm.createContext({
    console: {
      error: vi.fn(),
      warn: vi.fn(),
      log: vi.fn(),
    },

    require: (moduleName: string) => {
      if (moduleName !== 'electron') {
        throw new Error(`Unexpected require: ${moduleName}`);
      }

      return {
        contextBridge: {
          exposeInMainWorld: (key: string, value: PreloadApi) => {
            if (key === 'api') {
              exposedApi = value;
              apiExposed = true;
            }
          },
        },

        ipcRenderer: {
          invoke,
        },
      };
    },
  });

  new vm.Script(source, {
    filename: 'preload.cjs',
  }).runInContext(context);

  if (!apiExposed) {
    throw new Error('Preload API was not exposed');
  }

  return exposedApi;
}

describe('preload IPC user errors', () => {
  it('removes Electron IPC prefixes from Arabic errors', async () => {
    const invoke = vi.fn(async () => {
      throw new Error(
        "Error invoking remote method 'cash-shifts:opening-preview': Error: تم اكتشاف تغيير في تاريخ أو وقت الجهاز أثناء تشغيل البرنامج. اضبط التاريخ والوقت الصحيحين ثم أعد تشغيل البرنامج.",
      );
    });

    const api = loadPreload(invoke);

    await expect(api.getCashShiftOpeningPreview()).rejects.toThrow(
      'تم اكتشاف تغيير في تاريخ أو وقت الجهاز أثناء تشغيل البرنامج. اضبط التاريخ والوقت الصحيحين ثم أعد تشغيل البرنامج.',
    );

    expect(invoke).toHaveBeenCalledWith('cash-shifts:opening-preview');
  });

  it('hides technical English-only IPC errors from users', async () => {
    const invoke = vi.fn(async () => {
      throw new Error(
        "Error invoking remote method 'cash-shifts:opening-preview': Error: SQLITE_BUSY: database is locked",
      );
    });

    const api = loadPreload(invoke);

    await expect(api.getCashShiftOpeningPreview()).rejects.toThrow(
      'حدث خطأ غير متوقع أثناء تنفيذ العملية. حاول مرة أخرى.',
    );
  });

  it('sanitizes failed result messages too', async () => {
    const invoke = vi.fn(async () => ({
      success: false,

      message: 'SQLITE_BUSY: database is locked',
    }));

    const api = loadPreload(invoke);

    const result = await api.runAutoBackupNow();

    expect(result.success).toBe(false);

    expect(result.message).toBe(
      'حدث خطأ غير متوقع أثناء تنفيذ العملية. حاول مرة أخرى.',
    );
  });
});
