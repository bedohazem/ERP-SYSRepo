import { ipcMain } from 'electron'
import { listActivityLogs } from '../database/repositories/activity.repo'

export function registerActivityIpc(): void {
  ipcMain.handle('activity:list', (_, input) => {
    return listActivityLogs(input)
  })
}
