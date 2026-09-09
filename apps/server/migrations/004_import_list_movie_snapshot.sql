-- Fleetarr schema v4: cache what Radarr's import lists currently hold.
--
-- `/media` answers "which list did this come from" by joining the library to
-- GET /api/v3/importlist/movie on tmdbId. Sonarr has no equivalent endpoint, so that
-- question stays unknown there - deliberately not "no list".
--
-- SQLite cannot edit a CHECK constraint, so resource_snapshots is rebuilt. The migration
-- runner disables foreign keys around this file, which is what keeps the rebuild from
-- cascading the instances relationship away.
--
-- One thing to know about the new resource: unlike every other snapshot, its payload is a
-- PROJECTION rather than the verbatim body. `/importlist/movie` carries poster URLs with no
-- parameter to strip them, and the rows are filtered to those already in the library before
-- storing - which bounds the payload by library size however large the list is. The
-- keep-raw rule exists so a PUT can round-trip via mergeForPut; nothing is ever written
-- back here, so the rule's reason does not apply.

CREATE TABLE resource_snapshots_v4 (
  instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  resource    TEXT    NOT NULL CHECK (resource IN (
                'tag','tagDetail','rootFolder','importList','qualityProfile','media',
                'importListMovie')),
  payload     TEXT    NOT NULL,   -- verbatim JSON array, except importListMovie (see above)
  fetched_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (instance_id, resource)
) WITHOUT ROWID;

INSERT INTO resource_snapshots_v4 (instance_id, resource, payload, fetched_at)
SELECT instance_id, resource, payload, fetched_at FROM resource_snapshots;

DROP TABLE resource_snapshots;
ALTER TABLE resource_snapshots_v4 RENAME TO resource_snapshots;
