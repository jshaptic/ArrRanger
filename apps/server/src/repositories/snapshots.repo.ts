import type { SqliteDatabase } from '../db/client.js';
import { nowIso } from '../db/mappers.js';
import type { ResourceSnapshotRow } from '../db/rows.js';

export type SnapshotResource =
  | 'tag'
  | 'tagDetail'
  | 'rootFolder'
  | 'importList'
  | 'qualityProfile'
  | 'media';

export interface Snapshot<T> {
  readonly payload: T;
  readonly fetchedAt: string;
}

/**
 * Cache of raw *Arr responses. The grid renders from here so browsing does not hammer
 * the instance, and the UI can show how stale the view is before bulk edits are staged.
 */
export class SnapshotsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get<T>(instanceId: number, resource: SnapshotResource): Snapshot<T> | null {
    const row = this.db
      .prepare('SELECT * FROM resource_snapshots WHERE instance_id = ? AND resource = ?')
      .get(instanceId, resource) as ResourceSnapshotRow | undefined;
    if (row === undefined) return null;
    return { payload: JSON.parse(row.payload) as T, fetchedAt: row.fetched_at };
  }

  put<T>(instanceId: number, resource: SnapshotResource, payload: T): Snapshot<T> {
    const fetchedAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO resource_snapshots (instance_id, resource, payload, fetched_at)
         VALUES (@instanceId, @resource, @payload, @fetchedAt)
         ON CONFLICT (instance_id, resource)
         DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
      )
      .run({ instanceId, resource, payload: JSON.stringify(payload), fetchedAt });
    return { payload, fetchedAt };
  }

  /** Called after a run mutates an instance - the cached view is now wrong. */
  invalidate(instanceId: number, resources?: readonly SnapshotResource[]): void {
    if (resources === undefined) {
      this.db.prepare('DELETE FROM resource_snapshots WHERE instance_id = ?').run(instanceId);
      return;
    }
    if (resources.length === 0) return;
    const placeholders = resources.map(() => '?').join(', ');
    this.db
      .prepare(`DELETE FROM resource_snapshots WHERE instance_id = ? AND resource IN (${placeholders})`)
      .run(instanceId, ...resources);
  }
}
