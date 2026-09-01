-- ArrRanger schema v2: filesystem operations in the same queue as *Arr operations.
--
-- SQLite cannot relax NOT NULL or edit a CHECK constraint, so queue_items is rebuilt.
-- The migration runner disables foreign keys around this file (outside the transaction,
-- where the pragma actually takes effect) - without that, dropping the old table would
-- cascade-delete every queue_events row through its ON DELETE CASCADE.

CREATE TABLE queue_items_v2 (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  -- NULL for filesystem work: it belongs to the host, not an instance.
  instance_id    INTEGER          REFERENCES instances(id)   ON DELETE CASCADE,
  kind           TEXT    NOT NULL DEFAULT 'arr' CHECK (kind IN ('arr','fs')),
  run_id         INTEGER          REFERENCES queue_runs(id)  ON DELETE SET NULL,
  depends_on_id  INTEGER          REFERENCES queue_items_v2(id) ON DELETE CASCADE,
  sort_order     INTEGER NOT NULL,
  op             TEXT    NOT NULL CHECK (op IN (
                   'tag.create','tag.rename','tag.delete','tag.merge',
                   'mediaTags.add','mediaTags.remove',
                   'rootFolder.create','rootFolder.delete',
                   'media.moveRootFolder','media.refresh',
                   'importList.update','importList.delete','importList.setEnabled',
                   'fs.mkdir','fs.rename','fs.move','fs.delete')),
  status         TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN (
                   'pending','running','succeeded','failed','skipped','cancelled')),
  target_kind    TEXT    NOT NULL CHECK (target_kind IN (
                   'tag','rootFolder','importList','movie','series','path')),
  target_id      INTEGER,
  target_label   TEXT    NOT NULL,
  summary        TEXT    NOT NULL,
  payload        TEXT    NOT NULL,
  affected_count INTEGER NOT NULL DEFAULT 1,
  attempts       INTEGER NOT NULL DEFAULT 0,
  error_code     TEXT,
  error_message  TEXT,
  http_status    INTEGER,
  result         TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at     TEXT,
  finished_at    TEXT,
  -- An *Arr operation is meaningless without its instance; a disk operation must not
  -- claim one. Enforced here so no code path can write a half-addressed row.
  CHECK ((kind = 'arr' AND instance_id IS NOT NULL) OR (kind = 'fs' AND instance_id IS NULL))
);

INSERT INTO queue_items_v2 (
  id, instance_id, kind, run_id, depends_on_id, sort_order, op, status, target_kind,
  target_id, target_label, summary, payload, affected_count, attempts, error_code,
  error_message, http_status, result, created_at, updated_at, started_at, finished_at
)
SELECT
  id, instance_id, 'arr', run_id, depends_on_id, sort_order, op, status, target_kind,
  target_id, target_label, summary, payload, affected_count, attempts, error_code,
  error_message, http_status, result, created_at, updated_at, started_at, finished_at
FROM queue_items;

DROP TABLE queue_items;
ALTER TABLE queue_items_v2 RENAME TO queue_items;

CREATE INDEX idx_queue_pending  ON queue_items(status, sort_order);
CREATE INDEX idx_queue_instance ON queue_items(instance_id, status);
CREATE INDEX idx_queue_run      ON queue_items(run_id);
CREATE INDEX idx_queue_kind     ON queue_items(kind, status);
