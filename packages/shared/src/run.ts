import type { QueueItem } from './queue.js';

export const QUEUE_RUN_STATUSES = [
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;
export type QueueRunStatus = (typeof QUEUE_RUN_STATUSES)[number];

export const ON_ERROR_POLICIES = ['pause', 'continue', 'abort'] as const;
export type OnErrorPolicy = (typeof ON_ERROR_POLICIES)[number];

/** One "Apply All" execution over the staged queue. */
export interface QueueRun {
  readonly id: number;
  readonly status: QueueRunStatus;
  readonly onError: OnErrorPolicy;
  readonly totalItems: number;
  readonly succeededItems: number;
  readonly failedItems: number;
  readonly skippedItems: number;
  readonly currentItemId: number | null;
  readonly error: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
}

export interface QueueEvent {
  readonly id: number;
  readonly runId: number | null;
  readonly itemId: number | null;
  readonly at: string;
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly httpMethod: string | null;
  readonly httpUrl: string | null;
  readonly httpStatus: number | null;
}

/** SSE frames on GET /api/queue/runs/:id/stream - drives the progress bar. */
export type RunEvent =
  | { type: 'run.started'; run: QueueRun }
  | { type: 'item.started'; runId: number; item: QueueItem }
  | { type: 'item.finished'; runId: number; item: QueueItem; run: QueueRun }
  | { type: 'run.paused'; run: QueueRun; failedItemId: number }
  | { type: 'run.finished'; run: QueueRun }
  | { type: 'log'; runId: number; level: 'info' | 'warn' | 'error'; message: string };

export function runProgress(run: QueueRun): number {
  if (run.totalItems === 0) return 0;
  const done = run.succeededItems + run.failedItems + run.skippedItems;
  return Math.min(100, Math.round((done / run.totalItems) * 100));
}

export function isRunActive(run: QueueRun): boolean {
  return run.status === 'running' || run.status === 'paused';
}
