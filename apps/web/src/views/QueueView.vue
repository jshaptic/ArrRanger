<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { QueueItemDetailResponse, QueueRun } from '@arrranger/shared';
import { queueApi } from '@/api/queue';
import BaseButton from '@/components/base/BaseButton.vue';
import EmptyState from '@/components/base/EmptyState.vue';
import ImpactSummary from '@/components/staging/ImpactSummary.vue';
import StagedOperationRow from '@/components/staging/StagedOperationRow.vue';
import { formatRelativeTime, initialsOf } from '@/lib/format';
import { useQueueStore } from '@/stores/queue';
import { useUiStore } from '@/stores/ui';

const queue = useQueueStore();
const ui = useUiStore();

const grouping = ref<'sequence' | 'instance'>('sequence');
const runs = ref<QueueRun[]>([]);
const detail = ref<QueueItemDetailResponse | null>(null);
const loadingDetail = ref(false);

const positions = computed(
  () => new Map(queue.executionOrder.map((item, index) => [item.id, index + 1])),
);

const RUN_STATUS_CLASSES: Record<QueueRun['status'], string> = {
  running: 'border-accent/50 bg-accent/10 text-accent',
  paused: 'border-drift/50 bg-drift/10 text-drift',
  completed: 'border-sync/50 bg-sync/10 text-sync',
  failed: 'border-danger/50 bg-danger/10 text-danger',
  cancelled: 'border-line bg-raised text-faint',
};

async function loadRuns(): Promise<void> {
  runs.value = [...(await queueApi.runs()).runs];
}

async function inspect(itemId: number): Promise<void> {
  loadingDetail.value = true;
  try {
    detail.value = await queueApi.detail(itemId);
  } finally {
    loadingDetail.value = false;
  }
}

onMounted(() => {
  void queue.load();
  void loadRuns();
});
</script>

<template>
  <div class="space-y-5">
    <!-- staged -->
    <section class="space-y-3">
      <div class="flex flex-wrap items-center gap-3">
        <ImpactSummary />
        <div class="ml-auto flex items-center gap-2">
          <div class="flex rounded-md border border-line p-0.5 text-[11px]">
            <button
              type="button"
              class="rounded px-2 py-1 transition-colors"
              :class="grouping === 'sequence' ? 'bg-raised text-ink' : 'text-muted hover:text-ink'"
              @click="grouping = 'sequence'"
            >
              Execution order
            </button>
            <button
              type="button"
              class="rounded px-2 py-1 transition-colors"
              :class="grouping === 'instance' ? 'bg-raised text-ink' : 'text-muted hover:text-ink'"
              @click="grouping = 'instance'"
            >
              By instance
            </button>
          </div>
          <BaseButton
            v-if="queue.finished.length > 0"
            size="sm"
            variant="ghost"
            @click="queue.clearFinished()"
          >
            Clear finished
          </BaseButton>
          <BaseButton
            variant="primary"
            size="sm"
            :disabled="queue.staged.length === 0 || queue.isRunning"
            @click="queue.start('pause')"
          >
            Apply All
          </BaseButton>
        </div>
      </div>

      <EmptyState
        v-if="queue.items.length === 0"
        title="The queue is empty"
        description="Stage changes from the Tag Parity Matrix or the Root Folder Topology view. Nothing reaches Radarr or Sonarr until you apply the queue."
        icon="🧮"
      />

      <ul v-else-if="grouping === 'sequence'" class="space-y-1.5">
        <StagedOperationRow
          v-for="item in [...queue.items].sort((a, b) => a.sortOrder - b.sortOrder)"
          :key="item.id"
          :item="item"
          :position="positions.get(item.id) ?? null"
          @remove="queue.removeItem(item.id)"
          @retry="queue.retryItem(item.id)"
          @up="queue.move(item.id, -1)"
          @down="queue.move(item.id, 1)"
        />
      </ul>

      <div v-else class="space-y-4">
        <div v-for="group in queue.groupedByInstance" :key="group.instanceId">
          <h3 class="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-muted">
            <span class="font-mono text-[10px] text-faint">
              {{ group.instance === null ? 'FS' : initialsOf(group.label) }}
            </span>
            {{ group.label }}
            <span class="text-faint">· {{ group.items.length }} operation(s)</span>
          </h3>
          <ul class="space-y-1.5">
            <StagedOperationRow
              v-for="item in group.items"
              :key="item.id"
              :item="item"
              :position="positions.get(item.id) ?? null"
              @remove="queue.removeItem(item.id)"
              @retry="queue.retryItem(item.id)"
              @up="queue.move(item.id, -1)"
              @down="queue.move(item.id, 1)"
            />
          </ul>
        </div>
      </div>
    </section>

    <!-- failures: the audit trail is the point of this section -->
    <section v-if="queue.failed.length > 0" class="space-y-2">
      <h2 class="text-sm font-semibold text-danger">Failed operations</h2>
      <ul class="space-y-1.5">
        <li
          v-for="item in queue.failed"
          :key="item.id"
          class="rounded-md border border-danger/40 bg-danger/5 px-3 py-2"
        >
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="text-ink">{{ item.summary }}</span>
            <span class="font-mono text-[11px] text-danger">{{ item.error?.code }}</span>
            <BaseButton
              class="ml-auto"
              size="sm"
              variant="ghost"
              :loading="loadingDetail"
              @click="inspect(item.id)"
            >
              inspect *Arr exchange
            </BaseButton>
          </div>
          <p class="mt-1 font-mono text-[11px] text-danger/90">{{ item.error?.message }}</p>
        </li>
      </ul>
    </section>

    <!-- run history -->
    <section class="space-y-2">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-ink">Recent runs</h2>
        <BaseButton size="sm" variant="ghost" @click="loadRuns()">refresh</BaseButton>
        <BaseButton
          v-if="queue.activeRun"
          class="ml-auto"
          size="sm"
          variant="secondary"
          @click="ui.openExecution()"
        >
          Open progress
        </BaseButton>
      </div>

      <p v-if="runs.length === 0" class="text-xs text-faint">No runs yet.</p>

      <div v-else class="overflow-x-auto rounded-lg border border-line">
        <table class="w-full text-left text-xs">
          <thead class="bg-raised/60 text-[11px] text-muted">
            <tr>
              <th class="px-3 py-2 font-semibold">Run</th>
              <th class="px-3 py-2 font-semibold">Status</th>
              <th class="px-3 py-2 font-semibold">Result</th>
              <th class="px-3 py-2 font-semibold">On failure</th>
              <th class="px-3 py-2 font-semibold">Started</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in runs" :key="run.id" class="border-t border-line">
              <td class="px-3 py-2 font-mono text-[11px] text-muted">#{{ run.id }}</td>
              <td class="px-3 py-2">
                <span class="rounded border px-1.5 py-0.5 text-[10px]" :class="RUN_STATUS_CLASSES[run.status]">
                  {{ run.status }}
                </span>
              </td>
              <td class="px-3 py-2 text-[11px]">
                <span class="text-sync">{{ run.succeededItems }} ok</span>
                <span v-if="run.failedItems > 0" class="ml-2 text-danger">
                  {{ run.failedItems }} failed
                </span>
                <span v-if="run.skippedItems > 0" class="ml-2 text-drift">
                  {{ run.skippedItems }} skipped
                </span>
                <span class="ml-2 text-faint">of {{ run.totalItems }}</span>
              </td>
              <td class="px-3 py-2 text-[11px] text-muted">{{ run.onError }}</td>
              <td class="px-3 py-2 text-[11px] text-muted">
                {{ formatRelativeTime(run.startedAt) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- audit trail -->
    <Teleport v-if="detail" to="body">
      <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8">
        <div class="w-full max-w-3xl rounded-xl border border-line bg-overlay">
          <header class="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 class="text-base font-semibold text-ink">{{ detail.item.summary }}</h2>
              <p class="mt-1 font-mono text-[11px] text-muted">
                {{ detail.item.op }} · attempt {{ detail.item.attempts }}
              </p>
            </div>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-muted hover:bg-raised hover:text-ink"
              @click="detail = null"
            >
              ✕
            </button>
          </header>
          <div class="max-h-[70vh] space-y-2 overflow-y-auto px-5 py-4">
            <div
              v-for="event in detail.events"
              :key="event.id"
              class="rounded border border-line bg-raised/40 px-3 py-2"
            >
              <div class="flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  class="rounded border px-1.5 py-0.5"
                  :class="
                    event.level === 'error'
                      ? 'border-danger/40 text-danger'
                      : 'border-line text-muted'
                  "
                >
                  {{ event.level }}
                </span>
                <span v-if="event.httpMethod" class="font-mono text-muted">
                  {{ event.httpMethod }} {{ event.httpStatus ?? '' }}
                </span>
                <span class="truncate font-mono text-faint">{{ event.httpUrl }}</span>
              </div>
              <p class="mt-1 text-xs text-ink">{{ event.message }}</p>
              <pre
                v-if="event.requestBody"
                class="mt-1.5 overflow-x-auto rounded bg-surface px-2 py-1.5 font-mono text-[10px] text-muted"
              >request: {{ event.requestBody }}</pre>
              <pre
                v-if="event.responseBody"
                class="mt-1 overflow-x-auto rounded bg-surface px-2 py-1.5 font-mono text-[10px] text-muted"
              >response: {{ event.responseBody }}</pre>
            </div>
            <p v-if="detail.events.length === 0" class="text-xs text-faint">
              No *Arr exchanges recorded for this operation yet.
            </p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
