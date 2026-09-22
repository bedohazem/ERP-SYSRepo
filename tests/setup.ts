import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'

const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-'))

vi.mock('electron', () => {
  const BrowserWindow = vi.fn()

  Object.assign(BrowserWindow, {
    fromWebContents: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  })

  return {
    app: {
      getPath: (_name: string) => {
        return testUserDataDir
      },
    },

    ipcMain: {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    },

    BrowserWindow,

    dialog: {
      showSaveDialog: vi.fn(async () => ({
        canceled: true,
        filePath: undefined,
      })),

      showOpenDialog: vi.fn(async () => ({
        canceled: true,
        filePaths: [],
      })),

      showMessageBox: vi.fn(async () => ({
        response: 0,
      })),
    },

    nativeImage: {
      createFromDataURL: vi.fn(() => ({
        isEmpty: () => true,
        resize: vi.fn(),
      })),

      createFromPath: vi.fn(() => ({
        isEmpty: () => true,
        resize: vi.fn(),
      })),
    },

    Menu: {
      setApplicationMenu: vi.fn(),
    },
  }
})
