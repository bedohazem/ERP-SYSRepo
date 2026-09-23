import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import {
  runDatabaseMigrations,
  type DatabaseMigration,
} from '../../src/main/database/migrations/migrations'

import { closeDb, getDb } from '../../src/main/database/db'

const memoryDatabases: Database.Database[] = []

function createMemoryDatabase() {
  const database = new Database(':memory:')

  memoryDatabases.push(database)

  return database
}

afterEach(() => {
  closeDb()

  while (memoryDatabases.length > 0) {
    const database = memoryDatabases.pop()

    try {
      database?.close()
    } catch {
      // ignore test cleanup failure
    }
  }
})

describe('database migrations', () => {
  it('runs migrations once and records them in order', () => {
    const database = createMemoryDatabase()

    const calls: string[] = []

    const migrations: DatabaseMigration[] = [
      {
        version: 1,
        name: 'create-probe',

        up: (db) => {
          calls.push('v1')

          db.exec(`
            CREATE TABLE migration_probe (
              id INTEGER PRIMARY KEY,
              value TEXT
            );
          `)
        },
      },

      {
        version: 2,
        name: 'seed-probe',

        up: (db) => {
          calls.push('v2')

          db.prepare(
            `
            INSERT INTO migration_probe (
              id,
              value
            )

            VALUES (1, 'ok')
            `,
          ).run()
        },
      },
    ]

    runDatabaseMigrations(database, migrations)

    runDatabaseMigrations(database, migrations)

    expect(calls).toEqual(['v1', 'v2'])

    const rows = database
      .prepare(
        `
        SELECT
          version,
          name

        FROM schema_migrations

        ORDER BY version
        `,
      )
      .all()

    expect(rows).toEqual([
      {
        version: 1,
        name: 'create-probe',
      },
      {
        version: 2,
        name: 'seed-probe',
      },
    ])

    const probe = database
      .prepare(
        `
        SELECT value

        FROM migration_probe

        WHERE id = 1
        `,
      )
      .get() as
      | {
          value: string
        }
      | undefined

    expect(probe?.value).toBe('ok')
  })

  it('rolls back a failed migration without recording its version', () => {
    const database = createMemoryDatabase()

    const migrations: DatabaseMigration[] = [
      {
        version: 1,
        name: 'valid',

        up: (db) => {
          db.exec(`
            CREATE TABLE valid_probe (
              id INTEGER PRIMARY KEY
            );
          `)
        },
      },

      {
        version: 2,
        name: 'broken',

        up: (db) => {
          db.exec(`
            CREATE TABLE rolled_back_probe (
              id INTEGER PRIMARY KEY
            );
          `)

          throw new Error('simulated migration failure')
        },
      },
    ]

    expect(() => runDatabaseMigrations(database, migrations)).toThrow(
      'simulated migration failure',
    )

    const versions = database
      .prepare(
        `
        SELECT version

        FROM schema_migrations

        ORDER BY version
        `,
      )
      .all() as Array<{
      version: number
    }>

    expect(versions.map((row) => row.version)).toEqual([1])

    const rolledBackTable = database
      .prepare(
        `
        SELECT name

        FROM sqlite_master

        WHERE
          type = 'table'
          AND name =
            'rolled_back_probe'

        LIMIT 1
        `,
      )
      .get()

    expect(rolledBackTable).toBeUndefined()
  })

  it('rejects a non sequential migration plan', () => {
    const database = createMemoryDatabase()

    expect(() =>
      runDatabaseMigrations(database, [
        {
          version: 1,
          name: 'one',
          up: () => undefined,
        },

        {
          version: 3,
          name: 'three',
          up: () => undefined,
        },
      ]),
    ).toThrow('خطة ترقية قاعدة البيانات غير صحيحة')
  })

  it('boots ERP with the latest schema before repositories run', () => {
    closeDb()

    const database = getDb()

    const migrations = database
      .prepare(
        `
        SELECT
          version,
          name

        FROM schema_migrations

        ORDER BY version
        `,
      )
      .all()

    expect(migrations).toEqual([
      {
        version: 1,
        name: 'legacy-current-schema',
      },
      {
        version: 2,
        name: 'purchase-return-schema',
      },
    ])

    const purchaseReturnColumns = database
      .prepare(
        `
        PRAGMA table_info(
          purchase_returns
        )
        `,
      )
      .all() as Array<{
      name: string
    }>

    const columnNames = purchaseReturnColumns.map((column) => column.name)

    expect(columnNames).toEqual(
      expect.arrayContaining([
        'purchase_id',
        'supplier_id',
        'total_amount',
        'debt_reduction_amount',
        'cash_refund_amount',
        'refund_payment_method',
        'refund_mode',
        'shift_id',
      ]),
    )
  })
})
