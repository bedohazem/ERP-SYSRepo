import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../../src/main/database/db';
import {
  DEFAULT_SESSION_SETTINGS,
  type SessionSettings,
} from '../../src/shared/session-settings';
import {
  getSessionSettings,
  saveSessionSettings,
} from '../../src/main/database/repositories/session-settings.repo';

function clearSessionSettings() {
  getDb()
    .prepare(
      `
      DELETE FROM app_settings
      WHERE key IN (
        'session_auto_lock_enabled',
        'session_idle_minutes'
      )
    `,
    )
    .run();
}

describe('session settings repository', () => {
  beforeEach(() => {
    closeDb();
    clearSessionSettings();
  });

  afterEach(() => {
    clearSessionSettings();
    closeDb();
  });

  it('defaults to enabled with 15 minutes', () => {
    expect(getSessionSettings()).toEqual(DEFAULT_SESSION_SETTINGS);
  });

  it('persists disabled auto lock and the selected duration', () => {
    const settings = saveSessionSettings({
      auto_lock_enabled: false,
      idle_minutes: 120,
    });

    expect(settings).toEqual({
      auto_lock_enabled: false,
      idle_minutes: 120,
    });

    closeDb();

    expect(getSessionSettings()).toEqual(settings);
  });

  it('rejects invalid settings without modifying the stored policy', () => {
    saveSessionSettings({
      auto_lock_enabled: true,
      idle_minutes: 30,
    });

    expect(() =>
      saveSessionSettings({
        auto_lock_enabled: false,
        idle_minutes: 7,
      } as unknown as SessionSettings),
    ).toThrow('إعدادات انتهاء الجلسة غير صحيحة');

    expect(() =>
      saveSessionSettings({
        auto_lock_enabled: 'false',
        idle_minutes: 30,
      } as unknown as SessionSettings),
    ).toThrow('إعدادات انتهاء الجلسة غير صحيحة');

    expect(getSessionSettings()).toEqual({
      auto_lock_enabled: true,
      idle_minutes: 30,
    });
  });

  it('falls back safely when legacy settings are corrupted', () => {
    const db = getDb();

    db.prepare(
      `
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
    `,
    ).run('session_auto_lock_enabled', 'invalid');

    db.prepare(
      `
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
    `,
    ).run('session_idle_minutes', '999999');

    expect(getSessionSettings()).toEqual(DEFAULT_SESSION_SETTINGS);
  });
});
