import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('daily products preload bridge', () => {
  it('forwards the exact date filter to the protected IPC channel', async () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'preload.cjs'),
      'utf8',
    );
    const invoke = vi.fn(async () => []);
    let api: Record<string, (...args: any[]) => Promise<unknown>> | undefined;

    const context = vm.createContext({
      console,
      require: (name: string) => {
        if (name !== 'electron') throw new Error(`Unexpected module: ${name}`);
        return {
          contextBridge: {
            exposeInMainWorld: (key: string, exposed: typeof api) => {
              if (key === 'api') api = exposed;
            },
          },
          ipcRenderer: { invoke },
        };
      },
    });
    new vm.Script(source, { filename: 'preload.cjs' }).runInContext(context);
    expect(api).toBeDefined();
    const result = await api!.getDailyProductSummary({
      business_date: '2026-11-22',
    });
    expect(result).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('reports:daily-products', {
      business_date: '2026-11-22',
    });
  });
});
