import { ipcMain } from 'electron';
import {
  getLocalSyncStatus,
  listPendingSyncOperations,
  listSyncOperations,
  listSyncConflicts,
  retryFailedSyncOperations,
  resolveSyncConflict
} from '../database/repositories/sync.repo';

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

  ipcMain.handle('sync:list-operations', (_, input?: {
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    return {
      success: true,
      operations: listSyncOperations(input)
    };
  });

  ipcMain.handle('sync:list-conflicts', (_, input?: {
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    return {
      success: true,
      conflicts: listSyncConflicts(input)
    };
  });

  ipcMain.handle('sync:retry-failed', () => {
    return retryFailedSyncOperations();
  });

  ipcMain.handle('sync:resolve-conflict', (_, input: {
    conflict_id: string;
    status?: 'resolved' | 'ignored';
  }) => {
    return resolveSyncConflict(input);
  });
}