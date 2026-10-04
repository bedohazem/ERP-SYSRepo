import { ipcMain } from 'electron';

import { listActivityLogs } from '../database/repositories/activity.repo';

import { requirePermission } from '../auth-session';

export function registerActivityIpc(): void {
  ipcMain.handle('activity:list', (event, input) => {
    requirePermission(event, 'activity.view');

    return listActivityLogs(input);
  });
}
