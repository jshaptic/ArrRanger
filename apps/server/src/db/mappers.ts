import {
  queuePayloadSchemas,
  type InstanceKind,
  type Instance,
  type QueueEvent,
  type QueueItem,
  type QueueItemStatus,
  type QueueOp,
  type QueueRun,
  type QueueRunStatus,
  type OnErrorPolicy,
  type TargetKind,
} from '@arrranger/shared';
import type {
  InstanceRow,
  QueueEventRow,
  QueueItemRow,
  QueueRunRow,
  SqliteBool,
} from './rows.js';

export const toBool = (value: SqliteBool): boolean => value === 1;
export const fromBool = (value: boolean): SqliteBool => (value ? 1 : 0);

export function nowIso(): string {
  return new Date().toISOString();
}

/** The API-facing instance: no API key, ever. */
export function rowToInstance(row: InstanceRow): Instance {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as InstanceKind,
    baseUrl: row.base_url,
    verifySsl: toBool(row.verify_ssl),
    enabled: toBool(row.enabled),
    timeoutMs: row.timeout_ms,
    appVersion: row.app_version,
    lastConnectedAt: row.last_connected_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The payload is re-validated on the way out: a queue item can sit in SQLite across
 * an app upgrade, and a stale shape must fail loudly here rather than mid-run
 * against a live Radarr instance.
 */
export function rowToQueueItem(row: QueueItemRow): QueueItem {
  const op = row.op as QueueOp;
  const schema = queuePayloadSchemas[op];
  if (!schema) {
    throw new Error(`Queue item ${row.id} has unknown op "${row.op}"`);
  }
  const payload = schema.parse(JSON.parse(row.payload));

  const item = {
    id: row.id,
    instanceId: row.instance_id,
    kind: row.kind as QueueItem['kind'],
    runId: row.run_id,
    dependsOnId: row.depends_on_id,
    sortOrder: row.sort_order,
    op,
    payload,
    status: row.status as QueueItemStatus,
    targetKind: row.target_kind as TargetKind,
    targetId: row.target_id,
    targetLabel: row.target_label,
    summary: row.summary,
    affectedCount: row.affected_count,
    attempts: row.attempts,
    error: row.error_message
      ? {
          code: row.error_code ?? 'unknown',
          message: row.error_message,
          httpStatus: row.http_status,
        }
      : null,
    result: row.result === null ? null : (JSON.parse(row.result) as Record<string, unknown>),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };

  // Single cast at the persistence boundary: TS cannot correlate `op` with the
  // payload it just parsed through the schema map lookup above.
  return item as QueueItem;
}

export function rowToQueueRun(row: QueueRunRow): QueueRun {
  return {
    id: row.id,
    status: row.status as QueueRunStatus,
    onError: row.on_error as OnErrorPolicy,
    totalItems: row.total_items,
    succeededItems: row.succeeded_items,
    failedItems: row.failed_items,
    skippedItems: row.skipped_items,
    currentItemId: row.current_item_id,
    error: row.error,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export function rowToQueueEvent(row: QueueEventRow): QueueEvent {
  return {
    id: row.id,
    runId: row.run_id,
    itemId: row.item_id,
    at: row.at,
    level: row.level as QueueEvent['level'],
    message: row.message,
    httpMethod: row.http_method,
    httpUrl: row.http_url,
    httpStatus: row.http_status,
  };
}
