import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'
import {
  createActivityLog,
  listActivityLogs,
  safeCreateActivityLog,
} from '../../src/main/database/repositories/activity.repo'
import {
  CRITICAL_AUDIT_ERROR_MESSAGE,
  runCriticalActionWithAudit,
} from '../../src/main/ipc/activity-helper'

type ActivityLogTestRow = {
  id: number
  user_id: number | null
  action: string
  entity: string | null
  entity_id: number | null
  details: string | null
  created_at: string
  user_name?: string | null
  username?: string | null
}

function getActivityRows(input?: Parameters<typeof listActivityLogs>[0]) {
  return listActivityLogs(input).rows as ActivityLogTestRow[]
}

describe('activity repository', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('creates an activity log', () => {
    const result = createActivityLog({
      user_id: 1,
      action: 'test_action',
      entity: 'test_entity',
      entity_id: 123,
      details: JSON.stringify({ hello: 'world' }),
    })

    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0)

    const logs = getActivityRows() as ActivityLogTestRow[]

    expect(logs).toHaveLength(1)
    expect(logs[0].user_id).toBe(1)
    expect(logs[0].action).toBe('test_action')
    expect(logs[0].entity).toBe('test_entity')
    expect(logs[0].entity_id).toBe(123)
    expect(logs[0].details).toContain('world')
    expect(logs[0].username).toBe('admin')
  })

  it('safeCreateActivityLog creates a log and does not throw', () => {
    const result = safeCreateActivityLog({
      user_id: 1,
      action: 'safe_action',
      entity: 'safe_entity',
      entity_id: 1,
      details: 'safe details',
    })

    expect(result).not.toBeNull()

    const logs = getActivityRows() as ActivityLogTestRow[]

    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('safe_action')
  })

  it('commits critical operation and audit together', () => {
    const db = getDb()

    db.exec(`
      CREATE TABLE critical_audit_probe (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value TEXT NOT NULL
      );
    `)

    const result = runCriticalActionWithAudit(
      () => {
        const insert = db
          .prepare(
            `
            INSERT INTO critical_audit_probe (
              value
            )
            VALUES (?)
            `,
          )
          .run('committed')

        return {
          id: Number(insert.lastInsertRowid),
        }
      },

      (operation) => ({
        actor_id: 1,

        action: 'critical_probe_created',

        entity: 'critical_audit_probe',

        entity_id: operation.id,

        details: {
          value: 'committed',
        },
      }),
    )

    expect(result.id).toBeGreaterThan(0)

    const probe = db
      .prepare(
        `
        SELECT value
        FROM critical_audit_probe
        WHERE id = ?
        `,
      )
      .get(result.id) as
      | {
          value: string
        }
      | undefined

    expect(probe?.value).toBe('committed')

    const logs = getActivityRows({
      action: 'critical_probe_created',
    })

    expect(logs).toHaveLength(1)
    expect(logs[0].entity_id).toBe(result.id)
  })

  it('rolls back critical operation when audit insert fails', () => {
    const db = getDb()

    db.exec(`
    DROP TRIGGER IF EXISTS fail_critical_activity_log;
    DROP TABLE IF EXISTS critical_audit_rollback_probe;

    CREATE TABLE critical_audit_rollback_probe (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL
    );

    CREATE TRIGGER fail_critical_activity_log
    BEFORE INSERT ON activity_logs
    BEGIN
      SELECT RAISE(
        ABORT,
        'forced critical audit failure'
      );
    END;
  `)

    try {
      expect(() =>
        runCriticalActionWithAudit(
          () => {
            db.prepare(
              `
            INSERT INTO critical_audit_rollback_probe (
              value
            )
            VALUES (?)
            `,
            ).run('must rollback')

            return {
              success: true,
            }
          },

          () => ({
            actor_id: 1,

            action: 'critical_probe_should_fail',

            entity: 'critical_audit_rollback_probe',

            details: {
              value: 'must rollback',
            },
          }),
        ),
      ).toThrow(CRITICAL_AUDIT_ERROR_MESSAGE)

      const probeCount = db
        .prepare(
          `
        SELECT COUNT(*) AS count
        FROM critical_audit_rollback_probe
        `,
        )
        .get() as {
        count: number
      }

      expect(Number(probeCount.count)).toBe(0)
    } finally {
      db.exec(`
      DROP TRIGGER IF EXISTS fail_critical_activity_log;
      DROP TABLE IF EXISTS critical_audit_rollback_probe;
    `)
    }
  })

  it('lists activity logs ordered by newest first', () => {
    createActivityLog({
      user_id: 1,
      action: 'first_action',
      entity: 'first_entity',
      entity_id: 1,
      details: 'first details',
    })

    createActivityLog({
      user_id: 1,
      action: 'second_action',
      entity: 'second_entity',
      entity_id: 2,
      details: 'second details',
    })

    const logs = getActivityRows() as ActivityLogTestRow[]

    expect(logs).toHaveLength(2)
    expect(logs[0].action).toBe('second_action')
    expect(logs[1].action).toBe('first_action')
  })

  it('filters activity logs by action', () => {
    createActivityLog({
      user_id: 1,
      action: 'cash_in',
      entity: 'cash_movements',
      entity_id: 1,
      details: 'cash in details',
    })

    createActivityLog({
      user_id: 1,
      action: 'cash_out',
      entity: 'cash_movements',
      entity_id: 2,
      details: 'cash out details',
    })

    const logs = getActivityRows({ action: 'cash_in' }) as ActivityLogTestRow[]

    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('cash_in')
  })

  it('filters activity logs by multiple actions', () => {
    createActivityLog({
      user_id: 1,
      action: 'cash_in',
      entity: 'cash_movements',
      entity_id: 1,
      details: 'cash in',
    })

    createActivityLog({
      user_id: 1,
      action: 'cash_out',
      entity: 'cash_movements',
      entity_id: 2,
      details: 'cash out',
    })

    createActivityLog({
      user_id: 1,
      action: 'expense_created',
      entity: 'expenses',
      entity_id: 3,
      details: 'expense',
    })

    const result = listActivityLogs({
      actions: ['cash_in', 'expense_created'],
    })

    expect(result.total).toBe(2)

    const rows = result.rows as ActivityLogTestRow[]

    expect(rows.map((row) => row.action)).toEqual([
      'expense_created',
      'cash_in',
    ])
  })

  it('filters activity logs by multiple entities', () => {
    createActivityLog({
      user_id: 1,
      action: 'cash_in',
      entity: 'cash_movements',
      entity_id: 1,
      details: 'cash',
    })

    createActivityLog({
      user_id: 1,
      action: 'expense_created',
      entity: 'expenses',
      entity_id: 2,
      details: 'expense',
    })

    createActivityLog({
      user_id: 1,
      action: 'customer_created',
      entity: 'customers',
      entity_id: 3,
      details: 'customer',
    })

    const result = listActivityLogs({
      entities: ['cash_movements', 'expenses'],
    })

    expect(result.total).toBe(2)

    const rows = result.rows as ActivityLogTestRow[]

    expect(rows.map((row) => row.entity)).toEqual([
      'expenses',
      'cash_movements',
    ])
  })

  it('filters activity logs by entity', () => {
    createActivityLog({
      user_id: 1,
      action: 'expense_created',
      entity: 'expenses',
      entity_id: 1,
      details: 'expense details',
    })

    createActivityLog({
      user_id: 1,
      action: 'cash_out',
      entity: 'cash_movements',
      entity_id: 2,
      details: 'cash details',
    })

    const logs = getActivityRows({
      entity: 'expenses',
    }) as ActivityLogTestRow[]

    expect(logs).toHaveLength(1)
    expect(logs[0].entity).toBe('expenses')
  })

  it('filters activity logs by user id', () => {
    createActivityLog({
      user_id: 1,
      action: 'admin_action',
      entity: 'users',
      entity_id: 1,
      details: 'admin details',
    })

    createActivityLog({
      user_id: null,
      action: 'system_action',
      entity: 'system',
      entity_id: null,
      details: 'system details',
    })

    const logs = getActivityRows({ user_id: 1 }) as ActivityLogTestRow[]

    expect(logs).toHaveLength(1)
    expect(logs[0].user_id).toBe(1)
  })

  it('searches activity logs by action entity details and username', () => {
    createActivityLog({
      user_id: 1,
      action: 'unique_action',
      entity: 'unique_entity',
      entity_id: 1,
      details: 'unique details searchable',
    })

    expect(
      getActivityRows({ search: 'unique_action' }) as ActivityLogTestRow[],
    ).toHaveLength(1)
    expect(
      getActivityRows({ search: 'unique_entity' }) as ActivityLogTestRow[],
    ).toHaveLength(1)
    expect(
      getActivityRows({ search: 'searchable' }) as ActivityLogTestRow[],
    ).toHaveLength(1)
    expect(
      getActivityRows({ search: 'admin' }) as ActivityLogTestRow[],
    ).toHaveLength(1)
  })

  it('respects custom limit', () => {
    for (let index = 1; index <= 5; index += 1) {
      createActivityLog({
        user_id: 1,
        action: `action_${index}`,
        entity: 'test',
        entity_id: index,
        details: `details ${index}`,
      })
    }

    const logs = getActivityRows({ limit: 3 }) as ActivityLogTestRow[]

    expect(logs).toHaveLength(3)
    expect(logs[0].action).toBe('action_5')
    expect(logs[2].action).toBe('action_3')
  })

  it('paginates activity logs without losing older records', () => {
    for (let index = 1; index <= 5; index += 1) {
      createActivityLog({
        user_id: 1,
        action: `page_action_${index}`,
        entity: 'pagination',
        entity_id: index,
        details: `page ${index}`,
      })
    }

    const firstPage = listActivityLogs({
      limit: 2,
      offset: 0,
    })

    const secondPage = listActivityLogs({
      limit: 2,
      offset: 2,
    })

    expect(firstPage.total).toBe(5)
    expect(firstPage.rows).toHaveLength(2)
    expect(secondPage.rows).toHaveLength(2)

    expect((firstPage.rows[0] as ActivityLogTestRow).action).toBe(
      'page_action_5',
    )

    expect((secondPage.rows[0] as ActivityLogTestRow).action).toBe(
      'page_action_3',
    )
  })
})
