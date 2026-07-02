import { ipcMain } from 'electron';
import {
  getLocalSyncStatus,
  listPendingSyncOperations,
  listSyncOperations,
  listSyncConflicts,
  retryFailedSyncOperations,
  resolveSyncConflict,
  getCloudSyncSettings,
  saveCloudSyncSettings,
  testCloudSyncConnection,
  uploadSyncOperationToCloud,
} from '../database/repositories/sync.repo';
import { runCloudSyncOnce } from '../sync/cloud-sync-scheduler';

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

  ipcMain.handle('sync:get-cloud-settings', () => {
    return {
      success: true,
      settings: getCloudSyncSettings()
    };
  });

  ipcMain.handle('sync:save-cloud-settings', (_, input) => {
    return saveCloudSyncSettings(input);
  });

  ipcMain.handle('sync:test-connection', async (_, input) => {
    return testCloudSyncConnection(input);
  });

  ipcMain.handle('sync:upload-operation', async (_, operationId: string) => {
    return uploadSyncOperationToCloud(operationId);
  });

  ipcMain.handle('sync:upload-pending', async (_, limit?: number) => {
    return runCloudSyncOnce(limit || 20);
  });
}