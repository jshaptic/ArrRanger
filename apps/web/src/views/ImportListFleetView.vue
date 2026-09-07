<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseCheckbox from '@/components/base/BaseCheckbox.vue';
import EmptyState from '@/components/base/EmptyState.vue';
import FleetBar from '@/components/fleet/FleetBar.vue';
import AddImportListDialog from '@/components/imports/AddImportListDialog.vue';
import ImportListInstanceChips from '@/components/imports/ImportListInstanceChips.vue';
import IconImportList from '@/components/base/icons/IconImportList.vue';
import { canCloneImportList, importListOwners } from '@/lib/import-lists';
import type { ImportListRow } from '@/lib/matrix';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore, type ImportListTarget } from '@/stores/queue';

const matrix = useMatrixStore();
const queue = useQueueStore();

const search = ref('');
const selectedKeys = ref<string[]>([]);
const cloning = ref<ImportListRow | null>(null);

const rows = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (needle.length === 0) return matrix.importListRows;
  return matrix.importListRows.filter((row) => row.name.toLowerCase().includes(needle));
});

const selectedRows = computed(() =>
  rows.value.filter((row) => selectedKeys.value.includes(row.key)),
);

const allVisibleSelected = computed(
  () => rows.value.length > 0 && selectedRows.value.length === rows.value.length,
);

const someVisibleSelected = computed(
  () => !allVisibleSelected.value && selectedRows.value.length > 0,
);

const targets = computed(() => matrix.targetInstanceIds);

/** Every present list on a targeted instance, for the selected rows. */
const selectedTargets = computed<ImportListTarget[]>(() =>
  selectedRows.value.flatMap((row) =>
    row.cells
      .filter((cell) => cell.known && cell.present && targets.value.includes(cell.instanceId))
      .map((cell) => ({ instanceId: cell.instanceId, importListId: cell.listId ?? 0 })),
  ),
);

function toggleRow(key: string): void {
  selectedKeys.value = selectedKeys.value.includes(key)
    ? selectedKeys.value.filter((entry) => entry !== key)
    : [...selectedKeys.value, key];
}

function toggleAllVisible(): void {
  selectedKeys.value = allVisibleSelected.value ? [] : rows.value.map((row) => row.key);
}

function ownersOf(row: ImportListRow) {
  return importListOwners(row, matrix.columns);
}

function pendingOf(row: ImportListRow) {
  return matrix.columns.flatMap((column) => {
    if (column.status !== 'ok' || row.presentOn.includes(column.instance.id)) return [];
    if (queue.stagedForImportListName(column.instance.id, row.name).length === 0) return [];
    return [
      {
        instanceId: column.instance.id,
        name: column.instance.name,
        kind: column.instance.kind,
      },
    ];
  });
}

async function setEnabled(enabled: boolean): Promise<void> {
  await queue.setImportListEnabled(selectedTargets.value, enabled, enabled);
  selectedKeys.value = [];
}

async function setOwnerEnabled(target: {
  instanceId: number;
  importListId: number;
  enabled: boolean;
}): Promise<void> {
  await queue.setImportListEnabled([target], target.enabled, target.enabled);
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
        placeholder="Filter lists…"
        class="h-9 w-48 rounded-md border border-line bg-raised px-3 text-sm text-ink outline-none focus:border-accent"
      />

      <span v-if="selectedTargets.length > 0" class="text-xs text-staged">
        {{ selectedRows.length }} list(s) · {{ selectedTargets.length }} instance-level operation(s)
      </span>
      <span v-else class="text-xs text-muted">
        Select rows to enable or disable them across the fleet
      </span>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <BaseButton
          size="sm"
          variant="success"
          :disabled="selectedTargets.length === 0"
          @click="setEnabled(true)"
        >
          Enable ({{ selectedTargets.length }})
        </BaseButton>
        <BaseButton
          size="sm"
          :disabled="selectedTargets.length === 0"
          @click="setEnabled(false)"
        >
          Disable
        </BaseButton>
      </div>
    </div>

    <EmptyState
      v-if="matrix.columns.length === 0"
      title="No instances connected"
      description="Import lists come from every connected Radarr and Sonarr. Add a list on one instance, then copy it onto others from here."
      :icon="IconImportList"
    />

    <EmptyState
      v-else-if="rows.length === 0"
      :title="matrix.loading ? 'Loading the fleet…' : 'No import lists match this filter'"
      :description="
        matrix.loading
          ? 'Reading import lists from every instance in parallel.'
          : 'Clear the filter, or add a list in Radarr/Sonarr and refresh the fleet.'
      "
      :icon="IconImportList"
    />

    <div v-else class="space-y-2">
      <p
        v-if="matrix.failedColumns.length > 0"
        class="text-[11px] text-danger"
        data-testid="unknown-instances"
      >
        {{ matrix.failedColumns.length }} instance(s) did not answer
        ({{ matrix.failedColumns.map((column) => column.instance.name).join(', ') }}) - the
        Instances column below is incomplete for them. Unknown, deliberately not "missing".
      </p>

      <div class="overflow-x-auto rounded-lg border border-line">
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th
                scope="col"
                class="sticky left-0 z-20 min-w-[22rem] border-b border-line bg-raised px-3 py-2 text-left"
              >
                <label class="flex items-center gap-2 text-[11px] font-semibold text-muted">
                  <BaseCheckbox
                    :model-value="allVisibleSelected"
                    :indeterminate="someVisibleSelected"
                    @change="toggleAllVisible()"
                  />
                  Import list ({{ rows.length }})
                </label>
              </th>
              <th
                scope="col"
                class="border-b border-l border-line bg-raised px-3 py-2 text-left text-[11px] font-semibold text-muted"
              >
                Instances
              </th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="row in rows"
              :key="row.key"
              :class="selectedKeys.includes(row.key) ? 'bg-accent/5' : 'hover:bg-raised/40'"
            >
              <th
                scope="row"
                class="sticky left-0 z-10 border-b border-line px-3 py-1.5 text-left font-normal"
                :class="selectedKeys.includes(row.key) ? 'bg-[#16202b]' : 'bg-surface'"
              >
                <label class="flex items-center gap-2">
                  <BaseCheckbox
                    :model-value="selectedKeys.includes(row.key)"
                    @change="toggleRow(row.key)"
                  />
                  <span class="min-w-0 flex-1">
                    <span data-name class="block truncate text-ink">{{ row.name }}</span>
                    <span class="block truncate text-[10px] text-faint">{{ row.implementation }}</span>
                  </span>
                </label>
              </th>

              <ImportListInstanceChips
                :owners="ownersOf(row)"
                :row="row"
                :unknown-count="matrix.failedColumns.length"
                :can-add="canCloneImportList(row, matrix.columns)"
                :staged="queue.stagedForImportList"
                :pending="pendingOf(row)"
                @set-enabled="setOwnerEnabled"
                @add="cloning = row"
              />
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <AddImportListDialog v-if="cloning" :row="cloning" @close="cloning = null" />
  </div>
</template>
