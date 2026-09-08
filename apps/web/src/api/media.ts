import type { MediaFleetResponse, MediaIdsResponse, MediaSort, MediaSortDirection, MediaUndecidedMode } from '@arrranger/shared';
import { api } from './client';

export interface MediaParams {
  /** The filter expression. Never sent when it cannot be parsed - see `stores/media.ts`. */
  readonly filter?: string;
  readonly undecided?: MediaUndecidedMode;
  readonly sort?: MediaSort;
  readonly direction?: MediaSortDirection;
  readonly page?: number;
  readonly pageSize?: number;
  readonly refresh?: boolean;
}

function mediaQuery(params: MediaParams): string {
  const query = new URLSearchParams();
  if (params.filter !== undefined && params.filter.length > 0) query.set('q', params.filter);
  if (params.undecided !== undefined) query.set('undecided', params.undecided);
  if (params.sort !== undefined) query.set('sort', params.sort);
  if (params.direction !== undefined) query.set('dir', params.direction);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  if (params.refresh === true) query.set('refresh', 'true');

  const serialised = query.toString();
  return serialised.length === 0 ? '' : `?${serialised}`;
}

export const mediaApi = {
  /** One page of titles, already grouped, judged and counted by the server. */
  list: (params: MediaParams = {}) =>
    api.get<MediaFleetResponse>(`/media${mediaQuery(params)}`),

  /**
   * The ids behind the whole filter, grouped per instance.
   *
   * What "apply to all N matching" has to use: deriving targets from the loaded page would
   * act on a page while reporting a filter.
   */
  ids: (params: MediaParams = {}) =>
    api.get<MediaIdsResponse>(`/media/ids${mediaQuery({ filter: params.filter })}`),
};
