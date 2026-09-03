<script setup lang="ts">
import { computed } from 'vue';
import type { PathMatrixColumn, PathNode, QueueItem } from '@arrranger/shared';
import BaseButton from '@/components/base/BaseButton.vue';
import PathCellView from './PathCellView.vue';
import PathFlagBadge from './PathFlagBadge.vue';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { actionsFor, cellFor, type PathAction } from '@/lib/path-matrix';
import { stagedIntent, TONE_CLASSES } from '@/lib/staging';

const props = defineProps<{
  node: PathNode;
  depth: number;
  columns: readonly PathMatrixColumn[];
  targetInstanceIds: readonly number[];
  expanded: boolean;
  busy: boolean;
  loading: boolean;
  selected: boolean;
  measured: number | null;
  measuring: boolean;
  stagedForPath: readonly QueueItem[];
  stagedForCell: (instanceId: number, path: string) => readonly QueueItem[];
}>();

const emit = defineEmits<{
  toggle: [];
  select: [];
  measure: [];
  action: [action: PathAction];
  cellCreate: [instanceId: number];
  cellRemove: [target: { instanceId: number; rootFolderId: number | null }];
}>();

const ACTION_LABELS: Record<PathAction, string> = {
  propagate: 'propagate',
  remove: 'remove',
  remap: 're-map',
  reconcile: 'align',
  mkdir: 'new folder',
  rename: 'rename',
  move: 'move',
  prune: 'prune',
  focus: 'focus',
};

const actions = computed(() => actionsFor(props.node, props.targetInstanceIds));
const intent = computed(() => stagedIntent(props.stagedForPath));


/** `mount` drives behaviour (a mount is never renameable) but needs no badge. */
const badges = computed(() => props.node.flags.filter((flag) => flag !== 'mount'));

const glyph = computed(() => {
  if (props.loading) return '⋯';
  if (props.node.kind === 'symlink') return '⇢';
  if (!props.node.exists) return '✕';
  if (props.node.kind !== 'directory') return '·';
  return props.expanded ? '▾' : '▸';
});

/**
 * A top-level row is a mount or a root folder this container cannot see; either way the
 * basename alone ("movies") would not say where it is, so those show the whole path.
 */
const label = computed(() =>
  props.depth === 0 || !props.node.inScope ? props.node.path : props.node.name,
);

const nameClasses = computed(() => {
  if (!props.node.exists) return 'text-danger line-through';
  if (intent.value?.tone === 'destroy') return 'text-danger line-through';
  return 'text-ink';
});
</script>

<template>
  <tr
    class="group"
    :class="selected ? 'bg-accent/5' : 'hover:bg-raised/40'"
    :data-path="node.path"
  >
    <th
      scope="row"
      class="sticky left-0 z-10 border-b border-line px-3 py-1.5 text-left font-normal"
      :class="selected ? 'bg-[#16202b]' : 'bg-surface'"
    >
      <div class="flex items-center gap-1.5" :style="{ paddingLeft: `${String(depth * 0.9)}rem` }">
        <input
          type="checkbox"
          class="accent-[var(--color-accent)]"
          :checked="selected"
          :title="`Select ${node.path}`"
          @change="emit('select')"
        />

        <button
          type="button"
          class="w-4 shrink-0 text-left transition-colors hover:text-ink disabled:opacity-30"
          :class="loading ? 'animate-pulse text-accent' : 'text-faint'"
          :disabled="!node.expandable || loading"
          :title="
            loading
              ? 'Reading…'
              : node.expandable
                ? expanded
                  ? 'Collapse'
                  : 'Expand'
                : 'Nothing to expand - a root folder holds the library, which this view does not manage'
          "
          @click="emit('toggle')"
        >
          {{ glyph }}
        </button>

        <span class="min-w-0 flex-1 truncate font-mono" :class="nameClasses" :title="node.path">
          {{ label }}
        </span>

        <span v-if="node.childCount !== null" class="shrink-0 text-[10px] text-faint">
          {{ node.childCount }}
        </span>

        <PathFlagBadge v-for="flag in badges" :key="flag" :flag="flag" />

        <span
          v-if="intent"
          class="shrink-0 rounded border px-1.5 py-0.5 text-[10px]"
          :class="TONE_CLASSES[intent.tone]"
          :title="`${intent.label} is staged for this folder`"
        >
          {{ intent.icon }} staged
        </span>
      </div>
    </th>

    <!-- disk facts -->
    <td class="border-b border-l border-line px-2 py-1.5 font-mono text-[11px] text-muted">
      <template v-if="measured !== null">{{ formatBytes(measured) }}</template>
      <template v-else-if="node.sizeOnDisk !== null">{{ formatBytes(node.sizeOnDisk) }}</template>
      <button
        v-else-if="node.kind === 'directory' && node.exists"
        type="button"
        class="text-accent hover:underline"
        :disabled="measuring"
        @click="emit('measure')"
      >
        {{ measuring ? 'measuring…' : 'measure' }}
      </button>
      <span v-else>—</span>
    </td>
    <td class="border-b border-l border-line px-2 py-1.5 text-[11px] text-muted whitespace-nowrap">
      {{ node.freeSpace !== null ? `${formatBytes(node.freeSpace)} free` : formatRelativeTime(node.modifiedAt) }}
    </td>

    <PathCellView
      v-for="column in columns"
      :key="column.instanceId"
      :cell="cellFor(node, column.instanceId)"
      :path="node.path"
      :instance-name="column.name"
      :staged="stagedForCell(column.instanceId, node.path)"
      @create="emit('cellCreate', column.instanceId)"
      @remove="
        emit('cellRemove', {
          instanceId: column.instanceId,
          rootFolderId: cellFor(node, column.instanceId).rootFolderId,
        })
      "
    />

    <td class="border-b border-l border-line px-2 py-1.5 text-right whitespace-nowrap">
      <span class="inline-flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <BaseButton
          v-for="action in actions"
          :key="action"
          size="sm"
          variant="ghost"
          :disabled="busy"
          @click="emit('action', action)"
        >
          {{ ACTION_LABELS[action] }}
        </BaseButton>
      </span>
    </td>
  </tr>
</template>
