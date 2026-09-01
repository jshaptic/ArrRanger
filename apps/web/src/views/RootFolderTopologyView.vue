<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import EmptyState from '@/components/base/EmptyState.vue';
import FleetBar from '@/components/fleet/FleetBar.vue';
import InstanceColumnHeader from '@/components/fleet/InstanceColumnHeader.vue';
import MatrixLegend from '@/components/fleet/MatrixLegend.vue';
import ParityBadge from '@/components/fleet/ParityBadge.vue';
import RootCellView from '@/components/fleet/RootCellView.vue';
import AddPathDialog from '@/components/roots/AddPathDialog.vue';
import RemapDialog from '@/components/roots/RemapDialog.vue';
import { formatBytes } from '@/lib/format';
import type { RootFolderRow } from '@/lib/matrix';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore, type RootFolderTarget } from '@/stores/queue';

const matrix = useMatrixStore();
const queue = useQueueStore();

const adding = ref<{ path: string; preselect: number[] } | null>(null);
const remapping = ref<string | null>(null);

const targets = computed(() => matrix.targetInstanceIds);

function instanceName(instanceId: number): string {
  return (
    matrix.columns.find((column) => column.instance.id === instanceId)?.instance.name ??
    `instance ${String(instanceId)}`
  );
}

function propagateRow(row: RootFolderRow): void {
  adding.value = {
    path: row.path,
    preselect: row.missingOn.filter((instanceId) => targets.value.includes(instanceId)),
  };
}

function removeRow(row: RootFolderRow): void {
  const removals: RootFolderTarget[] = row.cells
    .filter((cell) => cell.known && cell.present && targets.value.includes(cell.instanceId))
    .map((cell) => ({
      instanceId: cell.instanceId,
      rootFolderId: cell.rootFolderId ?? 0,
      path: row.path,
    }));
  void queue.deleteRootFolderAcross(removals);
}

function stageCellCreate(row: RootFolderRow, instanceId: number): void {
  void queue.createRootFolderAcross(row.path, [instanceId]);
}

function stageCellRemove(row: RootFolderRow, instanceId: number, rootFolderId: number | null): void {
  void queue.deleteRootFolderAcross([
    { instanceId, rootFolderId: rootFolderId ?? 0, path: row.path },
  ]);
}

onMounted(() => {
  if (matrix.columns.length === 0 || matrix.lastLoadedAt === null) void matrix.load();
});
</script>

<template>
  <div class="space-y-4">
    <FleetBar />

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="rounded-lg border border-line bg-raised/60 px-3 py-2">
        <p class="text-[11px] text-muted">Distinct paths</p>
        <p class="font-mono text-lg text-ink">{{ matrix.stats.rootFoldersTotal }}</p>
      </div>
      <div class="rounded-lg border border-sync/30 bg-sync/5 px-3 py-2">
        <p class="text-[11px] text-muted">On every instance</p>
        <p class="font-mono text-lg text-sync">{{ matrix.stats.rootFoldersInSync }}</p>
      </div>
      <div class="rounded-lg border border-drift/30 bg-drift/5 px-3 py-2">
        <p class="text-[11px] text-muted">Mount-point conflicts</p>
        <p class="font-mono text-lg text-drift">{{ matrix.stats.pathDiscrepancies }}</p>
      </div>
      <div class="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
        <p class="text-[11px] text-muted">Inaccessible</p>
        <p class="font-mono text-lg text-danger">{{ matrix.stats.rootFoldersInaccessible }}</p>
      </div>
    </div>

    <!-- discrepancy report: the reason this view exists -->
    <section
      v-if="matrix.pathDiscrepancies.length > 0"
      class="rounded-lg border border-drift/40 bg-drift/5 px-4 py-3"
    >
      <h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-drift">
        ⚠ Sibling instances disagree on {{ matrix.pathDiscrepancies.length }} mount point(s)
      </h2>
      <ul class="space-y-2.5">
        <li v-for="discrepancy in matrix.pathDiscrepancies" :key="discrepancy.leaf">
          <p class="mb-1 text-[11px] text-muted">
            library <span class="font-mono text-ink">{{ discrepancy.leaf }}</span> is mounted as
            {{ discrepancy.variants.length }} different paths:
          </p>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="variant in discrepancy.variants"
              :key="variant.path"
              class="flex items-center gap-2 rounded border border-line bg-raised px-2 py-1 text-[11px]"
            >
              <span class="font-mono text-ink">{{ variant.path }}</span>
              <span class="text-faint">
                {{ variant.instanceIds.map(instanceName).join(', ') }}
              </span>
              <button
                type="button"
                class="text-accent hover:underline"
                title="Move media out of this path onto a shared one"
                @click="remapping = variant.path"
              >
                re-map
              </button>
            </span>
          </div>
        </li>
      </ul>
      <p class="mt-2 text-[11px] leading-relaxed text-muted">
        Same library, different container mappings. Re-mapping only rewrites the root folder
        assignment unless you explicitly ask *Arr to move the files.
      </p>
    </section>

    <div class="flex flex-wrap items-center gap-2">
      <BaseButton size="sm" variant="primary" @click="adding = { path: '', preselect: [] }">
        Add path to fleet…
      </BaseButton>
      <span class="text-[11px] text-muted">
        {{ matrix.healthyColumns.length }} instance(s) compared
      </span>
      <MatrixLegend class="ml-auto hidden max-w-xl lg:flex" />
    </div>

    <EmptyState
      v-if="matrix.rootFolderRows.length === 0"
      :title="matrix.loading ? 'Loading the fleet…' : 'No root folders found'"
      description="Root folders come from each instance's /api/v3/rootfolder. Add one here to stage it across several instances at once."
      icon="🗄"
    />

    <div v-else class="overflow-x-auto rounded-lg border border-line">
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th
              scope="col"
              class="sticky left-0 z-20 min-w-[18rem] border-b border-line bg-raised px-3 py-2 text-left text-[11px] font-semibold text-muted"
            >
              Path ({{ matrix.rootFolderRows.length }})
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
          <tr v-for="row in matrix.rootFolderRows" :key="row.path" class="group hover:bg-raised/40">
            <th
              scope="row"
              class="sticky left-0 z-10 border-b border-line bg-surface px-3 py-1.5 text-left font-normal"
            >
              <div class="flex items-center gap-2">
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
              </div>
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
  </div>
</template>
