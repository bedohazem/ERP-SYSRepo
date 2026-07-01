import { randomUUID } from 'node:crypto';
import { getDb } from '../db';

export type SyncOperationStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

export type EnqueueSyncOperationInput = {
  type: string;
  entity?: string | null;
  entity_id?: string | number | null;
  payload: unknown;
  operation_id?: string;
};

function getSetting(key: string, fallback = '') {
  const db = getDb();

  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ? LIMIT 1`)
    .get(key) as { value: string } | undefined;

  return row?.value ?? fallback;
}

function saveSetting(key: string, value: string) {
  const db = getDb();

  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function getOrCreateDeviceId() {
  const existing = getSetting('device_id', '').trim();

  if (existing) {
    return existing;
  }

  const deviceId = `device_${randomUUID()}`;

  saveSetting('device_id', deviceId);

  return deviceId;
}

export function enqueueSyncOperation(input: EnqueueSyncOperationInput) {
  const db = getDb();
  const deviceId = getOrCreateDeviceId();
  const operationId = input.operation_id || `op_${randomUUID()}`;

  db.prepare(`
    INSERT OR IGNORE INTO sync_operations (
      id,
      device_id,
      type,
      entity,
      entity_id,
      payload,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    operationId,
    deviceId,
    input.type,
    input.entity ?? null,
    input.entity_id == null ? null : String(input.entity_id),
    JSON.stringify(input.payload ?? null)
  );

  return {
    operation_id: operationId,
    device_id: deviceId
  };
}

export function listPendingSyncOperations(limit = 100) {
  const db = getDb();

  return db
    .prepare(`
      SELECT *
      FROM sync_operations
      WHERE status IN ('pending', 'failed')
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(Math.max(1, Math.min(Number(limit || 100), 500)));
}

export function markSyncOperationSyncing(operationId: string) {
  const db = getDb();

  db.prepare(`
    UPDATE sync_operations
    SET status = 'syncing',
        attempts = attempts + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(operationId);

  return { success: true };
}

export function markSyncOperationSynced(operationId: string, serverId?: string | null) {
  const db = getDb();

  db.prepare(`
    UPDATE sync_operations
    SET status = 'synced',
        server_id = ?,
        error = NULL,
        synced_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(serverId ?? null, operationId);

  setSyncState('last_sync_at', new Date().toISOString());

  return { success: true };
}

export function markSyncOperationFailed(operationId: string, error: unknown) {
  const db = getDb();

  const message = error instanceof Error ? error.message : String(error || 'Sync failed');

  db.prepare(`
    UPDATE sync_operations
    SET status = 'failed',
        error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(message, operationId);

  return { success: false, message };
}

export function setSyncState(key: string, value: string) {
  const db = getDb();

  db.prepare(`
    INSERT INTO sync_state (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, value);

  return { success: true };
}

export function getSyncState(key: string, fallback = '') {
  const db = getDb();

  const row = db
    .prepare(`SELECT value FROM sync_state WHERE key = ? LIMIT 1`)
    .get(key) as { value: string } | undefined;

  return row?.value ?? fallback;
}

export function recordSyncConflict(input: {
  operation_id?: string | null;
  type: string;
  message: string;
  payload?: unknown;
}) {
  const db = getDb();
  const conflictId = `conflict_${randomUUID()}`;
  const deviceId = getOrCreateDeviceId();

  db.prepare(`
    INSERT INTO sync_conflicts (
      id,
      operation_id,
      device_id,
      type,
      message,
      payload,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, 'open')
  `).run(
    conflictId,
    input.operation_id ?? null,
    deviceId,
    input.type,
    input.message,
    JSON.stringify(input.payload ?? null)
  );

  return {
    success: true,
    conflict_id: conflictId
  };
}

export function getLocalSyncStatus() {
  const db = getDb();
  const deviceId = getOrCreateDeviceId();

  const row = db
    .prepare(`
      SELECT
        IFNULL(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
        IFNULL(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count,
        IFNULL(SUM(CASE WHEN status = 'syncing' THEN 1 ELSE 0 END), 0) AS syncing_count
      FROM sync_operations
    `)
    .get() as {
      pending_count: number;
      failed_count: number;
      syncing_count: number;
    };

  const conflictsRow = db
    .prepare(`
      SELECT COUNT(*) AS open_conflicts
      FROM sync_conflicts
      WHERE status = 'open'
    `)
    .get() as { open_conflicts: number };

  return {
    device_id: deviceId,
    pending_count: Number(row.pending_count || 0),
    failed_count: Number(row.failed_count || 0),
    syncing_count: Number(row.syncing_count || 0),
    open_conflicts: Number(conflictsRow.open_conflicts || 0),
    last_sync_at: getSyncState('last_sync_at', '')
  };
}

export function listSyncOperations(input?: {
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();

  const allowedStatuses = ['all', 'pending', 'syncing', 'synced', 'failed', 'conflict'];
  const status = allowedStatuses.includes(String(input?.status || 'all'))
    ? String(input?.status || 'all')
    : 'all';

  const limit = Math.min(Math.max(Number(input?.limit || 100), 1), 500);
  const offset = Math.max(Number(input?.offset || 0), 0);

  const whereSql = status === 'all' ? '' : 'WHERE status = ?';
  const params = status === 'all' ? [limit, offset] : [status, limit, offset];

  return db
    .prepare(`
      SELECT
        id,
        device_id,
        type,
        entity,
        entity_id,
        status,
        attempts,
        error,
        server_id,
        created_at,
        updated_at,
        synced_at,
        payload
      FROM sync_operations
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ?
      OFFSET ?
    `)
    .all(...params);
}

export function listSyncConflicts(input?: {
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();

  const allowedStatuses = ['all', 'open', 'resolved', 'ignored'];
  const status = allowedStatuses.includes(String(input?.status || 'open'))
    ? String(input?.status || 'open')
    : 'open';

  const limit = Math.min(Math.max(Number(input?.limit || 100), 1), 500);
  const offset = Math.max(Number(input?.offset || 0), 0);

  const whereSql = status === 'all' ? '' : 'WHERE status = ?';
  const params = status === 'all' ? [limit, offset] : [status, limit, offset];

  return db
    .prepare(`
      SELECT
        id,
        operation_id,
        device_id,
        type,
        message,
        payload,
        status,
        created_at,
        resolved_at
      FROM sync_conflicts
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ?
      OFFSET ?
    `)
    .all(...params);
}

export function retryFailedSyncOperations() {
  const db = getDb();

  const result = db
    .prepare(`
      UPDATE sync_operations
      SET status = 'pending',
          error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE status IN ('failed', 'syncing')
    `)
    .run();

  return {
    success: true,
    changed: result.changes
  };
}

export function resolveSyncConflict(input: {
  conflict_id: string;
  status?: 'resolved' | 'ignored';
}) {
  const db = getDb();

  const conflictId = String(input.conflict_id || '').trim();
  const status = input.status === 'ignored' ? 'ignored' : 'resolved';

  if (!conflictId) {
    throw new Error('Conflict ID is required');
  }

  const result = db
    .prepare(`
      UPDATE sync_conflicts
      SET status = ?,
          resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .run(status, conflictId);

  return {
    success: true,
    changed: result.changes
  };
}