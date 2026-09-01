import type { MediaPageResponse, ResourceSnapshotResponse } from '@arrranger/shared';
import { api } from './client';

export interface MediaQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  tagId?: number;
  rootFolderPath?: string;
  refresh?: boolean;
}

function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

export const resourcesApi = {
  snapshot: (instanceId: number, refresh = false) =>
    api.get<ResourceSnapshotResponse>(
      `/instances/${instanceId}/resources${refresh ? '?refresh=true' : ''}`,
    ),

  media: (instanceId: number, params: MediaQueryParams = {}) =>
    api.get<MediaPageResponse>(`/instances/${instanceId}/media${toQuery({ ...params })}`),

  /**
   * Every media id in a root folder. v3 has no server-side paging, so the API pages the
   * cached library - walk it to the end before staging a move.
   */
  async allMediaIdsInRootFolder(instanceId: number, rootFolderPath: string): Promise<number[]> {
    const pageSize = 500;
    const ids: number[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await resourcesApi.media(instanceId, { rootFolderPath, page, pageSize });
      ids.push(...response.items.map((item) => item.id));
      totalPages = response.totalPages;
      page += 1;
    } while (page <= totalPages);

    return ids;
  },

  refresh: (instanceId: number) => api.post<void>(`/instances/${instanceId}/refresh`),
};
