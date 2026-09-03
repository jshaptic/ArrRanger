<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { NewQueueItem, PathNode, PathSelector } from '@arrranger/shared';
import BaseButton from '@/components/base/BaseButton.vue';
import EmptyState from '@/components/base/EmptyState.vue';
import FleetBar from '@/components/fleet/FleetBar.vue';
import InstanceColumnHeader from '@/components/fleet/InstanceColumnHeader.vue';
import PathRowView from '@/components/paths/PathRowView.vue';
import RollupSummary from '@/components/paths/RollupSummary.vue';
import AddPathDialog from '@/components/roots/AddPathDialog.vue';
import RemapDialog from '@/components/roots/RemapDialog.vue';
import RemoveRootFoldersDialog from '@/components/roots/RemoveRootFoldersDialog.vue';
import DiskOperationModal, { type DiskOperation } from '@/components/storage/DiskOperationModal.vue';
import ReconcileDialog from '@/components/storage/ReconcileDialog.vue';
import { breadcrumbs } from '@/lib/fs-tree';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { missingRootFolderOn, rootFolderTargets, trackedBy, type PathAction } from '@/lib/path-matrix';
import { useMatrixStore } from '@/stores/matrix';
import { usePathsStore } from '@/stores/paths';
import { useQueueStore, type RootFolderTarget } from '@/stores/queue';

const paths = usePathsStore();
const queue = useQueueStore();
const matrix = useMatrixStore();

const adding = ref<{ path: string; preselect: number[] } | null>(null);
const remapping = ref<string | null>(null);
const removing = ref<RootFolderTarget[] | null>(null);
const reconciling = ref<string | null>(null);
const operation = ref<{ operation: DiskOperation; target: string } | null>(null);

const selected = ref<string[]>([]);
const search = ref('');

/** The segmented filter. `null` means "whatever each level decides for itself". */
const SELECTORS: ReadonlyArray<{ label: string; value: readonly PathSelector[] | null }> = [
  { label: 'Default', value: null },
  { label: 'Problems', value: ['problems'] },
  { label: 'Not a root folder', value: ['candidates'] },
  { label: 'Root folders', value: ['rootFolders'] },
  { label: 'Everything', value: ['all'] },
];

const columns = computed(() => paths.columns);

/** Instance columns come from the fleet store so FleetBar targeting still drives them. */
const targets = computed(() => matrix.targetInstanceIds);

const crumbs = computed(() =>
  paths.focus === null ? [] : breadcrumbs(paths.focus, paths.rootPaths),
);

const selectedNodes = computed(() =>
  selected.value.map((path) => paths.nodeAt(path)).filter((node): node is PathNode => node !== null),
);

const propagatable = computed(() =>
  selectedNodes.value.flatMap((node) => missingRootFolderOn(node, targets.value)),
);

const deletable = computed<RootFolderTarget[]>(() =>
  selectedNodes.value.flatMap((node) => rootFolderTargets(node, targets.value)),
);

const activeSelector = computed(() => JSON.stringify(paths.selection));

function isActiveSelector(value: readonly PathSelector[] | null): boolean {
  return activeSelector.value === JSON.stringify(value);
}

function toggleSelected(path: string): void {
  selected.value = selected.value.includes(path)
    ? selected.value.filter((entry) => entry !== path)
    : [...selected.value, path];
}

function instanceName(instanceId: number): string {
  return (
    columns.value.find((column) => column.instanceId === instanceId)?.name ??
    `instance ${String(instanceId)}`
  );
}

async function propagateSelected(): Promise<void> {
  const batch: NewQueueItem[] = selectedNodes.value.flatMap((node) =>
    missingRootFolderOn(node, targets.value).map((instanceId) => ({
      instanceId,
      op: 'rootFolder.create' as const,
      payload: { path: node.path },
    })),
  );

  await queue.stage(
    batch,
    `${String(selectedNodes.value.length)} path(s) on ${String(new Set(batch.map((item) => item.instanceId)).size)} instance(s)`,
  );
  selected.value = [];
}

function runAction(node: PathNode, action: PathAction): void {
  switch (action) {
    case 'propagate':
      adding.value = { path: node.path, preselect: missingRootFolderOn(node, targets.value) };
      return;
    case 'remove':
      removing.value = rootFolderTargets(node, targets.value);
      return;
    case 'remap':
      remapping.value = node.path;
      return;
    case 'reconcile':
      reconciling.value = node.path;
      return;
    case 'mkdir':
      operation.value = { operation: 'mkdir', target: node.path };
      return;
    case 'rename':
      operation.value = { operation: 'rename', target: node.path };
      return;
    case 'move':
      operation.value = { operation: 'move', target: node.path };
      return;
    case 'prune':
      operation.value = { operation: 'delete', target: node.path };
      return;
    case 'focus':
      void paths.focusOn(node.path);
      return;
  }
}

function stageCellCreate(node: PathNode, instanceId: number): void {
  void queue.createRootFolderAcross(node.path, [instanceId]);
}

function stageCellRemove(node: PathNode, instanceId: number, rootFolderId: number | null): void {
  removing.value = [{ instanceId, rootFolderId: rootFolderId ?? 0, path: node.path }];
}

/** The instances a relocation would leave dangling, passed to the disk dialog. */
const operationTrackedBy = computed(() => {
  const target = operation.value?.target;
  if (target === undefined) return [];
  const node = paths.nodeAt(target);
  return node === null ? [] : trackedBy(node, columns.value);
});

onMounted(async () => {
  if (!paths.loadedOnce) await paths.load();
  if (matrix.columns.length === 0 || matrix.lastLoadedAt === null) void matrix.load();
});
</script>

<template>
  <div class="space-y-4">
    <FleetBar />

    <EmptyState
      v-if="!paths.enabled && !paths.loading"
      title="Filesystem access is off"
      description="ArrRanger can inspect and reorganise media folders once it can see them. Mount your media at the same path the *Arr containers use, then set FS_ROOTS."
      icon="🗃"
    >
      <pre class="mt-1 overflow-x-auto rounded-md border border-line bg-raised px-3 py-2 text-left font-mono text-[11px] text-muted">volumes:
  - /mnt/user/data:/data:rw    # the same path Radarr/Sonarr see
environment:
  FS_ROOTS: /data
  PUID: "99"                   # must match the *Arr containers
  PGID: "100"
  UMASK: "002"</pre>
    </EmptyState>

    <template v-else>
      <!-- mapping mismatch: the diagnosis that saves an hour -->
      <section
        v-if="paths.mismatches.length > 0"
        class="rounded-lg border border-drift/40 bg-drift/5 px-4 py-3"
      >
        <h2 class="mb-2 text-sm font-semibold text-drift">
          ⚠ {{ paths.mismatches.length }} instance(s) describe paths this container cannot see
        </h2>
        <ul class="space-y-2 text-[11px]">
          <li v-for="mismatch in paths.mismatches" :key="mismatch.instanceId">
            <p class="text-ink">{{ instanceName(mismatch.instanceId) }}</p>
            <p class="text-muted">
              reports {{ mismatch.mediaPathCount }} media path(s) under
              <span class="font-mono">{{ mismatch.reportedPaths.join(', ') || 'no root folders' }}</span>
            </p>
            <p class="text-muted">
              this container has <span class="font-mono">{{ mismatch.checkedRoots.join(', ') }}</span>
            </p>
          </li>
        </ul>
        <p class="mt-2 text-[11px] leading-relaxed text-muted">
          That is a volume mapping difference, not missing media. ArrRanger deliberately does
          not translate paths: mount the same host directory at the same container path as the
          *Arr apps, and this panel disappears. Those root folders are listed below as rows
          marked <span class="font-mono">not mounted here</span>.
        </p>
      </section>

      <section
        v-if="paths.unwritableRoots.length > 0 || paths.brokenRoots.length > 0"
        class="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-[11px] text-danger"
      >
        <p v-for="root in paths.unwritableRoots" :key="root.path">
          {{ root.path }} is readable but not writable - check PUID/PGID and UMASK against the
          *Arr containers.
        </p>
        <p v-for="root in paths.brokenRoots" :key="root.path">
          {{ root.path }} is not reachable: {{ root.error ?? 'missing' }}
        </p>
      </section>

      <!-- totals -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span class="text-muted">{{ paths.totals.rootFolderPaths }} root folder path(s)</span>
        <span v-if="paths.totals.candidates > 0" class="text-drift">
          {{ paths.totals.candidates }} not used as a root folder
        </span>
        <span v-if="paths.totals.untracked > 0" class="text-drift">
          {{ paths.totals.untracked }} untracked
        </span>
        <span v-if="paths.totals.missing > 0" class="text-danger">
          {{ paths.totals.missing }} missing on disk
        </span>
        <span v-if="paths.totals.unseenRootFolders > 0" class="text-danger">
          {{ paths.totals.unseenRootFolders }} not mounted here
        </span>
        <span v-if="paths.totals.unmanaged > 0" class="text-drift">
          {{ paths.totals.unmanaged }} media path(s) under no root folder
        </span>
      </div>

      <!-- toolbar -->
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="search"
          type="search"
          placeholder="Filter folder names…"
          class="h-9 w-48 rounded-md border border-line bg-raised px-3 text-sm text-ink outline-none focus:border-accent"
          @change="paths.setFilter(search)"
        />
        <div class="flex flex-wrap gap-1">
          <BaseButton
            v-for="selector in SELECTORS"
            :key="selector.label"
            size="sm"
            :variant="isActiveSelector(selector.value) ? 'primary' : 'ghost'"
            @click="paths.setSelection(selector.value)"
          >
            {{ selector.label }}
          </BaseButton>
        </div>
        <span v-if="paths.busy" class="flex items-center gap-1.5 text-[11px] text-accent">
          <span
            class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          Reading storage…
        </span>
        <span v-else class="text-[11px] text-faint">
          scanned {{ formatRelativeTime(paths.scannedAt) }}
        </span>

        <span v-if="selected.length > 0" class="text-xs text-staged">
          {{ selected.length }} row(s) selected
        </span>

        <div class="ml-auto flex flex-wrap items-center gap-2">
          <BaseButton size="sm" :loading="paths.loading" @click="paths.load({ refresh: true })">
            Rescan
          </BaseButton>
          <BaseButton size="sm" variant="primary" @click="adding = { path: '', preselect: [] }">
            Add root folder…
          </BaseButton>
          <BaseButton
            size="sm"
            variant="success"
            :disabled="propagatable.length === 0"
            :title="
              propagatable.length === 0
                ? 'Select rows that are missing on at least one targeted instance'
                : `Stage ${propagatable.length} create(s)`
            "
            @click="propagateSelected()"
          >
            Propagate missing ({{ propagatable.length }})
          </BaseButton>
          <BaseButton
            size="sm"
            variant="danger"
            :disabled="deletable.length === 0"
            @click="removing = deletable"
          >
            Remove ({{ deletable.length }})
          </BaseButton>
        </div>
      </div>

      <!-- focus breadcrumb -->
      <nav v-if="paths.focus" class="flex flex-wrap items-center gap-1 text-[11px] text-muted">
        <BaseButton size="sm" variant="ghost" @click="paths.clearFocus()">
          ← back to mounts
        </BaseButton>
        <template v-for="(crumb, index) in crumbs" :key="crumb.path">
          <span v-if="index > 0" class="text-faint">/</span>
          <button
            type="button"
            class="rounded px-1 font-mono transition-colors hover:text-ink"
            :class="index === crumbs.length - 1 ? 'text-ink' : ''"
            @click="paths.focusOn(crumb.path)"
          >
            {{ crumb.label }}
          </button>
        </template>
      </nav>

      <!-- first paint reads every mount and root folder, so say so rather than
           flashing an empty table -->
      <div
        v-if="paths.rows.length === 0 && paths.loading"
        class="space-y-2 rounded-lg border border-line p-3"
        role="status"
        aria-live="polite"
      >
        <p class="flex items-center gap-2 text-xs text-muted">
          <span
            class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          Reading every mount and root folder…
        </p>
        <div
          v-for="row in 6"
          :key="row"
          class="h-7 animate-pulse rounded bg-raised"
          :style="{ width: `${String(90 - row * 6)}%` }"
        />
      </div>

      <EmptyState
        v-else-if="paths.rows.length === 0"
        title="Nothing to show"
        description="Root folders come from each instance, folders come from the mounts in FS_ROOTS. If both are empty, add an instance or check your mounts."
        icon="🗄"
      />

      <div v-else class="overflow-x-auto rounded-lg border border-line transition-opacity" :class="paths.busy ? 'opacity-60' : ''">
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th
                scope="col"
                class="sticky left-0 z-20 min-w-[22rem] border-b border-line bg-raised px-3 py-2 text-left text-[11px] font-semibold text-muted"
              >
                Path
              </th>
              <th class="border-b border-l border-line bg-raised px-2 py-2 text-left text-[11px] font-semibold text-muted">
                Size
              </th>
              <th class="border-b border-l border-line bg-raised px-2 py-2 text-left text-[11px] font-semibold text-muted">
                Disk
              </th>
              <InstanceColumnHeader
                v-for="column in matrix.columns"
                :key="column.instance.id"
                :column="column"
              />
              <th class="border-b border-l border-line bg-raised px-2 py-2 text-right text-[11px] font-semibold text-muted">
                Row actions
              </th>
            </tr>
          </thead>

          <tbody>
            <template v-for="row in paths.rows" :key="row.key">
              <PathRowView
                v-if="row.kind === 'node' && row.node"
                :node="row.node"
                :depth="row.depth"
                :columns="columns"
                :target-instance-ids="targets"
                :expanded="row.expanded"
                :busy="queue.busy"
                :loading="paths.isLoadingPath(row.node.path)"
                :selected="selected.includes(row.node.path)"
                :measured="paths.measurements[row.node.path]?.sizeOnDisk ?? null"
                :measuring="paths.measuring[row.node.path] === true"
                :staged-for-path="queue.stagedForPath(row.node.path)"
                :staged-for-cell="queue.stagedForRootFolder"
                @toggle="paths.toggle(row.node.path)"
                @select="toggleSelected(row.node.path)"
                @measure="paths.measure(row.node.path)"
                @action="runAction(row.node, $event)"
                @cell-create="stageCellCreate(row.node, $event)"
                @cell-remove="stageCellRemove(row.node, $event.instanceId, $event.rootFolderId)"
              />
              <RollupSummary
                v-else-if="row.kind === 'rollup' && row.level"
                :level="row.level"
                :depth="row.depth"
                :columns="columns.length + 3"
                :busy="paths.isLoadingPath(row.levelPath)"
                :filter="paths.filter"
                @show-more="paths.loadMore(row.levelPath)"
                @show-all="paths.showAll(row.levelPath)"
              />
            </template>
          </tbody>

          <tfoot>
            <tr class="bg-raised/40">
              <th
                scope="row"
                class="sticky left-0 z-10 bg-raised px-3 py-1.5 text-left text-[11px] font-medium text-muted"
              >
                free space
              </th>
              <td class="border-l border-line" />
              <td class="border-l border-line" />
              <td
                v-for="column in matrix.columns"
                :key="column.instance.id"
                class="border-l border-line px-2 py-1.5 text-center font-mono text-[11px] text-muted"
              >
                {{
                  column.status === 'ok'
                    ? formatBytes(
                        column.rootFolders.reduce((sum, folder) => sum + (folder.freeSpace ?? 0), 0),
                      )
                    : '—'
                }}
              </td>
              <td class="border-l border-line" />
            </tr>
          </tfoot>
        </table>
      </div>

      <p class="text-[11px] leading-relaxed text-muted">
        Disk operations are staged like any other change: they land in Pending Fleet Changes,
        run in order with the *Arr steps, and their preflight runs again immediately before
        execution. Symlinks are shown but never followed or modified.
      </p>
    </template>

    <AddPathDialog
      v-if="adding"
      :path="adding.path"
      :preselect="adding.preselect"
      @close="adding = null"
    />
    <RemapDialog v-if="remapping" :from-path="remapping" @close="remapping = null" />
    <RemoveRootFoldersDialog v-if="removing" :targets="removing" @close="removing = null" />
    <ReconcileDialog v-if="reconciling" :path="reconciling" @close="reconciling = null" />
    <DiskOperationModal
      v-if="operation"
      :operation="operation.operation"
      :target="operation.target"
      :tracked-by="operationTrackedBy"
      @close="operation = null"
    />
  </div>
</template>
