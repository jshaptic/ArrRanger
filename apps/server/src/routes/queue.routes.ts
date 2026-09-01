import {
  isFsOp,
  parseNewQueueItem,
  QUEUE_ITEM_STATUSES,
  ON_ERROR_POLICIES,
  type ClearQueueResponse,
  type QueueItem,
  type QueueItemDetailResponse,
  type QueueListResponse,
  type RunEvent,
  type RunEventsResponse,
  type RunListResponse,
  type RunResponse,
} from '@arrranger/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SequencedRunEvent } from '../queue/events.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  status: z.enum(QUEUE_ITEM_STATUSES).optional(),
  instanceId: z.coerce.number().int().positive().optional(),
});

const reorderBody = z.object({ itemIds: z.array(z.number().int().positive()).min(1) });

const startRunBody = z
  .object({
    onError: z.enum(ON_ERROR_POLICIES).optional(),
    itemIds: z.array(z.number().int().positive()).min(1).optional(),
  })
  .default({});

const resumeBody = z
  .object({ retryFailed: z.boolean().optional(), skipFailed: z.boolean().optional() })
  .default({});

const clearQuery = z.object({
  statuses: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
    )
    .pipe(z.array(z.enum(QUEUE_ITEM_STATUSES)).optional()),
});

const eventsQuery = z.object({
  sinceId: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

const streamQuery = z.object({ lastEventId: z.coerce.number().int().min(0).optional() });

/** Accepts a single item, an array, or { items: [...] }. */
function readItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body !== null && typeof body === 'object' && 'items' in body) {
    const items = (body as { items: unknown }).items;
    return Array.isArray(items) ? items : [items];
  }
  return [body];
}

export const queueRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;

  // ------------------------------------------------------------------ staging

  app.get('/queue', async (request): Promise<QueueListResponse> => {
    const filter = listQuery.parse(request.query);
    return {
      items: ctx.queue.list(filter),
      activeRun: ctx.runs.findActive(),
    };
  });

  app.post('/queue', async (request, reply): Promise<{ items: QueueItem[] }> => {
    const items = readItems(request.body).map(parseNewQueueItem);

    // Resolve filesystem paths against the allowed roots now, while the user is watching -
    // a traversal or a path outside the roots should never survive into the queue.
    for (const item of items) {
      if (!isFsOp(item.op)) continue;
      const payload = item.payload as Record<string, unknown>;
      for (const key of ['path', 'from', 'to']) {
        const value = payload[key];
        if (typeof value === 'string') await ctx.filesystem.guard.resolve(value);
      }
    }

    const created = ctx.queue.push(items, (instanceId) => ctx.instancesRepo.require(instanceId).kind);
    reply.code(201);
    return { items: created };
  });

  app.get('/queue/:id', async (request): Promise<QueueItemDetailResponse> => {
    const { id } = idParams.parse(request.params);
    return { item: ctx.queue.require(id), events: ctx.runs.listItemEvents(id) };
  });

  app.patch('/queue/reorder', async (request): Promise<{ items: QueueItem[] }> => {
    const { itemIds } = reorderBody.parse(request.body);
    return { items: ctx.queue.reorder(itemIds) };
  });

  app.post('/queue/:id/retry', async (request): Promise<{ item: QueueItem }> => {
    const { id } = idParams.parse(request.params);
    return { item: ctx.queue.resetToPending(id) };
  });

  app.delete('/queue/:id', async (request, reply): Promise<void> => {
    const { id } = idParams.parse(request.params);
    ctx.queue.remove(id);
    reply.code(204);
  });

  app.delete('/queue', async (request): Promise<ClearQueueResponse> => {
    const { statuses } = clearQuery.parse(request.query);
    const target = statuses ?? (['succeeded', 'failed', 'skipped', 'cancelled'] as const);
    return { removed: ctx.queue.clear(target), statuses: [...target] };
  });

  // ------------------------------------------------------------------- running

  app.get('/queue/runs', async (): Promise<RunListResponse> => ({ runs: ctx.runs.list() }));

  app.post('/queue/runs', async (request, reply): Promise<RunResponse> => {
    const options = startRunBody.parse(request.body ?? {});
    const snapshot = ctx.executor.start(options);
    reply.code(202);
    return { run: snapshot.run, items: snapshot.items };
  });

  app.get('/queue/runs/:id', async (request): Promise<RunResponse> => {
    const { id } = idParams.parse(request.params);
    return { run: ctx.runs.require(id), items: ctx.queue.list({ runId: id }) };
  });

  /** Polling alternative to the SSE stream. */
  app.get('/queue/runs/:id/events', async (request): Promise<RunEventsResponse> => {
    const { id } = idParams.parse(request.params);
    const query = eventsQuery.parse(request.query);
    ctx.runs.require(id);
    return { events: ctx.runs.listEvents(id, query) };
  });

  app.post('/queue/runs/:id/resume', async (request, reply): Promise<RunResponse> => {
    const { id } = idParams.parse(request.params);
    const options = resumeBody.parse(request.body ?? {});
    const snapshot = ctx.executor.resume(id, options);
    reply.code(202);
    return { run: snapshot.run, items: snapshot.items };
  });

  app.post('/queue/runs/:id/cancel', async (request): Promise<RunResponse> => {
    const { id } = idParams.parse(request.params);
    const run = await ctx.executor.cancel(id);
    return { run, items: ctx.queue.list({ runId: id }) };
  });

  // ----------------------------------------------------------------------- SSE

  app.get('/queue/runs/:id/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParams.parse(request.params);
    const { lastEventId } = streamQuery.parse(request.query);
    const run = ctx.runs.require(id);

    // Take the socket over: everything below writes the event stream by hand.
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Stops nginx from buffering the stream into uselessness.
      'x-accel-buffering': 'no',
    });

    const write = (entry: SequencedRunEvent): void => {
      raw.write(`id: ${entry.id}\nevent: ${entry.event.type}\ndata: ${JSON.stringify(entry.event)}\n\n`);
    };

    const headerId = Number(request.headers['last-event-id'] ?? Number.NaN);
    const resumeFrom = Number.isFinite(headerId) ? headerId : (lastEventId ?? 0);

    const buffered = ctx.events.replay(id, resumeFrom);
    for (const entry of buffered) write(entry);

    // Nothing buffered (the run predates this process, or finished a while ago):
    // send its current state so the client is never staring at an empty stream.
    if (buffered.length === 0) {
      const synthetic: RunEvent =
        run.status === 'running'
          ? { type: 'run.started', run }
          : run.status === 'paused'
            ? { type: 'run.paused', run, failedItemId: run.currentItemId ?? 0 }
            : { type: 'run.finished', run };
      write({ id: 0, runId: id, event: synthetic });
    }

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      raw.end();
    };

    const unsubscribe = ctx.events.subscribe(id, (entry) => {
      write(entry);
      // The run is over - let the client's EventSource see a clean end.
      if (entry.event.type === 'run.finished') setTimeout(close, 50);
    });

    // Proxies drop idle connections; a comment line keeps them honest.
    const heartbeat = setInterval(() => raw.write(': keep-alive\n\n'), 15_000);

    request.raw.on('close', close);
    request.raw.on('error', close);
  });
};
