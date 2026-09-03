import {
  FS_OPS,
  PATH_SELECTORS,
  queuePayloadSchemas,
  type FsMeasurement,
  type FsOp,
  type FsPreflight,
  type FsRootsResponse,
  type PathMatrixResponse,
} from '@arrranger/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const pathQuery = z.object({ path: z.string().min(1) });

const measureQuery = pathQuery.extend({
  maxEntries: z.coerce.number().int().min(100).max(1_000_000).optional(),
});

/** Repeatable `path`: refetching every expanded level is one request, not one per level. */
const matrixQuery = z.object({
  path: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value])),
  only: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value.split(',')))
    .pipe(z.array(z.enum(PATH_SELECTORS)).nonempty().optional()),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['name', 'interesting', 'modified']).optional(),
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

  /**
   * The joined view: disk truth and *Arr truth, one directory level at a time.
   *
   * Omit `path` for the spine - every mount and the chain down to each root folder.
   */
  app.get('/storage/matrix', async (request): Promise<PathMatrixResponse> => {
    const query = matrixQuery.parse(request.query);

    return app.ctx.pathMatrix.matrix({
      paths: query.path,
      ...(query.only === undefined ? {} : { only: query.only }),
      ...(query.q === undefined ? {} : { filter: query.q }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.offset === undefined ? {} : { offset: query.offset }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      refresh: query.refresh,
    });
  });
};
