import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';

export type { SqliteDatabase };

/**
 * Single shared connection. better-sqlite3 is synchronous, so there is no pool and
 * no await noise in the repositories - which is exactly what a single-process
 * homelab app wants.
 */
export function openDatabase(file: string): SqliteDatabase {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  return db;
}

export function getSchemaVersion(db: SqliteDatabase): number {
  const rows = db.pragma('user_version') as Array<{ user_version: number }>;
  return rows[0]?.user_version ?? 0;
}

export function closeDatabase(db: SqliteDatabase): void {
  // Fold the WAL back into the main file so a container restart starts clean.
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}
