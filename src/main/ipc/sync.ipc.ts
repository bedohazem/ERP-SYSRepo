import { ipcMain } from 'electron';
import { getLocalSyncStatus, listPendingSyncOperations } from '../database/repositories/sync.repo';

export function registerSyncIpc(): void {
  ipcMain.handle('sync:get-status', () => {
    const status = getLocalSyncStatus();

    return {
      success: true,
      online: true,
      ...status
    };
  });

  ipcMain.handle('sync:list-pending', (_, limit?: number) => {
    return {
      success: true,
      operations: listPendingSyncOperations(limit || 100)
    };
  });
}