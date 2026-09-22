import { ipcMain } from 'electron'
import { listActivityLogs } from '../database/repositories/activity.repo'
import { requireAuthenticatedAdmin } from '../auth-session'

export function registerActivityIpc(): void {
  ipcMain.handle('activity:list', (event, input) => {
    requireAuthenticatedAdmin(event)

    return listActivityLogs(input)
  })
}
