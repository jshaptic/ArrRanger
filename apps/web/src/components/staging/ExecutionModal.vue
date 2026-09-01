<script setup lang="ts">
import { computed } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import { initialsOf } from '@/lib/format';
import { presentOp, STATUS_CLASSES, STATUS_LABELS } from '@/lib/staging';
import { useInstancesStore } from '@/stores/instances';
import { useQueueStore } from '@/stores/queue';
import { useUiStore } from '@/stores/ui';

const queue = useQueueStore();
const ui = useUiStore();
const instances = useInstancesStore();

const run = computed(() => queue.activeRun);
const steps = computed(() => [...queue.runItems].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
const finished = computed(() => {
  const status = run.value?.status;
  return status === 'completed' || status === 'failed' || status === 'cancelled';
});

const barClass = computed(() => {
  const status = run.value?.status;
  if (status === 'paused') return 'bg-drift';
  if (status === 'failed') return 'bg-danger';
  if (status === 'completed') return 'bg-sync';
  if (status === 'cancelled') return 'bg-faint';
  return 'bg-accent';
});

const headline = computed(() => {
  const status = run.value?.status;
  switch (status) {
    case 'running':
      return 'Applying staged changes';
    case 'paused':
      return 'Queue halted on a failed step';
    case 'completed':
      return 'All operations applied';
    case 'failed':
      return 'Run finished with failures';
    case 'cancelled':
      return 'Run cancelled';
    default:
      return 'Run';
  }
});

function instanceName(instanceId: number | null): string {
  if (instanceId === null) return 'Local storage';
  return instances.byId.get(instanceId)?.name ?? `instance ${String(instanceId)}`;
}
</script>

<template>
  <BaseModal
    v-if="ui.executionOpen && run"
    :title="headline"
    :subtitle="`Run #${run.id} · on failure: ${run.onError}`"
    width="xl"
    :closable="finished"
    @close="ui.closeExecution()"
  >
    <div class="space-y-4">
      <!-- progress -->
      <div>
        <div class="mb-1.5 flex items-end justify-between text-xs">
          <span class="text-muted">
            step {{ run.succeededItems + run.failedItems + run.skippedItems }} of {{ run.totalItems }}
          </span>
          <span class="font-mono text-ink">{{ queue.runProgress }}%</span>
        </div>
        <div class="h-2 overflow-hidden rounded-full bg-raised">
          <div
            class="h-full rounded-full transition-all duration-300"
            :class="barClass"
            :style="{ width: `${queue.runProgress}%` }"
          />
        </div>
        <div class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <span class="text-sync">{{ run.succeededItems }} succeeded</span>
          <span class="text-danger">{{ run.failedItems }} failed</span>
          <span class="text-drift">{{ run.skippedItems }} skipped</span>
          <span v-if="queue.streaming" class="ml-auto text-faint">live</span>
        </div>
      </div>

      <!-- active target -->
      <div
        v-if="queue.currentItem"
        class="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2"
      >
        <span class="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
        <div class="min-w-0">
          <p class="truncate text-xs text-ink">{{ queue.currentItem.summary }}</p>
          <p class="text-[11px] text-muted">
            on {{ queue.currentInstance?.name ?? instanceName(queue.currentItem.instanceId) }}
            · {{ presentOp(queue.currentItem.op).label }}
          </p>
        </div>
      </div>

      <div
        v-else-if="run.status === 'paused'"
        class="rounded-lg border border-drift/40 bg-drift/5 px-3 py-2 text-xs text-drift"
      >
        Nothing after the failed step has run. Fix the cause on the instance, then retry it -
        or skip it to continue with the rest.
      </div>

      <!-- steps -->
      <div class="max-h-64 overflow-y-auto rounded-lg border border-line">
        <table class="w-full text-left text-xs">
          <tbody>
            <tr
              v-for="(step, index) in steps"
              :key="step.id"
              class="border-b border-line last:border-b-0"
              :class="step.id === queue.currentItemId ? 'bg-accent/5' : ''"
            >
              <td class="w-8 px-2 py-1.5 text-right font-mono text-[11px] text-faint">
                {{ index + 1 }}
              </td>
              <td class="px-2 py-1.5">
                <span :class="step.status === 'cancelled' ? 'line-through opacity-60' : ''">
                  {{ step.summary }}
                </span>
                <p v-if="step.error" class="font-mono text-[11px] text-danger">
                  {{ step.error.code }}: {{ step.error.message }}
                </p>
              </td>
              <td class="px-2 py-1.5 whitespace-nowrap">
                <span class="inline-flex items-center gap-1 text-[11px] text-muted">
                  <span class="font-mono text-[10px] text-faint">
                    {{ initialsOf(instanceName(step.instanceId)) }}
                  </span>
                  {{ instanceName(step.instanceId) }}
                </span>
              </td>
              <td class="w-20 px-2 py-1.5 text-right">
                <span class="rounded border px-1.5 py-0.5 text-[10px]" :class="STATUS_CLASSES[step.status]">
                  {{ STATUS_LABELS[step.status] }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- log tail -->
      <div v-if="queue.runLog.length > 0" class="rounded-lg border border-line bg-surface/60">
        <p class="border-b border-line px-3 py-1.5 text-[11px] font-semibold text-muted">Log</p>
        <ul class="max-h-32 space-y-0.5 overflow-y-auto px-3 py-2 font-mono text-[11px]">
          <li
            v-for="(entry, index) in queue.runLog.slice(-40)"
            :key="index"
            :class="{
              'text-danger': entry.level === 'error',
              'text-drift': entry.level === 'warn',
              'text-muted': entry.level === 'info',
            }"
          >
            {{ entry.message }}
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <BaseButton
        v-if="run.status === 'running'"
        variant="danger"
        :loading="queue.busy"
        title="Abort the in-flight step and stand down everything queued"
        @click="queue.cancel()"
      >
        Halt run
      </BaseButton>

      <template v-if="run.status === 'paused'">
        <BaseButton variant="ghost" :loading="queue.busy" @click="queue.cancel()">
          Cancel run
        </BaseButton>
        <BaseButton variant="secondary" :loading="queue.busy" @click="queue.resume({ skipFailed: true })">
          Skip failed &amp; continue
        </BaseButton>
        <BaseButton variant="primary" :loading="queue.busy" @click="queue.resume({ retryFailed: true })">
          Retry failed &amp; continue
        </BaseButton>
      </template>

      <BaseButton v-if="finished" variant="primary" @click="ui.closeExecution()">Close</BaseButton>
    </template>
  </BaseModal>
</template>
