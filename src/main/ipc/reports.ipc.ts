import { ipcMain } from 'electron'

import {
  getAdminCashFlowAlerts,
  getCashierDashboardSummary,
  getReportsSummary,
} from '../database/repositories/reports.repo'

import { requireAuthenticatedAdmin, requirePermission } from '../auth-session'

export function registerReportsIpc(): void {
  ipcMain.handle('reports:summary', (event, input) => {
    requirePermission(event, 'reports.view')

    return getReportsSummary(input || {})
  })

  ipcMain.handle('reports:admin-cash-flow-alerts', (event) => {
    requireAuthenticatedAdmin(event)

    return getAdminCashFlowAlerts()
  })

  ipcMain.handle('reports:cashier-dashboard', (event) => {
    const user = requirePermission(event, 'dashboard.view')

    return getCashierDashboardSummary({
      user_id: user.id,
    })
  })
}
