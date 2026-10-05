import { ipcMain } from 'electron';

import {
  getAdminCashFlowAlerts,
  getCashierDashboardSummary,
  getReportsSummary,
} from '../database/repositories/reports.repo';
import {
  optionalDateOnly,
  optionalPositiveInteger,
  requireObjectInput,
} from './input-validation';
import { requireAuthenticatedAdmin, requirePermission } from '../auth-session';

export function registerReportsIpc(): void {
  ipcMain.handle('reports:summary', (event, input) => {
    requirePermission(event, 'reports.view');

    const payload = requireObjectInput(input ?? {}, 'فلتر التقارير');

    return getReportsSummary({
      date_from:
        optionalDateOnly(payload.date_from, 'تاريخ بداية التقرير') ?? undefined,

      date_to:
        optionalDateOnly(payload.date_to, 'تاريخ نهاية التقرير') ?? undefined,

      user_id:
        optionalPositiveInteger(payload.user_id, 'رقم المستخدم') ?? undefined,
    });
  });

  ipcMain.handle('reports:admin-cash-flow-alerts', (event) => {
    requireAuthenticatedAdmin(event);

    return getAdminCashFlowAlerts();
  });

  ipcMain.handle('reports:cashier-dashboard', (event) => {
    const user = requirePermission(event, 'dashboard.view');

    return getCashierDashboardSummary({
      user_id: user.id,
    });
  });
}
