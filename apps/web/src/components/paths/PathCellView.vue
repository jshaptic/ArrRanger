<script setup lang="ts">
import { computed } from 'vue';
import type { PathInstanceCell, QueueItem } from '@arrranger/shared';
import { formatBytes } from '@/lib/format';
import { stagedIntent, TONE_CLASSES } from '@/lib/staging';

const props = defineProps<{
  cell: PathInstanceCell;
  staged: readonly QueueItem[];
  instanceName: string;
  path: string;
}>();

const emit = defineEmits<{ create: []; remove: [] }>();

const intent = computed(() => stagedIntent(props.staged));

/** Only the two decisive roles are clickable: add a root folder here, or drop it. */
const actionable = computed(
  () => props.cell.known && (props.cell.role === 'rootFolder' || quiet.value),
);

const quiet = computed(() => props.cell.role === 'outside' || props.cell.role === 'inside');

const cellClasses = computed(() => {
  if (!props.cell.known) return 'border-danger/30 bg-danger/5 text-danger/60';
  if (intent.value !== null) {
    return `${TONE_CLASSES[intent.value.tone]} ring-1 ring-inset ring-current/30`;
  }

  switch (props.cell.role) {
    case 'rootFolder':
      return props.cell.accessible === false
        ? 'border-drift/50 bg-drift/10 text-drift'
        : 'border-sync/30 bg-sync/8 text-ink hover:border-sync/60';
    case 'tracked':
      return 'border-sync/20 bg-sync/5 text-sync';
    case 'ancestor':
      return 'border-line bg-transparent text-muted';
    case 'inside':
    case 'outside':
      return 'border-dashed border-line-strong bg-transparent text-faint hover:border-accent/60 hover:text-accent';
    default:
      return 'border-danger/30 bg-danger/5 text-danger/60';
  }
});

const title = computed(() => {
  const who = props.instanceName;
  if (!props.cell.known) return `${who}: instance did not answer`;
  if (intent.value !== null) return `${who}: ${intent.value.label} staged for ${props.path}`;

  switch (props.cell.role) {
    case 'rootFolder':
      return props.cell.accessible === false
        ? `${who}: ${props.path} is not accessible - check the container mount`
        : `${who}: root folder, ${formatBytes(props.cell.freeSpace)} free of ${formatBytes(props.cell.totalSpace)} - click to stage removal`;
    case 'tracked':
      return `${who}: tracks "${props.cell.title ?? 'media'}" at exactly this path`;
    case 'ancestor':
      return `${who}: ${String(props.cell.mediaUnder)} item(s) below this folder, so it is in use`;
    case 'inside':
      return `${who}: inside one of its root folders, but it tracks nothing here - click to stage a root folder`;
    default:
      return `${who}: outside its root folders - click to stage one here`;
  }
});
</script>

<template>
  <td class="border-l border-line p-1 text-center">
    <button
      type="button"
      :data-cell="cell.role"
      class="flex h-9 w-full min-w-[5rem] flex-col items-center justify-center rounded border text-[11px] leading-tight transition-colors"
      :class="cellClasses"
      :disabled="!actionable"
      :title="title"
      @click="cell.role === 'rootFolder' ? emit('remove') : emit('create')"
    >
      <template v-if="!cell.known">
        <span class="font-mono text-xs">?</span>
      </template>

      <template v-else-if="cell.role === 'rootFolder'">
        <span class="flex items-center gap-1">
          <span v-if="intent" class="text-[10px]">{{ intent.icon }}</span>
          <span v-else-if="cell.accessible === false" class="text-[10px]">⚠</span>
          <span class="font-mono" :class="intent?.tone === 'destroy' ? 'line-through opacity-70' : ''">
            {{ formatBytes(cell.freeSpace) }}
          </span>
        </span>
        <span class="text-[9px] opacity-60">root · free</span>
      </template>

      <template v-else-if="cell.role === 'tracked'">
        <span class="text-[10px]">●</span>
        <span class="text-[9px] opacity-70">tracked</span>
      </template>

      <template v-else-if="cell.role === 'ancestor'">
        <span class="font-mono text-[11px]">{{ cell.mediaUnder }}</span>
        <span class="text-[9px] opacity-60">below</span>
      </template>

      <template v-else>
        <span v-if="intent" class="text-[11px]">{{ intent.icon }} new</span>
        <span v-else class="text-xs opacity-50">—</span>
      </template>
    </button>
  </td>
</template>
