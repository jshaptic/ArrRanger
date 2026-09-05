import type {
  ImportListChanges,
  NewFsQueueItem,
  NewQueueItem,
  OnErrorPolicy,
  QueueItem,
  QueueOp,
  QueueRun,
  RunEvent,
  TargetKind,
} from '@arrranger/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { ApiRequestError } from '@/api/client';
import { queueApi } from '@/api/queue';
import type { ReplacementPreview } from '@/lib/matrix';
import { useInstancesStore } from './instances';
import { useUiStore } from './ui';

export interface QueueImpact {
  readonly operations: number;
  readonly instances: number;
  readonly affectedItems: number;
  readonly byKind: ReadonlyArray<{ kind: TargetKind; targets: number }>;
  readonly byOp: ReadonlyArray<{ op: QueueOp; count: number }>;
}

export interface RunLogEntry {
  readonly at: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
}

export interface TagTarget {
  readonly instanceId: number;
  readonly tagId: number;
  readonly label: string;
}

export interface RootFolderTarget {
  readonly instanceId: number;
  readonly rootFolderId: number;
  readonly path: string;
}

export interface RemapTarget {
  readonly instanceId: number;
  readonly mediaIds: readonly number[];
  /** Set when the destination path does not exist on this instance yet. */
  readonly needsRootFolder: boolean;
  /** Set to also remove the old root folder once the move succeeds. */
  readonly removeRootFolderId: number | null;
}

export interface ImportListTarget {
  readonly instanceId: number;
  readonly importListId: number;
}

const STAGED_STATUSES = new Set<QueueItem['status']>(['pending', 'running', 'failed']);

/** Filesystem work has no instance, so it groups under one pseudo-instance in the UI. */
export const LOCAL_STORAGE_GROUP = -1;

function stageKey(instanceId: number | null, kind: TargetKind, label: string): string {
  return `${instanceId ?? 'local'}|${kind}|${label}`;
}

/**
 * Which fleet cells an item is about, so the matrix can mark them as staged. A rename
 * touches two labels: the one disappearing and the one arriving.
 */
function stageKeysFor(item: QueueItem): string[] {
  switch (item.op) {
    case 'tag.create':
      return [stageKey(item.instanceId, 'tag', item.payload.label)];
    case 'tag.rename':
      return [
        stageKey(item.instanceId, 'tag', item.payload.from),
        stageKey(item.instanceId, 'tag', item.payload.to),
      ];
    case 'tag.delete':
      return [stageKey(item.instanceId, 'tag', item.payload.label)];
    case 'tag.merge':
      return [stageKey(item.instanceId, 'tag', item.targetLabel)];
    case 'rootFolder.create':
      return [stageKey(item.instanceId, 'rootFolder', item.payload.path)];
    case 'rootFolder.delete':
      return [stageKey(item.instanceId, 'rootFolder', item.payload.path)];
    case 'media.moveRootFolder':
      return [stageKey(item.instanceId, 'rootFolder', item.payload.toRootFolderPath)];
    case 'importList.update':
    case 'importList.delete':
    case 'importList.setEnabled':
      return [stageKey(item.instanceId, 'importList', String(item.payload.importListId))];
    case 'mediaTags.add':
    case 'mediaTags.remove':
      return item.payload.tagIds.map((tagId) =>
        stageKey(item.instanceId, 'tag', `#${String(tagId)}`),
      );
    case 'media.refresh':
      return [];
    case 'fs.mkdir':
    case 'fs.delete':
      return [stageKey(null, 'path', item.payload.path)];
    case 'fs.rename':
    case 'fs.move':
      // Both ends light up: the folder that is leaving and the name that is arriving.
      return [stageKey(null, 'path', item.payload.from), stageKey(null, 'path', item.payload.to)];
  }
}

function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : 'Request failed';
}

/**
 * The staging queue.
 *
 * A single user action here is a *fleet* action: "propagate this tag" or "re-map this
 * path" expands into one operation per target instance, pushed as one atomic batch, and
 * only applied when the user says so.
 */
export const useQueueStore = defineStore('queue', () => {
  const ui = useUiStore();
  const instancesStore = useInstancesStore();

  const items = ref<QueueItem[]>([]);
  const activeRun = ref<QueueRun | null>(null);
  const runItems = ref<QueueItem[]>([]);
  const runLog = ref<RunLogEntry[]>([]);
  const currentItemId = ref<number | null>(null);
  const failedItemId = ref<number | null>(null);
  const streaming = ref(false);
  const busy = ref(false);
  const loading = ref(false);

  let closeStream: (() => void) | null = null;

  const staged = computed(() => items.value.filter((item) => STAGED_STATUSES.has(item.status)));
  const pending = computed(() => items.value.filter((item) => item.status === 'pending'));
  const failed = computed(() => items.value.filter((item) => item.status === 'failed'));
  const finished = computed(() =>
    items.value.filter((item) => item.status === 'succeeded' || item.status === 'skipped' || item.status === 'cancelled'),
  );

  const impact = computed<QueueImpact>(() => {
    const list = staged.value;
    const kinds = new Map<TargetKind, Set<string>>();
    const ops = new Map<QueueOp, number>();

    for (const item of list) {
      const targets = kinds.get(item.targetKind) ?? new Set<string>();
      targets.add(item.targetLabel);
      kinds.set(item.targetKind, targets);
      ops.set(item.op, (ops.get(item.op) ?? 0) + 1);
    }

    return {
      operations: list.length,
      instances: new Set(list.map((item) => item.instanceId).filter((id) => id !== null)).size,
      affectedItems: list.reduce((sum, item) => sum + item.affectedCount, 0),
      byKind: [...kinds.entries()].map(([kind, targets]) => ({ kind, targets: targets.size })),
      byOp: [...ops.entries()].map(([op, count]) => ({ op, count })),
    };
  });

  /** Drawer grouping: by target instance, with disk work in its own group. */
  const groupedByInstance = computed(() => {
    const groups = new Map<number, QueueItem[]>();
    for (const item of staged.value) {
      const key = item.instanceId ?? LOCAL_STORAGE_GROUP;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()]
      .map(([instanceId, group]) => ({
        instanceId,
        instance: instancesStore.byId.get(instanceId) ?? null,
        label:
          instanceId === LOCAL_STORAGE_GROUP
            ? 'Local storage'
            : (instancesStore.byId.get(instanceId)?.name ?? `instance ${String(instanceId)}`),
        items: group,
      }))
      // Disk work runs first in a mixed recipe, so it reads first too.
      .sort((a, b) =>
        a.instanceId === LOCAL_STORAGE_GROUP
          ? -1
          : b.instanceId === LOCAL_STORAGE_GROUP
            ? 1
            : a.label.localeCompare(b.label, 'en'),
      );
  });

  /** Drawer grouping: execution order, which is what Apply All will actually do. */
  const executionOrder = computed(() =>
    [...staged.value].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
  );

  const stagedIndex = computed(() => {
    const index = new Map<string, QueueItem[]>();
    for (const item of staged.value) {
      for (const key of stageKeysFor(item)) {
        index.set(key, [...(index.get(key) ?? []), item]);
      }
    }
    return index;
  });

  const stagedForTag = (instanceId: number, label: string): QueueItem[] =>
    stagedIndex.value.get(stageKey(instanceId, 'tag', label)) ?? [];

  const stagedForRootFolder = (instanceId: number, path: string): QueueItem[] =>
    stagedIndex.value.get(stageKey(instanceId, 'rootFolder', path)) ?? [];

  const stagedForImportList = (instanceId: number, listId: number): QueueItem[] =>
    stagedIndex.value.get(stageKey(instanceId, 'importList', String(listId))) ?? [];

  /** Staged disk work touching a path - drives the storage explorer badges. */
  const stagedForPath = (target: string): QueueItem[] =>
    stagedIndex.value.get(stageKey(null, 'path', target)) ?? [];

  const runProgress = computed(() => {
    const run = activeRun.value;
    if (run === null || run.totalItems === 0) return 0;
    const done = run.succeededItems + run.failedItems + run.skippedItems;
    return Math.min(100, Math.round((done / run.totalItems) * 100));
  });

  const currentItem = computed(() =>
    currentItemId.value === null
      ? null
      : (runItems.value.find((item) => item.id === currentItemId.value) ?? null),
  );

  const currentInstance = computed(() => {
    const item = currentItem.value;
    if (item === null || item.instanceId === null) return null;
    return instancesStore.byId.get(item.instanceId) ?? null;
  });

  const isRunning = computed(() => activeRun.value?.status === 'running');
  const isPaused = computed(() => activeRun.value?.status === 'paused');

  // ------------------------------------------------------------------- loading

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const response = await queueApi.list();
      items.value = [...response.items];
      activeRun.value = response.activeRun;

      if (response.activeRun !== null) {
        const detail = await queueApi.run(response.activeRun.id);
        runItems.value = [...detail.items];
        activeRun.value = detail.run;
        if (detail.run.status === 'running') attachStream(detail.run.id);
      }
    } catch (caught) {
      ui.notify('error', `Could not load the queue: ${messageOf(caught)}`);
    } finally {
      loading.value = false;
    }
  }

  async function push(batch: readonly NewQueueItem[], description: string): Promise<QueueItem[]> {
    if (batch.length === 0) {
      ui.notify('info', 'Nothing to stage - no instance needed that change');
      return [];
    }

    busy.value = true;
    try {
      const response = await queueApi.push(batch);
      await load();
      ui.notify(
        'success',
        `Staged ${description} (${String(response.items.length)} operation${response.items.length === 1 ? '' : 's'})`,
      );
      ui.openDrawer();
      return response.items;
    } catch (caught) {
      ui.notify('error', `Could not stage ${description}: ${messageOf(caught)}`);
      return [];
    } finally {
      busy.value = false;
    }
  }

  // ------------------------------------------------------------- fleet actions

  /** "Propagate missing tag": one create per instance that lacks it. */
  function propagateTag(label: string, instanceIds: readonly number[]): Promise<QueueItem[]> {
    return push(
      instanceIds.map((instanceId) => ({
        instanceId,
        op: 'tag.create' as const,
        payload: { label },
      })),
      `tag "${label}" on ${String(instanceIds.length)} instance(s)`,
    );
  }

  /** "Bulk rename across selected instances": one rename per instance holding the tag. */
  function renameTagAcross(targets: readonly TagTarget[], to: string): Promise<QueueItem[]> {
    return push(
      targets.map((target) => ({
        instanceId: target.instanceId,
        op: 'tag.rename' as const,
        payload: { tagId: target.tagId, from: target.label, to },
      })),
      `rename to "${to}" on ${String(targets.length)} instance(s)`,
    );
  }

  function deleteTagAcross(
    targets: readonly TagTarget[],
    detachFromMedia: boolean,
  ): Promise<QueueItem[]> {
    return push(
      targets.map((target) => ({
        instanceId: target.instanceId,
        op: 'tag.delete' as const,
        payload: { tagId: target.tagId, label: target.label, detachFromMedia },
      })),
      `deletion of "${targets[0]?.label ?? 'tag'}" on ${String(targets.length)} instance(s)`,
    );
  }

  /**
   * Find &amp; replace across the fleet. Where the new label already exists on that
   * instance, a rename would fail with "Label already exists" - so those become a merge
   * into the existing tag instead, which is what the user actually means.
   */
  function applyFindReplace(
    previews: readonly ReplacementPreview[],
    collisions: ReadonlyMap<string, number>,
  ): Promise<QueueItem[]> {
    const batch = previews.map((preview): NewQueueItem => {
      const existingId = collisions.get(`${preview.instanceId}|${preview.to}`);
      if (existingId !== undefined) {
        return {
          instanceId: preview.instanceId,
          op: 'tag.merge',
          payload: { sourceTagIds: [preview.tagId], targetTagId: existingId, deleteSources: true },
        };
      }
      return {
        instanceId: preview.instanceId,
        op: 'tag.rename',
        payload: { tagId: preview.tagId, from: preview.from, to: preview.to },
      };
    });

    return push(batch, `${String(batch.length)} tag replacement(s) across the fleet`);
  }

  function createRootFolderAcross(
    path: string,
    instanceIds: readonly number[],
  ): Promise<QueueItem[]> {
    return push(
      instanceIds.map((instanceId) => ({
        instanceId,
        op: 'rootFolder.create' as const,
        payload: { path },
      })),
      `root folder ${path} on ${String(instanceIds.length)} instance(s)`,
    );
  }

  function deleteRootFolderAcross(targets: readonly RootFolderTarget[]): Promise<QueueItem[]> {
    return push(
      targets.map((target) => ({
        instanceId: target.instanceId,
        op: 'rootFolder.delete' as const,
        payload: { rootFolderId: target.rootFolderId, path: target.path },
      })),
      `removal of ${targets[0]?.path ?? 'root folder'} from ${String(targets.length)} instance(s)`,
    );
  }

  /**
   * Multi-instance path re-map, staged as a dependent chain per instance:
   *   create destination (if missing) -> move media -> remove the old root folder.
   * Each step depends on the previous one, so a failed move can never be followed by the
   * deletion of the folder the media is still in.
   */
  async function remapRootFolder(params: {
    targets: readonly RemapTarget[];
    toPath: string;
    moveFiles: boolean;
  }): Promise<void> {
    const { targets, toPath, moveFiles } = params;
    if (targets.length === 0) {
      ui.notify('info', 'Nothing to re-map');
      return;
    }

    busy.value = true;
    try {
      // Step 1: destinations that do not exist yet. Their ids are needed as dependencies,
      // so this batch goes first and on its own.
      const creators = targets.filter((target) => target.needsRootFolder);
      const created = new Map<number, number>();

      if (creators.length > 0) {
        const response = await queueApi.push(
          creators.map((target) => ({
            instanceId: target.instanceId,
            op: 'rootFolder.create' as const,
            payload: { path: toPath },
          })),
        );
        for (const item of response.items) {
          if (item.instanceId !== null) created.set(item.instanceId, item.id);
        }
      }

      // Step 2: the moves, each depending on its instance's create when there was one.
      const moveResponse = await queueApi.push(
        targets
          .filter((target) => target.mediaIds.length > 0)
          .map((target): NewQueueItem => {
            const dependsOnId = created.get(target.instanceId);
            return {
              instanceId: target.instanceId,
              op: 'media.moveRootFolder',
              payload: {
                mediaIds: [...target.mediaIds],
                toRootFolderPath: toPath,
                moveFiles,
              },
              ...(dependsOnId === undefined ? {} : { dependsOnId }),
            };
          }),
      );

      const moveByInstance = new Map(moveResponse.items.map((item) => [item.instanceId, item.id]));

      // Step 3: optional cleanup of the old root folder, gated on its move succeeding.
      const removals = targets.filter((target) => target.removeRootFolderId !== null);
      if (removals.length > 0) {
        await queueApi.push(
          removals.map((target): NewQueueItem => {
            const dependsOnId = moveByInstance.get(target.instanceId);
            return {
              instanceId: target.instanceId,
              op: 'rootFolder.delete',
              payload: {
                rootFolderId: target.removeRootFolderId ?? 0,
                path: '(old root folder)',
              },
              ...(dependsOnId === undefined ? {} : { dependsOnId }),
            };
          }),
        );
      }

      await load();
      ui.notify(
        'success',
        `Staged re-map to ${toPath} across ${String(targets.length)} instance(s)${moveFiles ? ' - files will move on disk' : ''}`,
      );
      ui.openDrawer();
    } catch (caught) {
      ui.notify('error', `Could not stage the re-map: ${messageOf(caught)}`);
      await load();
    } finally {
      busy.value = false;
    }
  }

  // ------------------------------------------------------- filesystem actions

  /** One disk operation, staged like any other change. */
  function stageFsOperation(item: NewFsQueueItem, description: string): Promise<QueueItem[]> {
    return push([item], description);
  }

  /**
   * Reconcile & Align: rename a folder on disk, then point each selected instance at the
   * new path *without* asking *Arr to move anything - the bytes are already there.
   *
   * Staged as a dependency chain, so a failed disk step means no instance is touched.
   */
  async function stageReconcile(params: {
    from: string;
    to: string;
    targets: ReadonlyArray<{ instanceId: number; mediaIds: readonly number[]; oldRootFolderId: number | null }>;
    removeOldRootFolder: boolean;
    refreshAfter: boolean;
  }): Promise<void> {
    busy.value = true;
    try {
      // Step 1: the disk. Everything else hangs off this item.
      const renamed = await queueApi.push([
        { op: 'fs.rename', payload: { from: params.from, to: params.to } },
      ]);
      const renameId = renamed.items[0]?.id;
      if (renameId === undefined) throw new Error('The rename step was not staged');

      for (const target of params.targets) {
        // Step 2: the destination root folder, once the rename has happened.
        const created = await queueApi.push([
          {
            instanceId: target.instanceId,
            op: 'rootFolder.create',
            payload: { path: params.to },
            dependsOnId: renameId,
          },
        ]);
        const rootFolderId = created.items[0]?.id ?? renameId;

        // Step 3: realign the media. moveFiles is false by design.
        //
        // An instance with nothing under the folder skips this and the rescan: a root
        // folder can be configured before a single download (see `PathOwner.use`), and a
        // bulk edit with no ids is a request *Arr has no reason to accept. Re-pointing it
        // is still the create-and-drop pair below, so the instance is never left out.
        let realignId = rootFolderId;

        if (target.mediaIds.length > 0) {
          const realigned = await queueApi.push([
            {
              instanceId: target.instanceId,
              op: 'media.moveRootFolder',
              payload: {
                mediaIds: [...target.mediaIds],
                toRootFolderPath: params.to,
                moveFiles: false,
              },
              dependsOnId: rootFolderId,
            },
          ]);
          realignId = realigned.items[0]?.id ?? rootFolderId;
        }

        // Step 4: make the instance look at the new paths.
        if (params.refreshAfter && target.mediaIds.length > 0) {
          await queueApi.push([
            {
              instanceId: target.instanceId,
              op: 'media.refresh',
              payload: { mediaIds: [...target.mediaIds] },
              dependsOnId: realignId,
            },
          ]);
        }

        // Step 5: drop the old root folder, only if its move succeeded.
        if (params.removeOldRootFolder && target.oldRootFolderId !== null) {
          await queueApi.push([
            {
              instanceId: target.instanceId,
              op: 'rootFolder.delete',
              payload: { rootFolderId: target.oldRootFolderId, path: params.from },
              dependsOnId: realignId,
            },
          ]);
        }
      }

      await load();
      ui.notify(
        'success',
        `Staged the rename of ${params.from} plus ${String(params.targets.length)} instance realignment(s) - no files will be copied`,
      );
      ui.openDrawer();
    } catch (caught) {
      ui.notify('error', `Could not stage the reconcile: ${messageOf(caught)}`);
      await load();
    } finally {
      busy.value = false;
    }
  }

  function setImportListEnabled(
    targets: readonly ImportListTarget[],
    enabled: boolean,
    enableAutomaticAdd: boolean,
  ): Promise<QueueItem[]> {
    return push(
      targets.map((target) => ({
        instanceId: target.instanceId,
        op: 'importList.setEnabled' as const,
        payload: { importListId: target.importListId, enabled, enableAutomaticAdd },
      })),
      `${enabled ? 'enable' : 'disable'} on ${String(targets.length)} import list(s)`,
    );
  }

  function updateImportListsAcross(
    targets: readonly ImportListTarget[],
    changes: ImportListChanges,
  ): Promise<QueueItem[]> {
    return push(
      targets.map((target) => ({
        instanceId: target.instanceId,
        op: 'importList.update' as const,
        payload: { importListId: target.importListId, changes },
      })),
      `import list changes on ${String(targets.length)} instance(s)`,
    );
  }

  // -------------------------------------------------------------- queue admin

  async function reorder(itemIds: readonly number[]): Promise<void> {
    try {
      await queueApi.reorder(itemIds);
      await load();
    } catch (caught) {
      ui.notify('error', `Could not reorder: ${messageOf(caught)}`);
    }
  }

  /** Moves one operation up or down in the execution order. */
  async function move(itemId: number, direction: -1 | 1): Promise<void> {
    const order = pending.value.map((item) => item.id);
    const index = order.indexOf(itemId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= order.length) return;

    const next = [...order];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);
    await reorder(next);
  }

  async function removeItem(itemId: number): Promise<void> {
    try {
      await queueApi.remove(itemId);
      await load();
    } catch (caught) {
      ui.notify('error', `Could not remove the operation: ${messageOf(caught)}`);
    }
  }

  async function retryItem(itemId: number): Promise<void> {
    try {
      await queueApi.retry(itemId);
      await load();
    } catch (caught) {
      ui.notify('error', `Could not retry: ${messageOf(caught)}`);
    }
  }

  async function clearFinished(): Promise<void> {
    try {
      await queueApi.clear();
      await load();
    } catch (caught) {
      ui.notify('error', `Could not clear the queue: ${messageOf(caught)}`);
    }
  }

  async function discardAll(): Promise<void> {
    const ids = pending.value.map((item) => item.id);
    for (const id of ids) await queueApi.remove(id);
    await load();
    ui.notify('info', `Discarded ${String(ids.length)} staged operation(s)`);
  }

  // ---------------------------------------------------------------- execution

  function detachStream(): void {
    closeStream?.();
    closeStream = null;
    streaming.value = false;
  }

  function upsertItem(item: QueueItem): void {
    items.value = items.value.map((entry) => (entry.id === item.id ? item : entry));
    const known = runItems.value.some((entry) => entry.id === item.id);
    runItems.value = known
      ? runItems.value.map((entry) => (entry.id === item.id ? item : entry))
      : [...runItems.value, item];
  }

  function applyEvent(event: RunEvent): void {
    switch (event.type) {
      case 'run.started':
        activeRun.value = event.run;
        break;
      case 'item.started':
        currentItemId.value = event.item.id;
        upsertItem(event.item);
        break;
      case 'item.finished':
        activeRun.value = event.run;
        upsertItem(event.item);
        break;
      case 'log':
        runLog.value = [
          ...runLog.value.slice(-199),
          { at: new Date().toISOString(), level: event.level, message: event.message },
        ];
        break;
      case 'run.paused':
        activeRun.value = event.run;
        failedItemId.value = event.failedItemId;
        currentItemId.value = null;
        detachStream();
        void load();
        break;
      case 'run.finished':
        activeRun.value = event.run;
        currentItemId.value = null;
        detachStream();
        void load();
        break;
    }
  }

  function attachStream(runId: number): void {
    detachStream();
    streaming.value = true;
    closeStream = queueApi.openStream(runId, {
      onEvent: applyEvent,
      onError: () => {
        // EventSource retries on its own; a hard failure falls back to one poll.
        void queueApi
          .run(runId)
          .then((detail) => {
            activeRun.value = detail.run;
            runItems.value = [...detail.items];
          })
          .catch(() => undefined);
      },
    });
  }

  async function start(onError: OnErrorPolicy = 'pause'): Promise<void> {
    busy.value = true;
    runLog.value = [];
    failedItemId.value = null;
    try {
      const response = await queueApi.start({ onError });
      activeRun.value = response.run;
      runItems.value = [...response.items];
      ui.openExecution();
      attachStream(response.run.id);
    } catch (caught) {
      ui.notify('error', `Could not start the run: ${messageOf(caught)}`);
    } finally {
      busy.value = false;
    }
  }

  async function resume(options: { retryFailed?: boolean; skipFailed?: boolean }): Promise<void> {
    const run = activeRun.value;
    if (run === null) return;

    busy.value = true;
    try {
      const response = await queueApi.resume(run.id, options);
      activeRun.value = response.run;
      runItems.value = [...response.items];
      failedItemId.value = null;
      attachStream(run.id);
    } catch (caught) {
      ui.notify('error', `Could not resume: ${messageOf(caught)}`);
    } finally {
      busy.value = false;
    }
  }

  async function cancel(): Promise<void> {
    const run = activeRun.value;
    if (run === null) return;

    busy.value = true;
    try {
      const response = await queueApi.cancel(run.id);
      activeRun.value = response.run;
      runItems.value = [...response.items];
      detachStream();
      await load();
      ui.notify('info', `Run ${String(run.id)} cancelled`);
    } catch (caught) {
      ui.notify('error', `Could not cancel: ${messageOf(caught)}`);
    } finally {
      busy.value = false;
    }
  }

  return {
    items,
    activeRun,
    runItems,
    runLog,
    currentItemId,
    failedItemId,
    streaming,
    busy,
    loading,
    staged,
    pending,
    failed,
    finished,
    impact,
    groupedByInstance,
    executionOrder,
    stagedForTag,
    stagedForRootFolder,
    stagedForImportList,
    stagedForPath,
    runProgress,
    currentItem,
    currentInstance,
    isRunning,
    isPaused,
    load,
    stage: push,
    propagateTag,
    renameTagAcross,
    deleteTagAcross,
    applyFindReplace,
    createRootFolderAcross,
    deleteRootFolderAcross,
    remapRootFolder,
    setImportListEnabled,
    updateImportListsAcross,
    stageFsOperation,
    stageReconcile,
    reorder,
    move,
    removeItem,
    retryItem,
    clearFinished,
    discardAll,
    start,
    resume,
    cancel,
  };
});
