import type {
  ClearQueueResponse,
  NewQueueItem,
  QueueItem,
  QueueItemDetailResponse,
  QueueListResponse,
  RunEvent,
  RunEventsResponse,
  RunListResponse,
  RunResponse,
} from '@arrranger/shared';
import { api } from './client';

/** Every frame type the run stream can emit - EventSource needs them by name. */
const RUN_EVENT_TYPES = [
  'run.started',
  'item.started',
  'item.finished',
  'log',
  'run.paused',
  'run.finished',
] as const satisfies ReadonlyArray<RunEvent['type']>;

export interface RunStreamHandlers {
  onEvent: (event: RunEvent) => void;
  onError?: (error: Event) => void;
}

export const queueApi = {
  list: () => api.get<QueueListResponse>('/queue'),
  push: (items: readonly NewQueueItem[]) => api.post<{ items: QueueItem[] }>('/queue', { items }),
  detail: (itemId: number) => api.get<QueueItemDetailResponse>(`/queue/${itemId}`),
  reorder: (itemIds: readonly number[]) =>
    api.patch<{ items: QueueItem[] }>('/queue/reorder', { itemIds }),
  retry: (itemId: number) => api.post<{ item: QueueItem }>(`/queue/${itemId}/retry`),
  remove: (itemId: number) => api.delete<void>(`/queue/${itemId}`),
  clear: () => api.delete<ClearQueueResponse>('/queue'),

  runs: () => api.get<RunListResponse>('/queue/runs'),
  run: (runId: number) => api.get<RunResponse>(`/queue/runs/${runId}`),
  start: (body: { onError?: 'pause' | 'continue' | 'abort'; itemIds?: readonly number[] }) =>
    api.post<RunResponse>('/queue/runs', body),
  resume: (runId: number, body: { retryFailed?: boolean; skipFailed?: boolean }) =>
    api.post<RunResponse>(`/queue/runs/${runId}/resume`, body),
  cancel: (runId: number) => api.post<RunResponse>(`/queue/runs/${runId}/cancel`),
  events: (runId: number, sinceId = 0) =>
    api.get<RunEventsResponse>(`/queue/runs/${runId}/events?sinceId=${sinceId}`),

  /**
   * Subscribes to run progress. EventSource reconnects on its own and replays through
   * Last-Event-ID, which the server honours - so a dropped connection self-heals.
   */
  openStream(runId: number, handlers: RunStreamHandlers): () => void {
    const source = new EventSource(`/api/queue/runs/${runId}/stream`);

    for (const type of RUN_EVENT_TYPES) {
      source.addEventListener(type, (event) => {
        const message = event as MessageEvent<string>;
        handlers.onEvent(JSON.parse(message.data) as RunEvent);
      });
    }

    if (handlers.onError) source.onerror = handlers.onError;

    return () => source.close();
  },
};
