<script setup lang="ts">
import { computed } from 'vue';
import type { QueueItem } from '@arrranger/shared';
import BaseButton from '@/components/base/BaseButton.vue';
import { initialsOf } from '@/lib/format';
import { isDestructive, presentOp, STATUS_CLASSES, STATUS_LABELS, TONE_CLASSES } from '@/lib/staging';
import { useInstancesStore } from '@/stores/instances';

const props = withDefaults(
  defineProps<{
    item: QueueItem;
    position?: number | null;
    reorderable?: boolean;
    removable?: boolean;
  }>(),
  { position: null, reorderable: true, removable: true },
);

const emit = defineEmits<{ remove: []; up: []; down: []; retry: [] }>();

const instances = useInstancesStore();

const instance = computed(() =>
  props.item.instanceId === null ? null : (instances.byId.get(props.item.instanceId) ?? null),
);
/** Filesystem work is not addressed to an instance - it happens on this container's disk. */
const isLocal = computed(() => props.item.instanceId === null);
const op = computed(() => presentOp(props.item.op));
const destructive = computed(() => isDestructive(props.item));
</script>

<template>
  <li
    class="flex items-start gap-3 rounded-md border px-3 py-2"
    :class="
      item.status === 'failed'
        ? 'border-danger/40 bg-danger/5'
        : 'border-line bg-raised/60 hover:border-line-strong'
    "
  >
    <span
      v-if="position !== null"
      class="mt-0.5 w-5 shrink-0 text-right font-mono text-[11px] text-faint"
    >
      {{ position }}
    </span>

    <span
      class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs"
      :class="TONE_CLASSES[op.tone]"
      :title="op.label"
    >
      {{ op.icon }}
    </span>

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="text-xs text-ink" :class="item.status === 'cancelled' ? 'line-through opacity-60' : ''">
          {{ item.summary }}
        </span>
        <span
          v-if="isLocal"
          class="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-1.5 py-0.5 text-[10px] text-accent"
          title="Runs on the storage mounted into this container"
        >
          <span class="font-mono">FS</span>
          Local storage
        </span>
        <span
          v-else
          class="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted"
          :title="instance?.baseUrl ?? ''"
        >
          <span class="font-mono">{{ initialsOf(instance?.name ?? '??') }}</span>
          {{ instance?.name ?? `instance ${item.instanceId}` }}
        </span>
        <span
          class="rounded border px-1.5 py-0.5 text-[10px]"
          :class="STATUS_CLASSES[item.status]"
        >
          {{ STATUS_LABELS[item.status] }}
        </span>
        <span v-if="destructive" class="text-[10px] text-danger" title="This operation removes or moves data">
          ⚠ destructive
        </span>
        <span v-if="item.affectedCount > 1" class="text-[10px] text-faint">
          {{ item.affectedCount }} items
        </span>
        <span v-if="item.dependsOnId !== null" class="text-[10px] text-staged">
          waits for #{{ item.dependsOnId }}
        </span>
      </div>

      <p v-if="item.error" class="mt-1 font-mono text-[11px] leading-relaxed text-danger">
        {{ item.error.code }}<span v-if="item.error.httpStatus"> ({{ item.error.httpStatus }})</span>:
        {{ item.error.message }}
      </p>
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <BaseButton
        v-if="item.status === 'failed'"
        size="sm"
        variant="ghost"
        title="Put this operation back in the queue"
        @click="emit('retry')"
      >
        retry
      </BaseButton>
      <template v-if="reorderable && item.status === 'pending'">
        <BaseButton size="sm" variant="ghost" title="Run earlier" @click="emit('up')">↑</BaseButton>
        <BaseButton size="sm" variant="ghost" title="Run later" @click="emit('down')">↓</BaseButton>
      </template>
      <BaseButton
        v-if="removable && item.status !== 'running'"
        size="sm"
        variant="ghost"
        title="Discard this operation"
        @click="emit('remove')"
      >
        ✕
      </BaseButton>
    </div>
  </li>
</template>
