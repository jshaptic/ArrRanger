import { z } from 'zod';
import { MEDIA_KIND_BY_INSTANCE, type InstanceKind } from './instance.js';

/** Operations that talk to a Radarr/Sonarr instance. Every one needs an `instanceId`. */
export const ARR_OPS = [
  'tag.create',
  'tag.rename',
  'tag.delete',
  'tag.merge',
  'mediaTags.add',
  'mediaTags.remove',
  'rootFolder.create',
  'rootFolder.delete',
  'media.moveRootFolder',
  'media.refresh',
  'importList.update',
  'importList.delete',
  'importList.setEnabled',
] as const;
export type ArrOp = (typeof ARR_OPS)[number];

/**
 * Operations that act on mounted storage. These belong to the host, not an instance -
 * `instanceId` is null. Named to match the existing dotted convention; the brief calls
 * them FS_MKDIR / FS_RENAME / FS_MOVE / FS_DELETE.
 */
export const FS_OPS = ['fs.mkdir', 'fs.rename', 'fs.move', 'fs.delete'] as const;
export type FsOp = (typeof FS_OPS)[number];

export const QUEUE_OPS = [...ARR_OPS, ...FS_OPS] as const;
export type QueueOp = ArrOp | FsOp;

/** What a queue item acts on: an *Arr instance, or the filesystem. */
export const QUEUE_ITEM_KINDS = ['arr', 'fs'] as const;
export type QueueItemKind = (typeof QUEUE_ITEM_KINDS)[number];

const FS_OP_SET: ReadonlySet<string> = new Set(FS_OPS);

export function isFsOp(op: QueueOp): op is FsOp {
  return FS_OP_SET.has(op);
}

export function isArrOp(op: QueueOp): op is ArrOp {
  return !FS_OP_SET.has(op);
}

export function kindOfOp(op: QueueOp): QueueItemKind {
  return isFsOp(op) ? 'fs' : 'arr';
}

export const QUEUE_ITEM_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
] as const;
export type QueueItemStatus = (typeof QUEUE_ITEM_STATUSES)[number];

export const TARGET_KINDS = [
  'tag',
  'rootFolder',
  'importList',
  'movie',
  'series',
  /** A directory on mounted storage. */
  'path',
] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** Field-level changes for an import list, merged onto the raw resource before PUT. */
export interface ImportListChanges {
  name?: string;
  rootFolderPath?: string;
  qualityProfileId?: number;
  tags?: number[];
  monitor?: string;
  minimumAvailability?: string;
  seasonFolder?: boolean;
  seriesType?: string;
}

/**
 * op -> payload. This map is the single source of truth for the whole queue:
 * add an op here and every exhaustive switch in server and UI stops compiling.
 */
export interface QueueOpPayloads {
  'tag.create': { label: string };
  'tag.rename': { tagId: number; from: string; to: string };
  'tag.delete': { tagId: number; label: string; detachFromMedia: boolean };
  'tag.merge': { sourceTagIds: number[]; targetTagId: number; deleteSources: boolean };
  'mediaTags.add': { mediaIds: number[]; tagIds: number[] };
  'mediaTags.remove': { mediaIds: number[]; tagIds: number[] };
  'rootFolder.create': { path: string };
  'rootFolder.delete': { rootFolderId: number; path: string };
  'media.moveRootFolder': { mediaIds: number[]; toRootFolderPath: string; moveFiles: boolean };
  /** Rescan after the files underneath *Arr changed on disk. Empty = the whole library. */
  'media.refresh': { mediaIds: number[] };
  'importList.update': { importListId: number; changes: ImportListChanges };
  'importList.delete': { importListId: number };
  'importList.setEnabled': { importListId: number; enabled: boolean; enableAutomaticAdd: boolean };
  'fs.mkdir': { path: string; recursive: boolean };
  /** Same parent directory, new name. */
  'fs.rename': { from: string; to: string };
  /** Different parent directory. Refused across filesystems - see FilesystemService. */
  'fs.move': { from: string; to: string };
  /**
   * Hard delete. `recursive` is required for a non-empty directory; `force` is required
   * when a connected instance still references the path.
   */
  'fs.delete': { path: string; recursive: boolean; force: boolean };
}

export type QueuePayloadFor<K extends QueueOp> = QueueOpPayloads[K];

export interface QueueItemError {
  readonly code: string;
  readonly message: string;
  readonly httpStatus: number | null;
}

export interface QueueItemCommon {
  readonly id: number;
  /** Null for filesystem operations: they belong to the host, not an instance. */
  readonly instanceId: number | null;
  readonly kind: QueueItemKind;
  readonly runId: number | null;
  readonly dependsOnId: number | null;
  readonly sortOrder: number;
  readonly status: QueueItemStatus;
  readonly targetKind: TargetKind;
  readonly targetId: number | null;
  /** Snapshot of the label at staging time - survives deletion of the remote object. */
  readonly targetLabel: string;
  readonly summary: string;
  readonly affectedCount: number;
  readonly attempts: number;
  readonly error: QueueItemError | null;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/** Discriminated union member: narrowing on `op` narrows `payload`. */
export type QueueItemOf<K extends QueueOp> = QueueItemCommon & {
  readonly op: K;
  readonly payload: QueuePayloadFor<K>;
};

export type QueueItem = { [K in QueueOp]: QueueItemOf<K> }[QueueOp];

/**
 * What the UI POSTs to stage an action. Nothing has been touched yet - not the instance,
 * not the disk. An *Arr op must name its instance; a filesystem op must not.
 */
export type NewArrQueueItemOf<K extends ArrOp> = {
  readonly instanceId: number;
  readonly op: K;
  readonly payload: QueuePayloadFor<K>;
  readonly dependsOnId?: number;
};

export type NewFsQueueItemOf<K extends FsOp> = {
  readonly instanceId?: null;
  readonly op: K;
  readonly payload: QueuePayloadFor<K>;
  readonly dependsOnId?: number;
};

export type NewQueueItemOf<K extends QueueOp> = K extends ArrOp
  ? NewArrQueueItemOf<K>
  : K extends FsOp
    ? NewFsQueueItemOf<K>
    : never;

export type NewArrQueueItem = { [K in ArrOp]: NewArrQueueItemOf<K> }[ArrOp];
export type NewFsQueueItem = { [K in FsOp]: NewFsQueueItemOf<K> }[FsOp];
export type NewQueueItem = NewArrQueueItem | NewFsQueueItem;

const importListChangesSchema: z.ZodType<ImportListChanges> = z.object({
  name: z.string().min(1).optional(),
  rootFolderPath: z.string().min(1).optional(),
  qualityProfileId: z.number().int().positive().optional(),
  tags: z.array(z.number().int()).optional(),
  monitor: z.string().optional(),
  minimumAvailability: z.string().optional(),
  seasonFolder: z.boolean().optional(),
  seriesType: z.string().optional(),
});

const idList = z.array(z.number().int().positive()).min(1);

/**
 * Absolute POSIX paths only. Traversal is rejected here as a first line of defence; the
 * authoritative check is FilesystemService, which resolves against the allowed roots.
 */
const absolutePath = z
  .string()
  .min(2)
  .max(4096)
  .refine((value) => value.startsWith('/'), 'path must be absolute')
  .refine((value) => !value.split('/').includes('..'), 'path must not contain ".."')
  .refine((value) => !value.includes('\0'), 'path must not contain a null byte')
  .transform((value) => value.replace(/\/+$/, '') || '/');
/**
 * Tag lists may be empty when the item depends on a `tag.create` step - the id does not
 * exist yet at staging time. The queue rejects an empty list without a dependency.
 */
const tagIdList = z.array(z.number().int().positive());

/**
 * Runtime validation for every payload. The mapped type forces each schema to
 * match its `QueueOpPayloads` entry, so the two can never drift.
 */
export type QueuePayloadSchemas = { [K in QueueOp]: z.ZodType<QueuePayloadFor<K>> };

export const queuePayloadSchemas: QueuePayloadSchemas = {
  'tag.create': z.object({ label: z.string().min(1).max(64) }),
  'tag.rename': z.object({
    tagId: z.number().int().positive(),
    from: z.string().min(1),
    to: z.string().min(1).max(64),
  }),
  'tag.delete': z.object({
    tagId: z.number().int().positive(),
    label: z.string().min(1),
    detachFromMedia: z.boolean(),
  }),
  'tag.merge': z.object({
    sourceTagIds: idList,
    targetTagId: z.number().int().positive(),
    deleteSources: z.boolean(),
  }),
  'mediaTags.add': z.object({ mediaIds: idList, tagIds: tagIdList }),
  'mediaTags.remove': z.object({ mediaIds: idList, tagIds: tagIdList }),
  'rootFolder.create': z.object({ path: z.string().min(1) }),
  'rootFolder.delete': z.object({
    rootFolderId: z.number().int().positive(),
    path: z.string().min(1),
  }),
  'media.moveRootFolder': z.object({
    mediaIds: idList,
    toRootFolderPath: z.string().min(1),
    /** The destructive one: tells *Arr to physically relocate the files on disk. */
    moveFiles: z.boolean(),
  }),
  'importList.update': z.object({
    importListId: z.number().int().positive(),
    changes: importListChangesSchema,
  }),
  'importList.delete': z.object({ importListId: z.number().int().positive() }),
  'importList.setEnabled': z.object({
    importListId: z.number().int().positive(),
    enabled: z.boolean(),
    enableAutomaticAdd: z.boolean(),
  }),
  'media.refresh': z.object({ mediaIds: z.array(z.number().int().positive()) }),
  'fs.mkdir': z.object({ path: absolutePath, recursive: z.boolean() }),
  'fs.rename': z.object({ from: absolutePath, to: absolutePath }),
  'fs.move': z.object({ from: absolutePath, to: absolutePath }),
  'fs.delete': z.object({
    path: absolutePath,
    /** Required for a non-empty directory. */
    recursive: z.boolean(),
    /** Required when a connected instance still references the path. */
    force: z.boolean(),
  }),
};

const newQueueItemEnvelopeSchema = z
  .object({
    instanceId: z.number().int().positive().nullish(),
    op: z.enum(QUEUE_OPS),
    payload: z.unknown(),
    dependsOnId: z.number().int().positive().optional(),
  })
  .superRefine((envelope, ctx) => {
    // The instance is what makes an *Arr op addressable; a filesystem op has no instance,
    // and accepting one would quietly imply the disk belongs to it.
    if (isArrOp(envelope.op) && (envelope.instanceId === null || envelope.instanceId === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['instanceId'],
        message: `${envelope.op} needs an instanceId`,
      });
    }
    if (isFsOp(envelope.op) && envelope.instanceId !== null && envelope.instanceId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['instanceId'],
        message: `${envelope.op} acts on mounted storage and must not name an instance`,
      });
    }
  });

/**
 * Two-step parse: validate the envelope, then dispatch to the op's payload schema.
 * The single cast is unavoidable - TS cannot correlate `op` with the map lookup -
 * but it is guarded by `queuePayloadSchemas` having been type-checked above.
 */
export function parseNewQueueItem(input: unknown): NewQueueItem {
  const envelope = newQueueItemEnvelopeSchema.parse(input);
  const payload = queuePayloadSchemas[envelope.op].parse(envelope.payload);
  return {
    ...(isFsOp(envelope.op) ? { instanceId: null } : { instanceId: envelope.instanceId }),
    op: envelope.op,
    payload,
    ...(envelope.dependsOnId === undefined ? {} : { dependsOnId: envelope.dependsOnId }),
  } as NewQueueItem;
}

/**
 * What an op acts on. Media ops depend on the instance flavour; filesystem ops act on a
 * path and pass `null` for the kind.
 */
export function targetKindForOp(op: QueueOp, instanceKind: InstanceKind | null): TargetKind {
  switch (op) {
    case 'fs.mkdir':
    case 'fs.rename':
    case 'fs.move':
    case 'fs.delete':
      return 'path';
    case 'tag.create':
    case 'tag.rename':
    case 'tag.delete':
    case 'tag.merge':
      return 'tag';
    case 'rootFolder.create':
    case 'rootFolder.delete':
      return 'rootFolder';
    case 'importList.update':
    case 'importList.delete':
    case 'importList.setEnabled':
      return 'importList';
    case 'mediaTags.add':
    case 'mediaTags.remove':
    case 'media.moveRootFolder':
    case 'media.refresh':
      // Only reachable for *Arr ops, which the queue always stages with an instance.
      return instanceKind === null ? 'movie' : MEDIA_KIND_BY_INSTANCE[instanceKind];
  }
}

/** Human-readable one-liner, stored on the item so the queue reads the same after Apply. */
export function summariseQueueOp(item: NewQueueItem): string {
  switch (item.op) {
    case 'tag.create':
      return `Create tag "${item.payload.label}"`;
    case 'tag.rename':
      return `Rename tag "${item.payload.from}" to "${item.payload.to}"`;
    case 'tag.delete':
      return `Delete tag "${item.payload.label}"`;
    case 'tag.merge':
      return `Merge ${item.payload.sourceTagIds.length} tag(s) into #${item.payload.targetTagId}`;
    case 'mediaTags.add':
      return item.payload.tagIds.length === 0
        ? `Add the tag created in step ${item.dependsOnId ?? '?'} to ${item.payload.mediaIds.length} item(s)`
        : `Add ${item.payload.tagIds.length} tag(s) to ${item.payload.mediaIds.length} item(s)`;
    case 'mediaTags.remove':
      return item.payload.tagIds.length === 0
        ? `Remove the tag from step ${item.dependsOnId ?? '?'} from ${item.payload.mediaIds.length} item(s)`
        : `Remove ${item.payload.tagIds.length} tag(s) from ${item.payload.mediaIds.length} item(s)`;
    case 'rootFolder.create':
      return `Add root folder ${item.payload.path}`;
    case 'rootFolder.delete':
      return `Remove root folder ${item.payload.path}`;
    case 'media.moveRootFolder':
      return `Move ${item.payload.mediaIds.length} item(s) to ${item.payload.toRootFolderPath}${
        item.payload.moveFiles ? ' (moving files on disk)' : ' (leaving files in place)'
      }`;
    case 'importList.update':
      return `Update import list #${item.payload.importListId}`;
    case 'importList.delete':
      return `Delete import list #${item.payload.importListId}`;
    case 'importList.setEnabled':
      return `${item.payload.enabled ? 'Enable' : 'Disable'} import list #${item.payload.importListId}`;
    case 'media.refresh':
      return item.payload.mediaIds.length === 0
        ? 'Rescan the whole library'
        : `Rescan ${item.payload.mediaIds.length} item(s)`;
    case 'fs.mkdir':
      return `Create directory ${item.payload.path}`;
    case 'fs.rename':
      return `Rename ${item.payload.from} to ${basename(item.payload.to)} on disk`;
    case 'fs.move':
      return `Move ${item.payload.from} to ${item.payload.to} on disk`;
    case 'fs.delete':
      return `Delete ${item.payload.path} from disk${item.payload.recursive ? ' (recursively)' : ''}`;
  }
}

function basename(value: string): string {
  const segments = value.split('/').filter((segment) => segment.length > 0);
  return segments.at(-1) ?? value;
}

/** How many remote objects an item touches - drives the "affected" column. */
export function affectedCountForOp(item: NewQueueItem): number {
  switch (item.op) {
    case 'mediaTags.add':
    case 'mediaTags.remove':
    case 'media.moveRootFolder':
      return item.payload.mediaIds.length;
    case 'media.refresh':
      return Math.max(1, item.payload.mediaIds.length);
    case 'tag.merge':
      return item.payload.sourceTagIds.length;
    default:
      return 1;
  }
}

export interface QueueTargetDescription {
  readonly targetId: number | null;
  readonly targetLabel: string;
}

/**
 * The remote object an item points at, snapshotted at staging time so the queue still
 * reads correctly after the object is renamed or deleted on the instance.
 */
export function describeQueueTarget(item: NewQueueItem): QueueTargetDescription {
  switch (item.op) {
    case 'tag.create':
      return { targetId: null, targetLabel: item.payload.label };
    case 'tag.rename':
      return { targetId: item.payload.tagId, targetLabel: item.payload.from };
    case 'tag.delete':
      return { targetId: item.payload.tagId, targetLabel: item.payload.label };
    case 'tag.merge':
      return { targetId: item.payload.targetTagId, targetLabel: `tag #${item.payload.targetTagId}` };
    case 'mediaTags.add':
    case 'mediaTags.remove':
      return { targetId: null, targetLabel: `${item.payload.mediaIds.length} item(s)` };
    case 'rootFolder.create':
      return { targetId: null, targetLabel: item.payload.path };
    case 'rootFolder.delete':
      return { targetId: item.payload.rootFolderId, targetLabel: item.payload.path };
    case 'media.moveRootFolder':
      return { targetId: null, targetLabel: item.payload.toRootFolderPath };
    case 'importList.update':
    case 'importList.delete':
    case 'importList.setEnabled':
      return {
        targetId: item.payload.importListId,
        targetLabel: `import list #${item.payload.importListId}`,
      };
    case 'media.refresh':
      return { targetId: null, targetLabel: 'library rescan' };
    case 'fs.mkdir':
    case 'fs.delete':
      return { targetId: null, targetLabel: item.payload.path };
    case 'fs.rename':
    case 'fs.move':
      // The source path: that is the row the storage explorer highlights as staged.
      return { targetId: null, targetLabel: item.payload.from };
  }
}
