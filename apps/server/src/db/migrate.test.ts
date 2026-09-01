import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { makeTempDir } from '../__tests__/helpers.js';
import { closeDatabase, openDatabase, type SqliteDatabase } from './client.js';
import { runMigrations } from './migrate.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

/** Builds the database exactly as a Phase 2/3 install left it, then migrates forward. */
function seedVersionOne(db: SqliteDatabase): void {
  db.exec(readFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), 'utf8'));
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run('001_init.sql');
  db.pragma('user_version = 1');

  db.prepare(
    `INSERT INTO instances (name, kind, base_url, api_key_enc) VALUES ('Radarr','radarr','http://host:7878','v1:x:y:z')`,
  ).run();
  db.prepare(
    `INSERT INTO queue_items (instance_id, sort_order, op, target_kind, target_label, summary, payload)
     VALUES (1, 1, 'tag.rename', 'tag', 'hd', 'Rename tag "hd" to "1080p"', '{"tagId":1,"from":"hd","to":"1080p"}')`,
  ).run();
  db.prepare(
    `INSERT INTO queue_runs (status, on_error, total_items) VALUES ('completed','pause',1)`,
  ).run();
  db.prepare(
    `INSERT INTO queue_events (run_id, item_id, level, message, http_method, http_status, request_body)
     VALUES (1, 1, 'error', 'arr_validation_failed: Label already exists', 'PUT', 400, '{"label":"1080p"}')`,
  ).run();
}

describe('migration 002', () => {
  let configDir: string;
  let db: SqliteDatabase;

  before(() => {
    configDir = makeTempDir();
    db = openDatabase(path.join(configDir, 'arrranger.db'));
    seedVersionOne(db);
  });

  after(() => {
    closeDatabase(db);
    rmSync(configDir, { recursive: true, force: true });
  });

  test('keeps queue items and their audit trail through the table rebuild', () => {
    const result = runMigrations(db, MIGRATIONS_DIR);
    assert.deepEqual(result.applied, ['002_filesystem.sql']);
    assert.equal(result.schemaVersion, 2);

    const item = db.prepare('SELECT * FROM queue_items WHERE id = 1').get() as {
      instance_id: number;
      kind: string;
      summary: string;
    };
    assert.equal(item.instance_id, 1);
    assert.equal(item.kind, 'arr', 'existing rows are *Arr operations');
    assert.equal(item.summary, 'Rename tag "hd" to "1080p"');

    // queue_events.item_id cascades on delete: a naive rebuild would have wiped this.
    const events = db.prepare('SELECT COUNT(*) AS count FROM queue_events').get() as { count: number };
    assert.equal(events.count, 1);

    const violations = db.pragma('foreign_key_check') as unknown[];
    assert.deepEqual(violations, []);
  });

  test('accepts a filesystem item with no instance', () => {
    db.prepare(
      `INSERT INTO queue_items (instance_id, kind, sort_order, op, target_kind, target_label, summary, payload)
       VALUES (NULL, 'fs', 2, 'fs.rename', 'path', '/data/media/movies', 'Rename on disk', '{"from":"/a","to":"/b"}')`,
    ).run();

    const row = db.prepare("SELECT instance_id, kind FROM queue_items WHERE op = 'fs.rename'").get() as {
      instance_id: number | null;
      kind: string;
    };
    assert.equal(row.instance_id, null);
    assert.equal(row.kind, 'fs');
  });

  test('rejects a half-addressed row', () => {
    // An *Arr operation without an instance, or a disk operation claiming one.
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO queue_items (instance_id, kind, sort_order, op, target_kind, target_label, summary, payload)
           VALUES (NULL, 'arr', 3, 'tag.create', 'tag', 'x', 'x', '{}')`,
        )
        .run(),
    );
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO queue_items (instance_id, kind, sort_order, op, target_kind, target_label, summary, payload)
           VALUES (1, 'fs', 4, 'fs.mkdir', 'path', '/x', 'x', '{}')`,
        )
        .run(),
    );
  });

  test('is idempotent on a second boot', () => {
    const again = runMigrations(db, MIGRATIONS_DIR);
    assert.deepEqual(again.applied, []);
    assert.equal(again.skipped, 2);
  });
});
