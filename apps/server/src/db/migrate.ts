import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { SqliteDatabase } from './client.js';

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: number;
  readonly schemaVersion: number;
}

const MIGRATION_PATTERN = /^(\d+)_[\w-]+\.sql$/;

function readPragmaFlag(db: SqliteDatabase, name: string): boolean {
  const rows = db.pragma(name) as Array<Record<string, number>>;
  return (rows[0]?.[name] ?? 0) === 1;
}

/**
 * Forward-only file migrations. Each file runs inside its own transaction and is
 * recorded in `schema_migrations`; `user_version` mirrors the highest applied file
 * so `sqlite3 arrranger.db 'PRAGMA user_version'` tells you where you are.
 *
 * Foreign keys are disabled for the duration of a migration and re-checked afterwards.
 * SQLite's table-rebuild recipe (create -> copy -> drop -> rename) needs that: with
 * enforcement on, dropping a referenced table cascades through ON DELETE CASCADE and
 * quietly takes dependent rows with it. `PRAGMA foreign_keys` is a no-op inside a
 * transaction, which is why it is toggled here rather than in the .sql file.
 */
export function runMigrations(
  db: SqliteDatabase,
  migrationsDir: string,
  log: (message: string) => void = () => {},
): MigrationResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);

  const alreadyApplied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );

  const files = readdirSync(migrationsDir)
    .filter((file) => MIGRATION_PATTERN.test(file))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const applied: string[] = [];
  const record = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');

  const pending = files.filter((file) => !alreadyApplied.has(file));
  const foreignKeysWereOn = readPragmaFlag(db, 'foreign_keys');

  if (pending.length > 0 && foreignKeysWereOn) db.pragma('foreign_keys = OFF');

  try {
    for (const file of pending) {
      const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
      const version = Number.parseInt(MIGRATION_PATTERN.exec(file)?.[1] ?? '0', 10);

      const apply = db.transaction(() => {
        db.exec(sql);
        record.run(file);
        // Interpolated, not bound: SQLite does not accept parameters in PRAGMA.
        db.pragma(`user_version = ${version}`);
      });

      apply();
      applied.push(file);
      log(`applied migration ${file}`);
    }
  } finally {
    if (pending.length > 0 && foreignKeysWereOn) db.pragma('foreign_keys = ON');
  }

  if (applied.length > 0 && foreignKeysWereOn) {
    const violations = db.pragma('foreign_key_check') as unknown[];
    if (violations.length > 0) {
      throw new Error(
        `Migration left ${String(violations.length)} foreign key violation(s): ${JSON.stringify(violations.slice(0, 5))}`,
      );
    }
  }

  const versionRows = db.pragma('user_version') as Array<{ user_version: number }>;
  return {
    applied,
    skipped: files.length - applied.length,
    schemaVersion: versionRows[0]?.user_version ?? 0,
  };
}
