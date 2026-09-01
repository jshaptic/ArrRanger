<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import EmptyState from '@/components/base/EmptyState.vue';
import FleetBar from '@/components/fleet/FleetBar.vue';
import InstanceColumnHeader from '@/components/fleet/InstanceColumnHeader.vue';
import ParityBadge from '@/components/fleet/ParityBadge.vue';
import AlignRootFolderDialog from '@/components/imports/AlignRootFolderDialog.vue';
import { stagedIntent, TONE_CLASSES } from '@/lib/staging';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore, type ImportListTarget } from '@/stores/queue';

const matrix = useMatrixStore();
const queue = useQueueStore();

const selectedKeys = ref<string[]>([]);
const aligning = ref<{ targets: ImportListTarget[]; names: string[] } | null>(null);

const targets = computed(() => matrix.targetInstanceIds);

const selectedRows = computed(() =>
  matrix.importListRows.filter((row) => selectedKeys.value.includes(row.key)),
);

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

function instanceName(instanceId: number): string {
  return (
    matrix.columns.find((column) => column.instance.id === instanceId)?.instance.name ??
    `instance ${String(instanceId)}`
  );
}

async function setEnabled(enabled: boolean): Promise<void> {
  await queue.setImportListEnabled(selectedTargets.value, enabled, enabled);
  selectedKeys.value = [];
}

onMounted(() => {
  if (matrix.columns.length === 0 || matrix.lastLoadedAt === null) void matrix.load();
});
</script>

<template>
  <div class="space-y-4">
    <FleetBar />

    <div class="flex flex-wrap items-center gap-2">
      <span v-if="selectedTargets.length > 0" class="text-xs text-staged">
        {{ selectedRows.length }} list(s) · {{ selectedTargets.length }} instance-level operation(s)
      </span>
      <span v-else class="text-xs text-muted">
        Select rows to enable, disable or align them across the fleet
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
        <BaseButton
          size="sm"
          :disabled="selectedTargets.length === 0"
          @click="
            aligning = {
              targets: selectedTargets,
              names: selectedRows.map((row) => row.name),
            }
          "
        >
          Align root folder…
        </BaseButton>
      </div>
    </div>

    <EmptyState
      v-if="matrix.importListRows.length === 0"
      :title="matrix.loading ? 'Loading the fleet…' : 'No import lists found'"
      description="Import lists are compared by name across instances. Creating a new list still happens in Radarr/Sonarr - ArrRanger keeps the ones you have consistent."
      icon="📥"
    />

    <div v-else class="overflow-x-auto rounded-lg border border-line">
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th
              scope="col"
              class="sticky left-0 z-20 min-w-[18rem] border-b border-line bg-raised px-3 py-2 text-left text-[11px] font-semibold text-muted"
            >
              Import list ({{ matrix.importListRows.length }})
            </th>
            <InstanceColumnHeader
              v-for="column in matrix.columns"
              :key="column.instance.id"
              :column="column"
            />
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="row in matrix.importListRows"
            :key="row.key"
            :class="selectedKeys.includes(row.key) ? 'bg-accent/5' : 'hover:bg-raised/40'"
          >
            <th
              scope="row"
              class="sticky left-0 z-10 border-b border-line px-3 py-1.5 text-left font-normal"
              :class="selectedKeys.includes(row.key) ? 'bg-[#16202b]' : 'bg-surface'"
            >
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  :checked="selectedKeys.includes(row.key)"
                  class="accent-[var(--color-accent)]"
                  @change="toggleRow(row.key)"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-ink">{{ row.name }}</span>
                  <span class="block truncate text-[10px] text-faint">{{ row.implementation }}</span>
                </span>
                <span class="flex shrink-0 flex-col items-end gap-1">
                  <ParityBadge
                    :parity="row.parity"
                    :present-on="row.presentOn.length"
                    :total="matrix.healthyColumns.length"
                  />
                  <span class="flex gap-1">
                    <span
                      v-if="row.rootFolderDrift"
                      class="rounded border border-drift/40 bg-drift/10 px-1 py-0.5 text-[9px] text-drift"
                      title="These lists point at different root folders"
                    >
                      path drift
                    </span>
                    <span
                      v-if="row.qualityProfileDrift"
                      class="rounded border border-drift/40 bg-drift/10 px-1 py-0.5 text-[9px] text-drift"
                      title="These lists use different quality profiles"
                    >
                      profile drift
                    </span>
                    <span
                      v-if="row.enabledDrift"
                      class="rounded border border-drift/40 bg-drift/10 px-1 py-0.5 text-[9px] text-drift"
                      title="Enabled on some instances, disabled on others"
                    >
                      state drift
                    </span>
                  </span>
                </span>
              </label>
            </th>

            <td
              v-for="cell in row.cells"
              :key="cell.instanceId"
              class="border-b border-l border-line p-1 text-center"
            >
              <div
                v-if="!cell.known"
                class="flex h-11 items-center justify-center rounded border border-danger/30 bg-danger/5 font-mono text-xs text-danger/60"
                :title="`${instanceName(cell.instanceId)}: instance did not answer`"
              >
                ?
              </div>
              <div
                v-else-if="cell.present"
                class="flex h-11 flex-col items-center justify-center gap-0.5 rounded border text-[10px]"
                :class="
                  stagedIntent(queue.stagedForImportList(cell.instanceId, cell.listId ?? 0))
                    ? TONE_CLASSES[
                        stagedIntent(queue.stagedForImportList(cell.instanceId, cell.listId ?? 0))!
                          .tone
                      ] + ' ring-1 ring-inset ring-current/30'
                    : 'border-line bg-raised/60'
                "
                :title="`${instanceName(cell.instanceId)} · ${cell.rootFolderPath || 'no root folder'} · profile ${cell.qualityProfileId}`"
              >
                <span class="flex items-center gap-1">
                  <span :class="cell.enabled ? 'text-sync' : 'text-faint'">
                    {{ cell.enabled ? 'on' : 'off' }}
                  </span>
                  <span v-if="cell.autoAdd" class="text-accent" title="Automatic add is enabled">
                    auto
                  </span>
                </span>
                <span class="max-w-[7rem] truncate font-mono text-[9px] text-muted">
                  {{ cell.rootFolderPath || '—' }}
                </span>
              </div>
              <div
                v-else
                class="flex h-11 items-center justify-center rounded border border-dashed border-line-strong text-xs text-faint"
                :title="`${instanceName(cell.instanceId)}: this list does not exist here`"
              >
                —
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-[11px] leading-relaxed text-muted">
      Quality profile ids are shown raw: profile names live behind an endpoint ArrRanger does not
      read yet, so aligning profiles across instances is deliberately left out rather than guessed.
    </p>

    <AlignRootFolderDialog
      v-if="aligning"
      :targets="aligning.targets"
      :names="aligning.names"
      @close="aligning = null"
    />
  </div>
</template>
