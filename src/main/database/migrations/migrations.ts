import type Database from 'better-sqlite3'

export type DatabaseMigration = {
  version: number
  name: string
  up: (database: Database.Database) => void
}

type AppliedMigrationRow = {
  version: number
  name: string
}

function validateMigrationPlan(migrations: DatabaseMigration[]) {
  const ordered = [...migrations].sort((a, b) => a.version - b.version)

  for (let index = 0; index < ordered.length; index += 1) {
    const migration = ordered[index]
    const expectedVersion = index + 1

    if (
      !Number.isInteger(migration.version) ||
      migration.version !== expectedVersion
    ) {
      throw new Error(
        `خطة ترقية قاعدة البيانات غير صحيحة. الإصدار المتوقع ${expectedVersion} وليس ${migration.version}`,
      )
    }

    if (!String(migration.name || '').trim()) {
      throw new Error(`اسم Migration الإصدار ${migration.version} غير موجود`)
    }
  }

  return ordered
}

export function runDatabaseMigrations(
  database: Database.Database,
  migrations: DatabaseMigration[],
): void {
  const ordered = validateMigrationPlan(migrations)

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  const applied = database
    .prepare(
      `
      SELECT
        version,
        name

      FROM schema_migrations

      ORDER BY version ASC
      `,
    )
    .all() as AppliedMigrationRow[]

  for (let index = 0; index < applied.length; index += 1) {
    const row = applied[index]
    const expectedVersion = index + 1

    if (row.version !== expectedVersion) {
      throw new Error(
        `سجل إصدارات قاعدة البيانات غير متسلسل عند الإصدار ${row.version}`,
      )
    }

    const definition = ordered.find(
      (migration) => migration.version === row.version,
    )

    if (!definition) {
      throw new Error(
        `قاعدة البيانات إصدارها أحدث من إصدار البرنامج الحالي (${row.version})`,
      )
    }

    if (definition.name !== row.name) {
      throw new Error(
        `Migration الإصدار ${row.version} لا تطابق سجل قاعدة البيانات`,
      )
    }
  }

  const currentVersion =
    applied.length > 0 ? Number(applied[applied.length - 1].version) : 0

  const latestVersion =
    ordered.length > 0 ? Number(ordered[ordered.length - 1].version) : 0

  if (currentVersion > latestVersion) {
    throw new Error(
      `قاعدة البيانات إصدارها ${currentVersion} وهو أحدث من إصدار البرنامج ${latestVersion}`,
    )
  }

  for (const migration of ordered) {
    if (migration.version <= currentVersion) {
      continue
    }

    const migrate = database.transaction(() => {
      migration.up(database)

      database
        .prepare(
          `
          INSERT INTO schema_migrations (
            version,
            name
          )

          VALUES (?, ?)
          `,
        )
        .run(migration.version, migration.name)
    })

    migrate()
  }
}
