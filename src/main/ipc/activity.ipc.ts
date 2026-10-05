import { ipcMain } from 'electron';

import { listActivityLogs } from '../database/repositories/activity.repo';

import { requirePermission } from '../auth-session';
import {
  optionalDateOnly,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalTrimmedString,
  requireArrayInput,
  requireObjectInput,
  requireTrimmedString,
} from './input-validation';

export function registerActivityIpc(): void {
  ipcMain.handle('activity:list', (event, input) => {
    requirePermission(event, 'activity.view');

    const payload = requireObjectInput(input ?? {}, 'فلتر سجل النشاط');

    const actions =
      payload.actions === undefined || payload.actions === null
        ? undefined
        : requireArrayInput(payload.actions, 'أنواع النشاط', 100).map((value) =>
            requireTrimmedString(value, 'نوع النشاط', 200),
          );

    const entities =
      payload.entities === undefined || payload.entities === null
        ? undefined
        : requireArrayInput(payload.entities, 'أنواع الكيانات', 100).map(
            (value) => requireTrimmedString(value, 'نوع الكيان', 200),
          );

    return listActivityLogs({
      search:
        optionalTrimmedString(payload.search, 'بحث سجل النشاط', 500) ??
        undefined,

      action:
        optionalTrimmedString(payload.action, 'نوع النشاط', 200) ?? undefined,

      actions,

      entity:
        optionalTrimmedString(payload.entity, 'نوع الكيان', 200) ?? undefined,

      entities,

      user_id:
        optionalPositiveInteger(payload.user_id, 'رقم المستخدم') ?? undefined,

      date_from:
        optionalDateOnly(payload.date_from, 'تاريخ البداية') ?? undefined,

      date_to: optionalDateOnly(payload.date_to, 'تاريخ النهاية') ?? undefined,

      limit: optionalPositiveInteger(payload.limit, 'عدد النتائج') ?? undefined,

      offset:
        optionalNonNegativeInteger(payload.offset, 'بداية النتائج') ??
        undefined,
    });
  });
}
