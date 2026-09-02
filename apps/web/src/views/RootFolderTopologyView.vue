<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { NewQueueItem } from '@arrranger/shared';
import BaseButton from '@/components/base/BaseButton.vue';
import EmptyState from '@/components/base/EmptyState.vue';
import FleetBar from '@/components/fleet/FleetBar.vue';
import InstanceColumnHeader from '@/components/fleet/InstanceColumnHeader.vue';
import ParityBadge from '@/components/fleet/ParityBadge.vue';
import RootCellView from '@/components/fleet/RootCellView.vue';
import AddPathDialog from '@/components/roots/AddPathDialog.vue';
import RemapDialog from '@/components/roots/RemapDialog.vue';
import RemoveRootFoldersDialog from '@/components/roots/RemoveRootFoldersDialog.vue';
import { formatBytes } from '@/lib/format';
import type { RootFolderRow } from '@/lib/matrix';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore, type RootFolderTarget } from '@/stores/queue';

const matrix = useMatrixStore();
const queue = useQueueStore();

const adding = ref<{ path: string; preselect: number[] } | null>(null);
const remapping = ref<string | null>(null);
const removing = ref<RootFolderTarget[] | null>(null);

const search = ref('');
const selectedPaths = ref<string[]>([]);

const targets = computed(() => matrix.targetInstanceIds);

const rows = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (needle.length === 0) return matrix.rootFolderRows;
  return matrix.rootFolderRows.filter((row) => row.path.toLowerCase().includes(needle));
});

const selectedRows = computed(() =>
  rows.value.filter((row) => selectedPaths.value.includes(row.path)),
);

const allVisibleSelected = computed(
  () => rows.value.length > 0 && selectedRows.value.length === rows.value.length,
);

const propagatable = computed(() =>
  selectedRows.value.flatMap((row) =>
    row.missingOn.filter((instanceId) => targets.value.includes(instanceId)),
  ),
);

const deletable = computed<RootFolderTarget[]>(() =>
  selectedRows.value.flatMap((row) =>
    row.cells
      .filter((cell) => cell.known && cell.present && targets.value.includes(cell.instanceId))
      .map((cell) => ({
        instanceId: cell.instanceId,
        rootFolderId: cell.rootFolderId ?? 0,
        path: row.path,
      })),
  ),
);

function toggleRow(path: string): void {
  selectedPaths.value = selectedPaths.value.includes(path)
    ? selectedPaths.value.filter((entry) => entry !== path)
    : [...selectedPaths.value, path];
}

function toggleAllVisible(): void {
  selectedPaths.value = allVisibleSelected.value ? [] : rows.value.map((row) => row.path);
}

function instanceName(instanceId: number): string {
  return (
    matrix.columns.find((column) => column.instance.id === instanceId)?.instance.name ??
    `instance ${String(instanceId)}`
  );
}

/** "Propagate missing path to all": one create per instance that lacks it. */
async function propagateSelected(): Promise<void> {
  const batch: NewQueueItem[] = selectedRows.value.flatMap((row) =>
    row.missingOn
      .filter((instanceId) => targets.value.includes(instanceId))
      .map((instanceId) => ({
        instanceId,
        op: 'rootFolder.create' as const,
        payload: { path: row.path },
      })),
  );

  await queue.stage(
    batch,
    `${String(selectedRows.value.length)} root folder(s) on ${String(new Set(batch.map((item) => item.instanceId)).size)} instance(s)`,
  );
  selectedPaths.value = [];
}

function propagateRow(row: RootFolderRow): void {
  adding.value = {
    path: row.path,
    preselect: row.missingOn.filter((instanceId) => targets.value.includes(instanceId)),
  };
}

function removeRow(row: RootFolderRow): void {
  removing.value = row.cells
    .filter((cell) => cell.known && cell.present && targets.value.includes(cell.instanceId))
    .map((cell) => ({
      instanceId: cell.instanceId,
      rootFolderId: cell.rootFolderId ?? 0,
      path: row.path,
    }));
}

function stageCellCreate(row: RootFolderRow, instanceId: number): void {
  void queue.createRootFolderAcross(row.path, [instanceId]);
}

function stageCellRemove(row: RootFolderRow, instanceId: number, rootFolderId: number | null): void {
  removing.value = [{ instanceId, rootFolderId: rootFolderId ?? 0, path: row.path }];
}

onMounted(() => {
  if (matrix.columns.length === 0 || matrix.lastLoadedAt === null) void matrix.load();
});
</script>

<template>
  <div class="space-y-4">
    <FleetBar />

    <div class="flex flex-wrap items-center gap-2">
      <input
        v-model="search"
        type="search"
        placeholder="Filter paths…"
        class="h-9 w-48 rounded-md border border-line bg-raised px-3 text-sm text-ink outline-none focus:border-accent"
      />
      <BaseButton size="sm" variant="primary" @click="adding = { path: '', preselect: [] }">
        Add path to fleet…
      </BaseButton>
      <span class="text-[11px] text-muted">
        {{ matrix.healthyColumns.length }} instance(s) compared
      </span>

      <span v-if="selectedRows.length > 0" class="text-xs text-staged">
        {{ selectedRows.length }} row(s) selected
      </span>

      <div class="ml-auto flex flex-wrap items-center gap-2">
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

    <EmptyState
      v-if="matrix.rootFolderRows.length === 0"
      :title="matrix.loading ? 'Loading the fleet…' : 'No root folders found'"
      description="Root folders come from each instance's /api/v3/rootfolder. Add one here to stage it across several instances at once."
      icon="🗄"
    />

    <EmptyState v-else-if="rows.length === 0" title="No paths match this filter" description="Clear the filter to see every root folder in the fleet." />

    <div v-else class="overflow-x-auto rounded-lg border border-line">
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th
              scope="col"
              class="sticky left-0 z-20 min-w-[18rem] border-b border-line bg-raised px-3 py-2 text-left"
            >
              <label class="flex items-center gap-2 text-[11px] font-semibold text-muted">
                <input
                  type="checkbox"
                  :checked="allVisibleSelected"
                  class="accent-[var(--color-accent)]"
                  @change="toggleAllVisible()"
                />
                Path ({{ rows.length }})
              </label>
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
          <tr
            v-for="row in rows"
            :key="row.path"
            class="group"
            :class="selectedPaths.includes(row.path) ? 'bg-accent/5' : 'hover:bg-raised/40'"
          >
            <th
              scope="row"
              class="sticky left-0 z-10 border-b border-line px-3 py-1.5 text-left font-normal"
              :class="selectedPaths.includes(row.path) ? 'bg-[#16202b]' : 'bg-surface'"
            >
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  :checked="selectedPaths.includes(row.path)"
                  class="accent-[var(--color-accent)]"
                  @change="toggleRow(row.path)"
                />
                <span class="min-w-0 flex-1 truncate font-mono text-ink" :title="row.path">
                  {{ row.path }}
                </span>
                <ParityBadge
                  :parity="row.parity"
                  :present-on="row.presentOn.length"
                  :total="matrix.healthyColumns.length"
                />
                <span
                  v-if="row.inaccessibleOn.length > 0"
                  class="rounded border border-danger/40 bg-danger/10 px-1 py-0.5 text-[10px] text-danger"
                  :title="`Not accessible on: ${row.inaccessibleOn.map(instanceName).join(', ')}`"
                >
                  ⚠ {{ row.inaccessibleOn.length }}
                </span>
              </label>
            </th>

            <RootCellView
              v-for="cell in row.cells"
              :key="cell.instanceId"
              :cell="cell"
              :path="row.path"
              :instance-name="instanceName(cell.instanceId)"
              :staged="queue.stagedForRootFolder(cell.instanceId, row.path)"
              @create="stageCellCreate(row, cell.instanceId)"
              @remove="stageCellRemove(row, cell.instanceId, cell.rootFolderId)"
            />

            <td class="border-b border-l border-line px-2 py-1.5 text-right whitespace-nowrap">
              <span class="inline-flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <BaseButton
                  size="sm"
                  variant="ghost"
                  :disabled="row.missingOn.length === 0"
                  title="Stage this path on the instances missing it"
                  @click="propagateRow(row)"
                >
                  propagate
                </BaseButton>
                <BaseButton size="sm" variant="ghost" title="Move media to another path" @click="remapping = row.path">
                  re-map
                </BaseButton>
                <BaseButton size="sm" variant="ghost" title="Remove from the targeted instances" @click="removeRow(row)">
                  remove
                </BaseButton>
              </span>
            </td>
          </tr>
        </tbody>

        <tfoot>
          <tr class="bg-raised/40">
            <th
              scope="row"
              class="sticky left-0 z-10 bg-raised px-3 py-1.5 text-left text-[11px] font-medium text-muted"
            >
              free space
            </th>
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

    <AddPathDialog
      v-if="adding"
      :path="adding.path"
      :preselect="adding.preselect"
      @close="adding = null"
    />
    <RemapDialog v-if="remapping" :from-path="remapping" @close="remapping = null" />
    <RemoveRootFoldersDialog v-if="removing" :targets="removing" @close="removing = null" />
  </div>
</template>
