import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createActivityLog,
  listActivityLogs,
  safeCreateActivityLog
} from '../../src/main/database/repositories/activity.repo';

type ActivityLogTestRow = {
  id: number;
  user_id: number | null;
  action: string;
  entity: string | null;
  entity_id: number | null;
  details: string | null;
  created_at: string;
  user_name?: string | null;
  username?: string | null;
};

describe('activity repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  it('creates an activity log', () => {
    const result = createActivityLog({
      user_id: 1,
      action: 'test_action',
      entity: 'test_entity',
      entity_id: 123,
      details: JSON.stringify({ hello: 'world' })
    });

    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);

    const logs = listActivityLogs() as ActivityLogTestRow[];

    expect(logs).toHaveLength(1);
    expect(logs[0].user_id).toBe(1);
    expect(logs[0].action).toBe('test_action');
    expect(logs[0].entity).toBe('test_entity');
    expect(logs[0].entity_id).toBe(123);
    expect(logs[0].details).toContain('world');
    expect(logs[0].username).toBe('admin');
  });

  it('safeCreateActivityLog creates a log and does not throw', () => {
    const result = safeCreateActivityLog({
      user_id: 1,
      action: 'safe_action',
      entity: 'safe_entity',
      entity_id: 1,
      details: 'safe details'
    });

    expect(result).not.toBeNull();

    const logs = listActivityLogs() as ActivityLogTestRow[];

    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('safe_action');
  });

  it('lists activity logs ordered by newest first', () => {
    createActivityLog({
      user_id: 1,
      action: 'first_action',
      entity: 'first_entity',
      entity_id: 1,
      details: 'first details'
    });

    createActivityLog({
      user_id: 1,
      action: 'second_action',
      entity: 'second_entity',
      entity_id: 2,
      details: 'second details'
    });

    const logs = listActivityLogs() as ActivityLogTestRow[];

    expect(logs).toHaveLength(2);
    expect(logs[0].action).toBe('second_action');
    expect(logs[1].action).toBe('first_action');
  });

  it('filters activity logs by action', () => {
    createActivityLog({
      user_id: 1,
      action: 'cash_in',
      entity: 'cash_movements',
      entity_id: 1,
      details: 'cash in details'
    });

    createActivityLog({
      user_id: 1,
      action: 'cash_out',
      entity: 'cash_movements',
      entity_id: 2,
      details: 'cash out details'
    });

    const logs = listActivityLogs({ action: 'cash_in' }) as ActivityLogTestRow[];

    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('cash_in');
  });

  it('filters activity logs by entity', () => {
    createActivityLog({
      user_id: 1,
      action: 'expense_created',
      entity: 'expenses',
      entity_id: 1,
      details: 'expense details'
    });

    createActivityLog({
      user_id: 1,
      action: 'cash_out',
      entity: 'cash_movements',
      entity_id: 2,
      details: 'cash details'
    });

    const logs = listActivityLogs({ entity: 'expenses' }) as ActivityLogTestRow[];

    expect(logs).toHaveLength(1);
    expect(logs[0].entity).toBe('expenses');
  });

  it('filters activity logs by user id', () => {
    createActivityLog({
      user_id: 1,
      action: 'admin_action',
      entity: 'users',
      entity_id: 1,
      details: 'admin details'
    });

    createActivityLog({
      user_id: null,
      action: 'system_action',
      entity: 'system',
      entity_id: null,
      details: 'system details'
    });

    const logs = listActivityLogs({ user_id: 1 }) as ActivityLogTestRow[];

    expect(logs).toHaveLength(1);
    expect(logs[0].user_id).toBe(1);
  });

  it('searches activity logs by action entity details and username', () => {
    createActivityLog({
      user_id: 1,
      action: 'unique_action',
      entity: 'unique_entity',
      entity_id: 1,
      details: 'unique details searchable'
    });

    expect(listActivityLogs({ search: 'unique_action' }) as ActivityLogTestRow[]).toHaveLength(1);
    expect(listActivityLogs({ search: 'unique_entity' }) as ActivityLogTestRow[]).toHaveLength(1);
    expect(listActivityLogs({ search: 'searchable' }) as ActivityLogTestRow[]).toHaveLength(1);
    expect(listActivityLogs({ search: 'admin' }) as ActivityLogTestRow[]).toHaveLength(1);
  });

  it('respects custom limit', () => {
    for (let index = 1; index <= 5; index += 1) {
      createActivityLog({
        user_id: 1,
        action: `action_${index}`,
        entity: 'test',
        entity_id: index,
        details: `details ${index}`
      });
    }

    const logs = listActivityLogs({ limit: 3 }) as ActivityLogTestRow[];

    expect(logs).toHaveLength(3);
    expect(logs[0].action).toBe('action_5');
    expect(logs[2].action).toBe('action_3');
  });
});