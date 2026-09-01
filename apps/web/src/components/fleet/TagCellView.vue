<script setup lang="ts">
import { computed } from 'vue';
import type { QueueItem } from '@arrranger/shared';
import type { TagCell } from '@/lib/matrix';
import { stagedIntent, TONE_CLASSES } from '@/lib/staging';

const props = defineProps<{
  cell: TagCell;
  staged: readonly QueueItem[];
  instanceName: string;
  label: string;
}>();

const emit = defineEmits<{ create: []; remove: [] }>();

const intent = computed(() => stagedIntent(props.staged));

const cellClasses = computed(() => {
  if (!props.cell.known) return 'border-danger/30 bg-danger/5 text-danger/60';
  if (intent.value !== null) return `${TONE_CLASSES[intent.value.tone]} ring-1 ring-inset ring-current/30`;
  if (props.cell.present) return 'border-sync/30 bg-sync/8 text-ink hover:border-sync/60';
  return 'border-dashed border-line-strong bg-transparent text-faint hover:border-accent/60 hover:text-accent';
});

const title = computed(() => {
  if (!props.cell.known) return `${props.instanceName}: instance did not answer`;
  if (intent.value !== null) {
    return `${props.instanceName}: ${intent.value.label} staged for "${props.label}"`;
  }
  if (props.cell.present) {
    return `${props.instanceName}: "${props.label}" on ${String(props.cell.mediaCount)} item(s), ${String(props.cell.otherUses)} other use(s) - click to stage a delete`;
  }
  return `${props.instanceName}: "${props.label}" missing - click to stage it here`;
});
</script>

<template>
  <td class="border-l border-line p-1 text-center">
    <button
      type="button"
      :data-cell="'tag'"
      class="flex h-9 w-full min-w-[3.5rem] flex-col items-center justify-center gap-0.5 rounded border text-[11px] transition-colors"
      :class="cellClasses"
      :disabled="!cell.known"
      :title="title"
      @click="cell.present ? emit('remove') : emit('create')"
    >
      <template v-if="!cell.known">
        <span class="font-mono text-xs">?</span>
      </template>
      <template v-else-if="cell.present">
        <span class="flex items-center gap-1">
          <span v-if="intent" class="text-[10px]">{{ intent.icon }}</span>
          <span class="font-mono" :class="intent?.tone === 'destroy' ? 'line-through opacity-70' : ''">
            {{ cell.mediaCount }}
          </span>
        </span>
        <span v-if="cell.otherUses > 0" class="text-[9px] opacity-60">
          +{{ cell.otherUses }} cfg
        </span>
      </template>
      <template v-else>
        <span v-if="intent" class="text-[11px]">{{ intent.icon }} new</span>
        <span v-else class="text-xs opacity-50">—</span>
      </template>
    </button>
  </td>
</template>
