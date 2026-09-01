import {
  mergeForPut,
  type ArrJson,
  type ArrOp,
  type ArrTagDetail,
  type FsOp,
  type ImportListChanges,
  type InstanceWithKey,
  type QueueItemOf,
} from '@arrranger/shared';
import type { ArrClient } from '../arr/client.js';
import type { FilesystemService } from '../fs/filesystem.service.js';
import { ValidationError } from '../lib/errors.js';

/**
 * Handlers for every staged operation.
 *
 * The four action types named in the Phase 2 brief map onto this contract as:
 *   RENAME_TAG         -> tag.rename
 *   DELETE_TAG         -> tag.delete
 *   REASSIGN_TAG       -> mediaTags.add / mediaTags.remove / tag.merge
 *   CHANGE_ROOT_FOLDER -> media.moveRootFolder (plus rootFolder.create/delete)
 *
 * Everything goes through PUT /{movie|series}/editor for bulk media writes, which is
 * the only endpoint that applies a change to many items in one call.
 */

export type LogLevel = 'info' | 'warn' | 'error';

/** What every handler gets, whichever side of the fence it works on. */
export interface HandlerContext {
  readonly log: (level: LogLevel, message: string) => void;
  /** Result JSON of the item this one depends on - e.g. the id of a just-created tag. */
  readonly dependencyResult: Record<string, unknown> | null;
  readonly signal: AbortSignal;
}

/** *Arr operations additionally get a client bound to their instance. */
export interface ArrHandlerContext extends HandlerContext {
  readonly client: ArrClient;
  readonly instance: InstanceWithKey;
}

/** Filesystem operations get the storage engine and no instance at all. */
export interface FsHandlerContext extends HandlerContext {
  readonly fs: FilesystemService;
}

export type QueueHandlerResult = Record<string, unknown> | void;

export type ArrQueueHandler<K extends ArrOp> = (
  ctx: ArrHandlerContext,
  item: QueueItemOf<K>,
) => Promise<QueueHandlerResult>;

export type FsQueueHandler<K extends FsOp> = (
  ctx: FsHandlerContext,
  item: QueueItemOf<K>,
) => Promise<QueueHandlerResult>;

export type ArrQueueHandlers = { [K in ArrOp]: ArrQueueHandler<K> };
export type FsQueueHandlers = { [K in FsOp]: FsQueueHandler<K> };

/** Radarr reports attached media as movieIds, Sonarr as seriesIds. */
function attachedMediaIds(detail: ArrTagDetail): number[] {
  return detail.movieIds ?? detail.seriesIds ?? [];
}

/**
 * A dependency (`dependsOnId`) can supply an id the payload could not know at staging
 * time - "create tag X, then assign it to 40 movies" is two calls.
 */
function resolveTagId(payloadTagId: number, dependencyResult: Record<string, unknown> | null): number {
  const fromDependency = dependencyResult?.['tagId'];
  return typeof fromDependency === 'number' ? fromDependency : payloadTagId;
}

/** Folds the id produced by a `tag.create` dependency into the item's tag list. */
function resolveTagIds(
  payloadTagIds: readonly number[],
  dependencyResult: Record<string, unknown> | null,
): number[] {
  const fromDependency = dependencyResult?.['tagId'];
  const tagIds =
    typeof fromDependency === 'number'
      ? [...new Set([...payloadTagIds, fromDependency])]
      : [...payloadTagIds];

  if (tagIds.length === 0) {
    throw new ValidationError(
      'No tag to apply - the item it depends on did not produce a tag id',
    );
  }
  return tagIds;
}

const CORE_IMPORT_LIST_KEYS: ReadonlySet<keyof ImportListChanges> = new Set([
  'name',
  'rootFolderPath',
  'qualityProfileId',
  'tags',
  'monitor',
]);

export const arrHandlers: ArrQueueHandlers = {
  'tag.create': async (ctx, item) => {
    const tag = await ctx.client.createTag(item.payload.label);
    ctx.log('info', `Created tag "${tag.label}" (#${tag.id})`);
    return { tagId: tag.id, label: tag.label };
  },

  'tag.rename': async (ctx, item) => {
    const tagId = resolveTagId(item.payload.tagId, ctx.dependencyResult);
    const tag = await ctx.client.renameTag(tagId, item.payload.to);
    ctx.log('info', `Renamed tag #${tagId} from "${item.payload.from}" to "${tag.label}"`);
    return { tagId, label: tag.label };
  },

  'tag.delete': async (ctx, item) => {
    const tagId = resolveTagId(item.payload.tagId, ctx.dependencyResult);
    let detached = 0;

    if (item.payload.detachFromMedia) {
      // *Arr detaches the tag implicitly on delete; doing it explicitly first means the
      // audit trail records exactly how many items were touched.
      const detail = await ctx.client.getTagDetail(tagId);
      const mediaIds = attachedMediaIds(detail.view);
      if (mediaIds.length > 0) {
        detached = await ctx.client.bulkEditMedia({ mediaIds, tags: [tagId], applyTags: 'remove' });
        ctx.log('info', `Removed tag #${tagId} from ${detached} item(s)`);
      }
    }

    await ctx.client.deleteTag(tagId);
    ctx.log('info', `Deleted tag "${item.payload.label}" (#${tagId})`);
    return { tagId, detached };
  },

  'tag.merge': async (ctx, item) => {
    const { sourceTagIds, targetTagId, deleteSources } = item.payload;
    let moved = 0;

    for (const sourceTagId of sourceTagIds) {
      if (sourceTagId === targetTagId) continue;

      const detail = await ctx.client.getTagDetail(sourceTagId);
      const mediaIds = attachedMediaIds(detail.view);

      if (mediaIds.length > 0) {
        await ctx.client.bulkEditMedia({ mediaIds, tags: [targetTagId], applyTags: 'add' });
        moved += mediaIds.length;
        ctx.log('info', `Moved ${mediaIds.length} item(s) from tag #${sourceTagId} to #${targetTagId}`);
      }

      if (deleteSources) {
        await ctx.client.deleteTag(sourceTagId);
        ctx.log('info', `Deleted merged tag #${sourceTagId}`);
      } else if (mediaIds.length > 0) {
        await ctx.client.bulkEditMedia({ mediaIds, tags: [sourceTagId], applyTags: 'remove' });
      }
    }

    return { targetTagId, movedItems: moved, mergedTags: sourceTagIds.length };
  },

  'mediaTags.add': async (ctx, item) => {
    const tagIds = resolveTagIds(item.payload.tagIds, ctx.dependencyResult);
    const updated = await ctx.client.bulkEditMedia({
      mediaIds: item.payload.mediaIds,
      tags: tagIds,
      applyTags: 'add',
    });
    ctx.log('info', `Added ${tagIds.length} tag(s) to ${updated} item(s)`);
    return { updated, tagIds };
  },

  'mediaTags.remove': async (ctx, item) => {
    const tagIds = resolveTagIds(item.payload.tagIds, ctx.dependencyResult);
    const updated = await ctx.client.bulkEditMedia({
      mediaIds: item.payload.mediaIds,
      tags: tagIds,
      applyTags: 'remove',
    });
    ctx.log('info', `Removed ${tagIds.length} tag(s) from ${updated} item(s)`);
    return { updated, tagIds };
  },

  'rootFolder.create': async (ctx, item) => {
    const folder = await ctx.client.createRootFolder(item.payload.path);
    ctx.log('info', `Added root folder ${folder.path} (#${folder.id})`);
    return { rootFolderId: folder.id, path: folder.path };
  },

  'rootFolder.delete': async (ctx, item) => {
    await ctx.client.deleteRootFolder(item.payload.rootFolderId);
    ctx.log('info', `Removed root folder ${item.payload.path}`);
    return { rootFolderId: item.payload.rootFolderId };
  },

  'media.moveRootFolder': async (ctx, item) => {
    const { mediaIds, toRootFolderPath, moveFiles } = item.payload;
    const updated = await ctx.client.bulkEditMedia({ mediaIds, rootFolderPath: toRootFolderPath, moveFiles });
    ctx.log(
      'info',
      `Moved ${updated} item(s) to ${toRootFolderPath} - files ${moveFiles ? 'relocated on disk' : 'left in place'}`,
    );
    return { updated, rootFolderPath: toRootFolderPath, moveFiles };
  },

  'importList.update': async (ctx, item) => {
    const current = await ctx.client.getImportList(item.payload.importListId);
    const patch: ArrJson = {};
    const ignored: string[] = [];

    for (const [key, value] of Object.entries(item.payload.changes)) {
      if (value === undefined) continue;
      // Radarr and Sonarr expose different fields on an import list. Only send keys the
      // instance actually has, or *Arr rejects the whole PUT with a 400.
      if (key in current.raw || CORE_IMPORT_LIST_KEYS.has(key as keyof ImportListChanges)) {
        patch[key] = value;
      } else {
        ignored.push(key);
      }
    }

    if (ignored.length > 0) {
      ctx.log('warn', `Ignored field(s) not present on this ${ctx.instance.kind} import list: ${ignored.join(', ')}`);
    }

    const updated = await ctx.client.putImportList(
      item.payload.importListId,
      mergeForPut(current.raw, patch),
    );
    ctx.log('info', `Updated import list "${updated.view.name}" (#${updated.view.id})`);
    return { importListId: updated.view.id, applied: Object.keys(patch) };
  },

  'importList.delete': async (ctx, item) => {
    await ctx.client.deleteImportList(item.payload.importListId);
    ctx.log('info', `Deleted import list #${item.payload.importListId}`);
    return { importListId: item.payload.importListId };
  },

  'media.refresh': async (ctx, item) => {
    // After a folder was renamed on disk, this is what makes *Arr look again.
    const name = ctx.instance.kind === 'radarr' ? 'RefreshMovie' : 'RefreshSeries';
    const idKey = ctx.instance.kind === 'radarr' ? 'movieIds' : 'seriesIds';
    const command = await ctx.client.runCommand(
      name,
      item.payload.mediaIds.length === 0 ? {} : { [idKey]: [...item.payload.mediaIds] },
    );
    ctx.log('info', `Queued ${name} on ${ctx.instance.name} (command #${String(command.id)})`);
    return { commandId: command.id, command: name };
  },

  'importList.setEnabled': async (ctx, item) => {
    const current = await ctx.client.getImportList(item.payload.importListId);
    const patch: ArrJson = {};

    if ('enabled' in current.raw) patch['enabled'] = item.payload.enabled;
    // Radarr calls it enableAuto, Sonarr enableAutomaticAdd.
    if ('enableAuto' in current.raw) patch['enableAuto'] = item.payload.enableAutomaticAdd;
    if ('enableAutomaticAdd' in current.raw) {
      patch['enableAutomaticAdd'] = item.payload.enableAutomaticAdd;
    }

    const updated = await ctx.client.putImportList(
      item.payload.importListId,
      mergeForPut(current.raw, patch),
    );
    ctx.log(
      'info',
      `${item.payload.enabled ? 'Enabled' : 'Disabled'} import list "${updated.view.name}"`,
    );
    return { importListId: updated.view.id, applied: Object.keys(patch) };
  },
};

/**
 * Filesystem handlers.
 *
 * Each one re-runs its preflight inside FilesystemService before touching anything: a
 * staged operation was reviewed against the disk as it was, and the disk may have moved on.
 */
export const fsHandlers: FsQueueHandlers = {
  'fs.mkdir': async (ctx, item) => {
    const result = await ctx.fs.mkdirp(item.payload);
    ctx.log('info', `Created ${result.path}`);
    return result;
  },

  'fs.rename': async (ctx, item) => {
    const result = await ctx.fs.relocate('fs.rename', item.payload);
    ctx.log('info', `Renamed ${result.from} to ${result.to}`);
    return result;
  },

  'fs.move': async (ctx, item) => {
    const result = await ctx.fs.relocate('fs.move', item.payload);
    ctx.log('info', `Moved ${result.from} to ${result.to}`);
    return result;
  },

  'fs.delete': async (ctx, item) => {
    const result = await ctx.fs.remove(item.payload);
    ctx.log(
      'info',
      `Deleted ${result.path} (${String(result.fileCount)} file(s), ${String(result.freedBytes)} bytes reclaimed)`,
    );
    return result;
  },
};
