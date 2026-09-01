/**
 * Row interfaces mirror the SQL exactly: snake_case names, SQLite scalar types
 * only (no booleans, no dates, no objects). Conversion to domain types happens in
 * one place - `db/mappers.ts` - so nothing else in the server sees a `0 | 1`.
 */

export type SqliteBool = 0 | 1;

export interface InstanceRow {
  id: number;
  name: string;
  kind: string;
  base_url: string;
  api_key_enc: string;
  verify_ssl: SqliteBool;
  enabled: SqliteBool;
  timeout_ms: number;
  app_version: string | null;
  last_connected_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueueItemRow {
  id: number;
  /** NULL for filesystem work. */
  instance_id: number | null;
  kind: string;
  run_id: number | null;
  depends_on_id: number | null;
  sort_order: number;
  op: string;
  status: string;
  target_kind: string;
  target_id: number | null;
  target_label: string;
  summary: string;
  payload: string;
  affected_count: number;
  attempts: number;
  error_code: string | null;
  error_message: string | null;
  http_status: number | null;
  result: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface QueueRunRow {
  id: number;
  status: string;
  on_error: string;
  total_items: number;
  succeeded_items: number;
  failed_items: number;
  skipped_items: number;
  current_item_id: number | null;
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface QueueEventRow {
  id: number;
  run_id: number | null;
  item_id: number | null;
  at: string;
  level: string;
  message: string;
  http_method: string | null;
  http_url: string | null;
  http_status: number | null;
  request_body: string | null;
  response_body: string | null;
}

export interface ResourceSnapshotRow {
  instance_id: number;
  resource: string;
  payload: string;
  fetched_at: string;
}
