import { EventEmitter } from 'node:events';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createUser,
  findUserByUsername,
} from '../../src/main/database/repositories/user.repo';
import { registerReportsIpc } from '../../src/main/ipc/reports.ipc';
import { startAuthSession } from '../../src/main/auth-session';

type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;
const handlers = new Map<string, Handler>();

function makeClient() {
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: {},
    isDestroyed: () => false,
  });
  const event = {
    sender,
    senderFrame: sender.mainFrame,
  } as unknown as IpcMainInvokeEvent;
  return event;
}

async function invoke(event: IpcMainInvokeEvent, input: unknown) {
  const handler = handlers.get('reports:daily-products');
  if (!handler)
    throw new Error('Daily products IPC handler was not registered');
  return handler(event, input);
}

describe('daily products IPC authentication and input security', () => {
  beforeAll(() => {
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    registerReportsIpc();
  });

  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  }, 30_000);

  afterAll(() => {
    vi.mocked(ipcMain.handle).mockReset();
    closeDb();
  });

  it('rejects unauthenticated users', async () => {
    await expect(
      invoke(makeClient(), { business_date: '2026-11-22' }),
    ).rejects.toThrow('سجل الدخول أولًا');
  });

  it('rejects cashiers even when they have dashboard permission', async () => {
    const cashier = createUser(
      'Daily Summary Cashier',
      'daily_summary_cashier',
      'Cashier5678',
      'cashier',
    );
    const client = makeClient();
    startAuthSession(client, cashier.id);
    await expect(
      invoke(client, { business_date: '2026-11-22' }),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط');
  });

  it('requires a valid business date for admin', async () => {
    const admin = findUserByUsername('admin');
    expect(admin).toBeDefined();
    const client = makeClient();
    startAuthSession(client, admin!.id);

    for (const input of [
      null,
      {},
      { business_date: true },
      { business_date: '2026-02-30' },
      { business_date: 'tomorrow' },
    ]) {
      await expect(invoke(client, input)).rejects.toThrow();
    }
  });

  it('allows admin to read an empty day without modifying the database', async () => {
    const admin = findUserByUsername('admin');
    expect(admin).toBeDefined();
    const client = makeClient();
    startAuthSession(client, admin!.id);
    await expect(
      invoke(client, { business_date: '2099-01-01' }),
    ).resolves.toEqual([]);
  });
});
