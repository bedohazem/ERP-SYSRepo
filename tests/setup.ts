import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-'));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') {
        return testUserDataDir;
      }

      return testUserDataDir;
    }
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  },
  BrowserWindow: vi.fn()
}));