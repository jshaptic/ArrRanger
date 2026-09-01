import {
  arrImportListSchema,
  arrMediaSchema,
  arrRootFolderSchema,
  arrTagDetailSchema,
  type ArrImportList,
  type ArrJson,
  type ArrMedia,
  type ArrRootFolder,
  type ArrTagDetail,
  type InstanceWithKey,
  type MediaPageResponse,
  type ResourceSnapshotResponse,
} from '@arrranger/shared';
import { ArrClient, pageMedia, type MediaQuery } from '../arr/client.js';
import type { ArrDispatcherPool } from '../arr/http.js';
import type { InstancesRepository } from '../repositories/instances.repo.js';
import type { SnapshotResource, SnapshotsRepository } from '../repositories/snapshots.repo.js';

export interface ResourcesServiceDeps {
  readonly instances: InstancesRepository;
  readonly snapshots: SnapshotsRepository;
  readonly dispatchers: ArrDispatcherPool;
}

interface CachedFetch<T> {
  readonly payload: readonly T[];
  readonly fetchedAt: string;
}

/**
 * Reads *Arr resources through the snapshot cache.
 *
 * Browsing a 5000-movie library should not re-hit the instance on every keystroke, and
 * the UI needs to know how old the view is before bulk edits are staged against it.
 */
export class ResourcesService {
  constructor(private readonly deps: ResourcesServiceDeps) {}

  private client(instance: InstanceWithKey): ArrClient {
    return new ArrClient(instance, { dispatcher: this.deps.dispatchers.get(instance) });
  }

  private async cached<T>(
    instance: InstanceWithKey,
    resource: SnapshotResource,
    refresh: boolean,
    fetch: (client: ArrClient) => Promise<readonly ArrJson[]>,
    parse: (raw: ArrJson) => T,
  ): Promise<CachedFetch<T>> {
    if (!refresh) {
      const snapshot = this.deps.snapshots.get<ArrJson[]>(instance.id, resource);
      if (snapshot !== null) {
        return { payload: snapshot.payload.map(parse), fetchedAt: snapshot.fetchedAt };
      }
    }

    const raw = await fetch(this.client(instance));
    const stored = this.deps.snapshots.put(instance.id, resource, raw);
    return { payload: raw.map(parse), fetchedAt: stored.fetchedAt };
  }

  /** Tags, root folders and import lists in one round trip - what the editor grids need. */
  async getResources(instanceId: number, refresh = false): Promise<ResourceSnapshotResponse> {
    const instance = this.deps.instances.requireWithKey(instanceId);

    const [tags, rootFolders, importLists] = await Promise.all([
      this.cached<ArrTagDetail>(
        instance,
        'tagDetail',
        refresh,
        async (client) => (await client.listTagDetails()).map((entry) => entry.raw),
        (raw) => arrTagDetailSchema.parse(raw),
      ),
      this.cached<ArrRootFolder>(
        instance,
        'rootFolder',
        refresh,
        async (client) => (await client.listRootFolders()).map((entry) => entry.raw),
        (raw) => arrRootFolderSchema.parse(raw),
      ),
      this.cached<ArrImportList>(
        instance,
        'importList',
        refresh,
        async (client) => (await client.listImportLists()).map((entry) => entry.raw),
        (raw) => arrImportListSchema.parse(raw),
      ),
    ]);

    // The oldest of the three is the honest "as of" for the whole view.
    const fetchedAt =
      [tags.fetchedAt, rootFolders.fetchedAt, importLists.fetchedAt].sort().at(0) ?? tags.fetchedAt;

    return {
      instanceId,
      fetchedAt,
      tags: tags.payload,
      rootFolders: rootFolders.payload,
      importLists: importLists.payload,
    };
  }

  /** v3 has no server-side paging for movie/series, so page the cached library. */
  async getMedia(
    instanceId: number,
    query: MediaQuery & { refresh?: boolean },
  ): Promise<MediaPageResponse> {
    const instance = this.deps.instances.requireWithKey(instanceId);

    const media = await this.cached<ArrMedia>(
      instance,
      'media',
      query.refresh === true,
      async (client) => (await client.listMedia()).map((entry) => entry.raw),
      (raw) => arrMediaSchema.parse(raw),
    );

    const page = pageMedia(media.payload, query);
    return {
      instanceId,
      fetchedAt: media.fetchedAt,
      items: page.items,
      page: page.page,
      pageSize: page.pageSize,
      totalItems: page.totalItems,
      totalPages: page.totalPages,
    };
  }

  /**
   * The whole cached library, unpaged. The reconcile service needs every path at once to
   * decide what on disk is orphaned - paging that would be pointless work.
   */
  async mediaLibrary(
    instanceId: number,
    refresh = false,
  ): Promise<{ items: readonly ArrMedia[]; fetchedAt: string }> {
    const instance = this.deps.instances.requireWithKey(instanceId);
    const media = await this.cached<ArrMedia>(
      instance,
      'media',
      refresh,
      async (client) => (await client.listMedia()).map((entry) => entry.raw),
      (raw) => arrMediaSchema.parse(raw),
    );
    return { items: media.payload, fetchedAt: media.fetchedAt };
  }

  /** Cached root folders only - no request when a snapshot exists. */
  async rootFolders(instanceId: number, refresh = false): Promise<readonly ArrRootFolder[]> {
    const instance = this.deps.instances.requireWithKey(instanceId);
    const folders = await this.cached<ArrRootFolder>(
      instance,
      'rootFolder',
      refresh,
      async (client) => (await client.listRootFolders()).map((entry) => entry.raw),
      (raw) => arrRootFolderSchema.parse(raw),
    );
    return folders.payload;
  }

  invalidate(instanceId: number): void {
    this.deps.snapshots.invalidate(instanceId);
  }
}
