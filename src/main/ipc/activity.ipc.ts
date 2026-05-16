import { ipcMain } from 'electron';
import { listActivityLogs } from '../database/repositories/activity.repo';

export function registerActivityIpc(): void {
  ipcMain.handle('activity:list', (_, input?: { search?: string; limit?: number }) => {
    return listActivityLogs(input);
  });
}