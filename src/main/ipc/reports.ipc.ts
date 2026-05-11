import { ipcMain } from 'electron';
import { getReportsSummary } from '../database/repositories/reports.repo';

export function registerReportsIpc(): void {
  ipcMain.handle('reports:summary', (_, input) => {
    return getReportsSummary(input);
  });
}