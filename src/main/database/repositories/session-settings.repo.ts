import { getDb } from '../db';
import {
  DEFAULT_SESSION_SETTINGS,
  isSessionIdleMinutes,
  type SessionSettings,
} from '../../../shared/session-settings';

export function getSessionSettings(): SessionSettings {
  const rows = getDb()
    .prepare(
      `
      SELECT key, value
      FROM app_settings
      WHERE key IN (
        'session_auto_lock_enabled',
        'session_idle_minutes'
      )
    `,
    )
    .all() as Array<{ key: string; value: string }>;

  const values = new Map(rows.map((row) => [row.key, row.value]));

  const enabledValue = values.get('session_auto_lock_enabled');
  const minutesValue = Number(values.get('session_idle_minutes'));

  return {
    auto_lock_enabled:
      enabledValue === 'false'
        ? false
        : DEFAULT_SESSION_SETTINGS.auto_lock_enabled,

    idle_minutes: isSessionIdleMinutes(minutesValue)
      ? minutesValue
      : DEFAULT_SESSION_SETTINGS.idle_minutes,
  };
}

export function saveSessionSettings(input: SessionSettings): SessionSettings {
  if (
    typeof input?.auto_lock_enabled !== 'boolean' ||
    !isSessionIdleMinutes(input?.idle_minutes)
  ) {
    throw new Error('إعدادات انتهاء الجلسة غير صحيحة');
  }

  const db = getDb();

  const save = db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value
  `);

  db.transaction(() => {
    save.run('session_auto_lock_enabled', String(input.auto_lock_enabled));

    save.run('session_idle_minutes', String(input.idle_minutes));
  })();

  return getSessionSettings();
}
