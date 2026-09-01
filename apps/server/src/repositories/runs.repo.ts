import type { OnErrorPolicy, QueueEvent, QueueRun, QueueRunStatus } from '@arrranger/shared';
import type { SqliteDatabase } from '../db/client.js';
import { nowIso, rowToQueueEvent, rowToQueueRun } from '../db/mappers.js';
import type { QueueEventRow, QueueRunRow } from '../db/rows.js';
import { NotFoundError } from '../lib/errors.js';

export interface CreateRunInput {
  readonly onError: OnErrorPolicy;
  readonly totalItems: number;
}

export interface RunCounters {
  readonly succeededItems?: number;
  readonly failedItems?: number;
  readonly skippedItems?: number;
}

export interface UpdateRunInput extends RunCounters {
  readonly status?: QueueRunStatus;
  readonly currentItemId?: number | null;
  readonly error?: string | null;
  readonly finished?: boolean;
}

export interface AppendEventInput {
  readonly runId: number | null;
  readonly itemId: number | null;
  readonly level: QueueEvent['level'];
  readonly message: string;
  readonly httpMethod?: string | null;
  readonly httpUrl?: string | null;
  readonly httpStatus?: number | null;
  readonly requestBody?: string | null;
  readonly responseBody?: string | null;
}

export class RunsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: CreateRunInput): QueueRun {
    const row = this.db
      .prepare(
        `INSERT INTO queue_runs (status, on_error, total_items)
         VALUES ('running', @onError, @totalItems)
         RETURNING *`,
      )
      .get({ onError: input.onError, totalItems: input.totalItems }) as QueueRunRow;
    return rowToQueueRun(row);
  }

  get(id: number): QueueRun | null {
    const row = this.db.prepare('SELECT * FROM queue_runs WHERE id = ?').get(id) as
      | QueueRunRow
      | undefined;
    return row === undefined ? null : rowToQueueRun(row);
  }

  require(id: number): QueueRun {
    const run = this.get(id);
    if (!run) throw new NotFoundError(`Run ${id}`);
    return run;
  }

  list(limit = 20): QueueRun[] {
    const rows = this.db
      .prepare('SELECT * FROM queue_runs ORDER BY id DESC LIMIT ?')
      .all(limit) as QueueRunRow[];
    return rows.map(rowToQueueRun);
  }

  /** At most one run may be running or paused at a time. */
  findActive(): QueueRun | null {
    const row = this.db
      .prepare("SELECT * FROM queue_runs WHERE status IN ('running','paused') ORDER BY id DESC LIMIT 1")
      .get() as QueueRunRow | undefined;
    return row === undefined ? null : rowToQueueRun(row);
  }

  update(id: number, patch: UpdateRunInput): QueueRun {
    const assignments: string[] = ['updated_at = @at'];
    const params: Record<string, string | number | null> = { id, at: nowIso() };

    if (patch.status !== undefined) {
      assignments.push('status = @status');
      params['status'] = patch.status;
    }
    if (patch.currentItemId !== undefined) {
      assignments.push('current_item_id = @currentItemId');
      params['currentItemId'] = patch.currentItemId;
    }
    if (patch.error !== undefined) {
      assignments.push('error = @error');
      params['error'] = patch.error;
    }
    if (patch.succeededItems !== undefined) {
      assignments.push('succeeded_items = @succeededItems');
      params['succeededItems'] = patch.succeededItems;
    }
    if (patch.failedItems !== undefined) {
      assignments.push('failed_items = @failedItems');
      params['failedItems'] = patch.failedItems;
    }
    if (patch.skippedItems !== undefined) {
      assignments.push('skipped_items = @skippedItems');
      params['skippedItems'] = patch.skippedItems;
    }
    if (patch.finished === true) {
      assignments.push('finished_at = @at');
    }

    const row = this.db
      .prepare(`UPDATE queue_runs SET ${assignments.join(', ')} WHERE id = @id RETURNING *`)
      .get(params) as QueueRunRow | undefined;
    if (row === undefined) throw new NotFoundError(`Run ${id}`);
    return rowToQueueRun(row);
  }

  /** Recomputes the counters from the item rows - the run row stays a cache of them. */
  syncCounters(runId: number): QueueRun {
    const row = this.db
      .prepare(
        `SELECT
            SUM(status = 'succeeded') AS succeeded,
            SUM(status = 'failed')    AS failed,
            SUM(status IN ('skipped','cancelled')) AS skipped
           FROM queue_items WHERE run_id = ?`,
      )
      .get(runId) as { succeeded: number | null; failed: number | null; skipped: number | null };

    return this.update(runId, {
      succeededItems: row.succeeded ?? 0,
      failedItems: row.failed ?? 0,
      skippedItems: row.skipped ?? 0,
    });
  }

  appendEvent(input: AppendEventInput): QueueEvent {
    const row = this.db
      .prepare(
        `INSERT INTO queue_events (
           run_id, item_id, level, message, http_method, http_url, http_status,
           request_body, response_body
         ) VALUES (
           @runId, @itemId, @level, @message, @httpMethod, @httpUrl, @httpStatus,
           @requestBody, @responseBody
         ) RETURNING *`,
      )
      .get({
        runId: input.runId,
        itemId: input.itemId,
        level: input.level,
        message: input.message,
        httpMethod: input.httpMethod ?? null,
        httpUrl: input.httpUrl ?? null,
        httpStatus: input.httpStatus ?? null,
        requestBody: input.requestBody ?? null,
        responseBody: input.responseBody ?? null,
      }) as QueueEventRow;
    return rowToQueueEvent(row);
  }

  listEvents(runId: number, options: { sinceId?: number; limit?: number } = {}): QueueEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM queue_events
          WHERE run_id = @runId AND id > @sinceId
          ORDER BY id LIMIT @limit`,
      )
      .all({ runId, sinceId: options.sinceId ?? 0, limit: options.limit ?? 500 }) as QueueEventRow[];
    return rows.map(rowToQueueEvent);
  }

  /** Full audit detail for one item, including request/response bodies. */
  listItemEvents(itemId: number): Array<QueueEvent & { requestBody: string | null; responseBody: string | null }> {
    const rows = this.db
      .prepare('SELECT * FROM queue_events WHERE item_id = ? ORDER BY id')
      .all(itemId) as QueueEventRow[];
    return rows.map((row) => ({
      ...rowToQueueEvent(row),
      requestBody: row.request_body,
      responseBody: row.response_body,
    }));
  }
}
