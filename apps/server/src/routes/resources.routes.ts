import type { MediaPageResponse, ResourceSnapshotResponse } from '@arrranger/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const idParams = z.object({ id: z.coerce.number().int().positive() });

const refreshQuery = z.object({
  refresh: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

const mediaQuery = refreshQuery.extend({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
  search: z.string().trim().min(1).optional(),
  tagId: z.coerce.number().int().positive().optional(),
  rootFolderPath: z.string().trim().min(1).optional(),
});

export const resourceRoutes: FastifyPluginAsync = async (app) => {
  /** Tags, root folders and import lists for one instance, from the snapshot cache. */
  app.get('/instances/:id/resources', async (request): Promise<ResourceSnapshotResponse> => {
    const { id } = idParams.parse(request.params);
    const { refresh } = refreshQuery.parse(request.query);
    return app.ctx.resources.getResources(id, refresh);
  });

  /** Paged media list - v3 returns the whole library, so paging happens here. */
  app.get('/instances/:id/media', async (request): Promise<MediaPageResponse> => {
    const { id } = idParams.parse(request.params);
    const query = mediaQuery.parse(request.query);
    return app.ctx.resources.getMedia(id, query);
  });

  /** Drops the cached view so the next read hits the instance. */
  app.post('/instances/:id/refresh', async (request, reply): Promise<void> => {
    const { id } = idParams.parse(request.params);
    app.ctx.instances.require(id);
    app.ctx.resources.invalidate(id);
    reply.code(204);
  });
};
