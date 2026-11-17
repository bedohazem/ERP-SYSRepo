'use strict';

// Non-destructive acceptance check for ERP Store.
// Usage: node scripts/verify-store-upgrade.cjs prepare|verify "C:\\...\\erp.db" "C:\\...\\isolated-test-dir"
// Never opens the original SQLite database for writing.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

function stop(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function quoteIdent(name) {
  return '"' + name.replaceAll('"', '""') + '"';
}

function openReadOnly(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return db;
}

function latestMigration(db) {
  const exists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
  ).get();
  if (!exists) return 0;
  return Number(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version || 0);
}

function snapshot(db) {
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') stop(`SQLite integrity_check failed: ${integrity}`);

  const foreignKeyErrors = db.pragma('foreign_key_check');
  if (foreignKeyErrors.length) {
    stop(`SQLite foreign_key_check found ${foreignKeyErrors.length} problems`);
  }

  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name <> 'schema_migrations'
    ORDER BY name
  `).all().map(row => row.name);

  const result = {};
  for (const table of tables) {
    const hash = crypto.createHash('sha256');
    let rows = 0;
    const statement = db.prepare(`SELECT * FROM ${quoteIdent(table)}`);
    for (const record of statement.iterate()) {
      hash.update(JSON.stringify(record));
      hash.update('\n');
      rows++;
    }
    result[table] = { rows, sha256: hash.digest('hex') };
  }

  return { version: latestMigration(db), tables: result };
}

async function main() {
  const [mode, sourceArg, rootArg] = process.argv.slice(2);
  if (!['prepare', 'verify'].includes(mode) || !sourceArg || !rootArg) {
    stop('Usage: node scripts/verify-store-upgrade.cjs prepare|verify "PATH_TO_STORE_ERP.DB" "ISOLATED_TEST_DIR"');
  }

  const source = path.resolve(sourceArg);
  const root = path.resolve(rootArg);
  const liveDirectory = path.dirname(source).toLowerCase();
  const rootLower = root.toLowerCase();

  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    stop('Original database not found. Verify the store database path.');
  }
  if (rootLower === liveDirectory || rootLower.startsWith(liveDirectory + path.sep)) {
    stop('Test directory must be OUTSIDE the live ERP userData directory.');
  }

  const beforePath = path.join(root, 'before.db');
  const isolatedDir = path.join(root, 'userData');
  const isolatedDb = path.join(isolatedDir, 'erp.db');
  const manifestPath = path.join(root, 'baseline.json');

  if (mode === 'prepare') {
    if ([beforePath, isolatedDb, manifestPath].some(file => fs.existsSync(file))) {
      stop('Test files already exist. Use a NEW isolated test directory.');
    }

    fs.mkdirSync(isolatedDir, { recursive: true });
    const originalHash = sha256File(source);
    const srcDb = openReadOnly(source);
    try {
      // SQLite's backup API includes committed WAL changes and produces one consistent DB.
      await srcDb.backup(beforePath);
    } finally {
      srcDb.close();
    }

    const originalHashAfter = sha256File(source);
    if (originalHash !== originalHashAfter) {
      stop('Live database file changed during backup. Stop the store app and start again with a new test folder.');
    }

    fs.copyFileSync(beforePath, isolatedDb, fs.constants.COPYFILE_EXCL);
    const beforeDb = openReadOnly(beforePath);
    let baseline;
    try {
      baseline = snapshot(beforeDb);
    } finally {
      beforeDb.close();
    }
    fs.writeFileSync(manifestPath, JSON.stringify({
      sourcePath: source,
      sourceSha256: originalHash,
      createdAt: new Date().toISOString(),
      ...baseline
    }, null, 2));

    console.log('PASS: Consistent SQLite backup created.');
    console.log('Source opened READ-ONLY. Original SHA256:', originalHash);
    console.log('Starting schema version:', baseline.version);
    console.log('Existing tables captured:', Object.keys(baseline.tables).length);
    console.log('Isolated userData folder:', isolatedDir);
    console.log('Test root (KEEP for audit):', root);
    console.log('NEXT: Run the NEW ERP Electron E2E mode with ERP_E2E_USER_DATA_DIR pointing to this isolated userData folder.');
    return;
  }

  if (!fs.existsSync(manifestPath) || !fs.existsSync(beforePath) || !fs.existsSync(isolatedDb)) {
    stop('Missing baseline/test database. Run prepare first.');
  }

  const baseline = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (path.resolve(baseline.sourcePath) !== source) {
    stop('Source path does not match the originally backed-up database.');
  }
  if (sha256File(source) !== baseline.sourceSha256) {
    stop('Original store DB file SHA256 changed since prepare. Investigate before approval.');
  }

  const testDb = openReadOnly(isolatedDb);
  let after;
  try {
    after = snapshot(testDb);
  } finally {
    testDb.close();
  }

  const changed = [];
  for (const [table, before] of Object.entries(baseline.tables)) {
    const now = after.tables[table];
    if (!now) {
      changed.push(`${table}: table missing after upgrade`);
    } else if (before.rows !== now.rows || before.sha256 !== now.sha256) {
      changed.push(`${table}: ${before.rows} -> ${now.rows} rows; original content changed`);
    }
  }

  console.log('Original DB remains unchanged: PASS');
  console.log(`Version: ${baseline.version} -> ${after.version}`);
  console.log('Original data tables compared:', Object.keys(baseline.tables).length);
  console.log('SQLite integrity_check: PASS');
  console.log('SQLite foreign_key_check: PASS');

  if (after.version < 42) changed.push('Migration 42 not applied');
  if (after.version < baseline.version) changed.push('Database version went backwards');

  if (changed.length) {
    for (const item of changed) console.error('MISMATCH:', item);
    console.error('NOT APPROVED. Do NOT update the store. Keep the test directory for investigation:', root);
    process.exitCode = 1;
  } else {
    console.log('PASS: Every pre-existing data table has identical rows/content after opening the copied DB with the new ERP code.');
    if (baseline.version >= after.version) {
      console.log('WARNING: The backup was already on the same schema version; this verifies preservation, NOT a historical-version migration.');
    }
    console.log('Keep test directory for further manual acceptance checks:', root);
  }
}

main().catch(err => {
  console.error('Upgrade audit stopped:', err.message);
  process.exitCode = 1;
});
