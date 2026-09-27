import { ipcMain } from 'electron'

import {
  getCashierDashboardSummary,
  getReportsSummary,
} from '../database/repositories/reports.repo'

import { requirePermission } from '../auth-session'

export function registerReportsIpc(): void {
  ipcMain.handle('reports:summary', (event, input) => {
    requirePermission(event, 'reports.view')

    return getReportsSummary(input || {})
  })

  ipcMain.handle('reports:cashier-dashboard', (event) => {
    const user = requirePermission(event, 'dashboard.view')

    return getCashierDashboardSummary({
      user_id: user.id,
    })
  })
}
