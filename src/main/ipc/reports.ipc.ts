import { ipcMain } from 'electron'

import { getReportsSummary } from '../database/repositories/reports.repo'

import { requireAuthenticatedUser } from '../auth-session'

export function registerReportsIpc(): void {
  ipcMain.handle('reports:summary', (event, input) => {
    const user = requireAuthenticatedUser(event)

    return getReportsSummary({
      ...(input || {}),

      user_id: user.role === 'admin' ? input?.user_id : user.id,
    })
  })
}
