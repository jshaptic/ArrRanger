import {
  MEDIA_SORTS,
  MEDIA_SORT_DIRECTIONS,
  MEDIA_UNDECIDED_MODES,
  parseMediaFilter,
  type MediaFleetResponse,
  type MediaIdsResponse,
} from '@arrranger/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { MAX_MEDIA_PAGE_SIZE } from '../services/media-fleet.service.js';

/**
 * There is deliberately no `instance=` and no `kind=` parameter.
 *
 * `instance:radarr-4k` and `kind:movie` are already expressions, and a second filtering
 * mechanism is a second source of truth - which is the thing the server-side-filter rule
 * exists to prevent. It also means a matching row always keeps every one of its copies, so
 * nothing has to be re-projected and the chip strip never lies about who holds the title.
 */
const mediaQuery = z.object({
  /**
   * The filter expression, rejected here rather than silently ignored - a filter nobody
   * can read is a filter nobody can debug. `superRefine` rather than `refine` so the
   * parser's own message ("unclosed “(” at position 4") reaches the caller instead of a
   * generic one.
   */
  q: z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      const parsed = parseMediaFilter(value);
      if (parsed.error !== null) ctx.addIssue({ code: 'custom', message: parsed.error });
    }),
  /** `hide` counts the rows the filter could not judge; `show` lists them instead. */
  undecided: z.enum(MEDIA_UNDECIDED_MODES).optional(),
  sort: z.enum(MEDIA_SORTS).optional(),
  dir: z.enum(MEDIA_SORT_DIRECTIONS).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_MEDIA_PAGE_SIZE).optional(),
  refresh: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  /** Every title across the fleet: one row per title, one chip per instance that holds it. */
  app.get('/media', async (request): Promise<MediaFleetResponse> => {
    const query = mediaQuery.parse(request.query);
    return app.ctx.mediaFleet.query({
      ...(query.q === undefined ? {} : { filter: query.q }),
      ...(query.undecided === undefined ? {} : { undecided: query.undecided }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(query.dir === undefined ? {} : { direction: query.dir }),
      ...(query.page === undefined ? {} : { page: query.page }),
      ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
      refresh: query.refresh,
    });
  });

  /**
   * The ids behind a query, grouped per instance.
   *
   * "Apply to all 1 240 matched" needs the whole set, and it must come from the filter -
   * never from whichever page the browser is holding, or a bulk operation would act on a
   * page and report a filter.
   */
  app.get('/media/ids', async (request): Promise<MediaIdsResponse> => {
    const query = mediaQuery.parse(request.query);
    return app.ctx.mediaFleet.ids({
      ...(query.q === undefined ? {} : { filter: query.q }),
      refresh: query.refresh,
    });
  });
};
