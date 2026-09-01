-- ArrRanger schema v1
-- Connection pragmas (WAL, foreign_keys, busy_timeout) live in db/client.ts:
-- they are per-connection and would be a no-op inside this transaction.

CREATE TABLE instances (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL UNIQUE,
  kind              TEXT    NOT NULL CHECK (kind IN ('radarr','sonarr')),
  base_url          TEXT    NOT NULL,               -- normalised, no trailing slash
  api_key_enc       TEXT    NOT NULL,               -- 'v1:<iv_b64>:<tag_b64>:<ct_b64>'
  verify_ssl        INTEGER NOT NULL DEFAULT 1 CHECK (verify_ssl IN (0,1)),
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled    IN (0,1)),
  timeout_ms        INTEGER NOT NULL DEFAULT 20000,
  app_version       TEXT,                           -- from /api/v3/system/status
  last_connected_at TEXT,
  last_error        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_instances_url ON instances(base_url, kind);

-- One "Apply All" execution.
CREATE TABLE queue_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  status          TEXT    NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running','paused','completed','failed','cancelled')),
  on_error        TEXT    NOT NULL DEFAULT 'pause'
                          CHECK (on_error IN ('pause','continue','abort')),
  total_items     INTEGER NOT NULL DEFAULT 0,
  succeeded_items INTEGER NOT NULL DEFAULT 0,
  failed_items    INTEGER NOT NULL DEFAULT 0,
  skipped_items   INTEGER NOT NULL DEFAULT 0,
  current_item_id INTEGER,
  error           TEXT,
  started_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at     TEXT
);
CREATE INDEX idx_runs_status ON queue_runs(status);

-- The staging queue. Nothing here has touched an *Arr instance yet.
CREATE TABLE queue_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id    INTEGER NOT NULL REFERENCES instances(id)   ON DELETE CASCADE,
  run_id         INTEGER          REFERENCES queue_runs(id)  ON DELETE SET NULL,
  depends_on_id  INTEGER          REFERENCES queue_items(id) ON DELETE CASCADE,
  sort_order     INTEGER NOT NULL,                 -- user-reorderable execution order
  op             TEXT    NOT NULL CHECK (op IN (
                   'tag.create','tag.rename','tag.delete','tag.merge',
                   'mediaTags.add','mediaTags.remove',
                   'rootFolder.create','rootFolder.delete',
                   'media.moveRootFolder',
                   'importList.update','importList.delete','importList.setEnabled')),
  status         TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN (
                   'pending','running','succeeded','failed','skipped','cancelled')),
  target_kind    TEXT    NOT NULL CHECK (target_kind IN (
                   'tag','rootFolder','importList','movie','series')),
  target_id      INTEGER,                          -- remote *Arr id; NULL for creates
  target_label   TEXT    NOT NULL,                 -- snapshot, survives remote deletion
  summary        TEXT    NOT NULL,                 -- "Rename tag 'hd' to '1080p'"
  payload        TEXT    NOT NULL,                 -- JSON, discriminated by `op`
  affected_count INTEGER NOT NULL DEFAULT 1,
  attempts       INTEGER NOT NULL DEFAULT 0,
  error_code     TEXT,
  error_message  TEXT,
  http_status    INTEGER,
  result         TEXT,                             -- JSON: created ids, *Arr command id
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at     TEXT,
  finished_at    TEXT
);
CREATE INDEX idx_queue_pending  ON queue_items(status, sort_order);
CREATE INDEX idx_queue_instance ON queue_items(instance_id, status);
CREATE INDEX idx_queue_run      ON queue_items(run_id);

-- Per-attempt audit trail: what we sent, what came back. Drives the error drawer.
CREATE TABLE queue_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER REFERENCES queue_runs(id)  ON DELETE CASCADE,
  item_id       INTEGER REFERENCES queue_items(id) ON DELETE CASCADE,
  at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  level         TEXT    NOT NULL CHECK (level IN ('debug','info','warn','error')),
  message       TEXT    NOT NULL,
  http_method   TEXT,
  http_url      TEXT,
  http_status   INTEGER,
  request_body  TEXT,
  response_body TEXT
);
CREATE INDEX idx_events_run ON queue_events(run_id, at);

-- Cached raw *Arr responses so the grid renders without hammering the API.
CREATE TABLE resource_snapshots (
  instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  resource    TEXT    NOT NULL CHECK (resource IN (
                'tag','tagDetail','rootFolder','importList','qualityProfile','media')),
  payload     TEXT    NOT NULL,   -- verbatim JSON array from the *Arr API
  fetched_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (instance_id, resource)
) WITHOUT ROWID;

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
