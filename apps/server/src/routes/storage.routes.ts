import {
  FS_OPS,
  queuePayloadSchemas,
  type FsListResponse,
  type FsMeasurement,
  type FsOp,
  type FsPreflight,
  type FsRootsResponse,
  type ReconcileReport,
} from '@arrranger/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const pathQuery = z.object({ path: z.string().min(1) });

const measureQuery = pathQuery.extend({
  maxEntries: z.coerce.number().int().min(100).max(1_000_000).optional(),
});

const refreshQuery = z.object({
  refresh: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

const preflightBody = z.object({
  op: z.enum(FS_OPS),
  payload: z.unknown(),
});

/**
 * Storage inspection. Staging goes through POST /api/queue like everything else - there is
 * deliberately no endpoint here that mutates the disk.
 */
export const storageRoutes: FastifyPluginAsync = async (app) => {
  app.get('/storage/roots', async (): Promise<FsRootsResponse> => app.ctx.filesystem.roots());

  app.get('/storage/list', async (request): Promise<FsListResponse> => {
    const { path } = pathQuery.parse(request.query);
    return app.ctx.filesystem.list(path);
  });

  /** Recursive size: opt-in, cancellable, and capped - it can take minutes on an array. */
  app.get('/storage/measure', async (request): Promise<FsMeasurement> => {
    const query = measureQuery.parse(request.query);
    const controller = new AbortController();
    request.raw.on('close', () => controller.abort());

    return app.ctx.filesystem.measure(query.path, {
      signal: controller.signal,
      ...(query.maxEntries === undefined ? {} : { maxEntries: query.maxEntries }),
    });
  });

  /** What would happen if this ran. The executor re-runs it before touching anything. */
  app.post('/storage/preflight', async (request): Promise<FsPreflight> => {
    const body = preflightBody.parse(request.body);
    const op: FsOp = body.op;
    const payload = queuePayloadSchemas[op].parse(body.payload);
    return app.ctx.filesystem.preflight(op, payload);
  });

  app.get('/storage/reconcile', async (request): Promise<ReconcileReport> => {
    const { refresh } = refreshQuery.parse(request.query);
    return app.ctx.reconcile.report({ refresh });
  });
};
