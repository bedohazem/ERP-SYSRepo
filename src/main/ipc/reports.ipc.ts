import { ipcMain } from 'electron'

import {
  getCashierDashboardSummary,
  getReportsSummary,
} from '../database/repositories/reports.repo'

import {
  requireAuthenticatedAdmin,
  requireAuthenticatedUser,
} from '../auth-session'

export function registerReportsIpc(): void {
  ipcMain.handle('reports:summary', (event, input) => {
    requireAuthenticatedAdmin(event)

    return getReportsSummary(input || {})
  })

  ipcMain.handle('reports:cashier-dashboard', (event, input) => {
    const user = requireAuthenticatedUser(event)

    return getCashierDashboardSummary({
      date: String(input?.date || ''),

      /*
       * ممنوع نأخذ ID من
       * الـrenderer.
       */
      user_id: user.id,
    })
  })
}
