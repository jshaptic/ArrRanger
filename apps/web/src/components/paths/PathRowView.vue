<script setup lang="ts">
import { computed } from 'vue';
import type { PathNode, PathSeverity, QueueItem } from '@arrranger/shared';
import BaseButton from '@/components/base/BaseButton.vue';
import PathFlagBadge from './PathFlagBadge.vue';
import PathOwnerChips from './PathOwnerChips.vue';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { actionsFor, FLAG_STYLES, mediaSummary, SEVERITY_STYLES, type PathAction } from '@/lib/path-matrix';
import { stagedIntent, TONE_CLASSES } from '@/lib/staging';

const props = defineProps<{
  node: PathNode;
  depth: number;
  /**
   * A row in the flat list, where there is no tree to walk: no twisty, and no focus, since
   * both only mean something next to a hierarchy.
   */
  flat: boolean;
  /** Instances that could not be read, so an empty Used-by cell is not read as "nobody". */
  unknownCount: number;
  expanded: boolean;
  /**
   * Kept by the filter only as a way down to something that might match, rather than
   * being a match itself. Dimmed, so a filtered tree still reads as an answer.
   */
  onTheWay?: boolean;
  /** Worst severity inside this node, when its level is loaded. */
  childSeverity: PathSeverity | null;
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
  ownerRemove: [target: { instanceId: number; rootFolderId: number | null }];
}>();

const ACTION_LABELS: Record<Exclude<PathAction, 'focus'>, string> = {
  addRoot: 'add root folder',
  remove: 'remove',
  remap: 're-map',
  reconcile: 'align',
  rename: 'rename',
  move: 'move',
  prune: 'prune',
};

const allActions = computed(() => actionsFor(props.node));
/** `focus` gets its own icon next to the name rather than a text button in the actions column. */
const actions = computed(() => allActions.value.filter((action) => action !== 'focus'));
const canFocus = computed(() => !props.flat && allActions.value.includes('focus'));
const intent = computed(() => stagedIntent(props.stagedForPath));
const media = computed(() => mediaSummary(props.node));

/**
 * The badges that still need words.
 *
 * `mount` drives behaviour (a mount is never renameable) and the leading slash already
 * says it. `rootFolder` is now the folder's *colour*: it is the single most common state
 * in the table, on every row the view is organised around, and a green name says it
 * without spending a badge - which leaves the badge row meaning "something is off here".
 */
const badges = computed(() =>
  props.node.flags.filter((flag) => flag !== 'mount' && flag !== 'rootFolder'),
);

const severity = computed(() => SEVERITY_STYLES[props.node.severity]);

/**
 * Why the glyph is there, in the badge vocabulary rather than in flag ids.
 *
 * A root folder its own instance cannot see is the one severity with no flag behind it,
 * so it has to name itself or the glyph would appear with an empty reason.
 */
const severityTitle = computed(() => {
  if (badges.value.length > 0) {
    return `This folder needs attention: ${badges.value.map((flag) => FLAG_STYLES[flag].label).join(', ')}`;
  }
  if (props.node.owners.some((owner) => owner.use === 'rootFolder' && owner.accessible === false)) {
    return 'An instance reports its own root folder here as not accessible';
  }
  return props.node.lowSpace
    ? 'This filesystem is below the low-space threshold'
    : 'This folder needs attention';
});

/**
 * A dimmed warning for a collapsed folder whose children need attention, so a problem two
 * levels down is not invisible until you go looking for it. Only when the row's own state
 * is quiet - it would be noise next to the row's own glyph.
 */
const inheritedSeverity = computed(() => {
  if (severity.value !== null || props.expanded) return null;
  if (props.childSeverity === null) return null;
  return SEVERITY_STYLES[props.childSeverity];
});

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
  const classes: string[] = [];
  // Dimmed rather than hidden: this folder is the route to a match, not a match.
  if (props.onTheWay === true) classes.push('opacity-45');

  if (!props.node.exists || intent.value?.tone === 'destroy') {
    return [...classes, 'text-danger', 'line-through'];
  }
  // The badge this replaced. Colour scales where a badge does not: a fleet of 79 root
  // folders used to be 79 identical chips saying the thing the row is about.
  return [...classes, props.node.flags.includes('rootFolder') ? 'text-sync' : 'text-ink'];
});

/** The disk facts that do not earn a column of their own, in one tooltip. */
const diskTitle = computed(() => {
  const lines = [props.node.path];
  if (props.onTheWay === true) lines.push('on the way to a match - it does not match the filter itself');
  if (props.node.flags.includes('rootFolder')) lines.push('a root folder - hence the green name');
  if (props.node.modifiedAt !== null) lines.push(`modified ${formatRelativeTime(props.node.modifiedAt)}`);
  if (props.node.exists && props.node.inScope) {
    lines.push(props.node.readable ? (props.node.writable ? 'read-write' : 'read-only') : 'no read access');
  }
  if (props.node.deviceId !== null) lines.push(`filesystem ${props.node.deviceId}`);
  return lines.join('\n');
});

const spaceTitle = computed(() => {
  if (props.node.freeSpace === null) return 'Free space not evaluated for this path';
  const share =
    props.node.totalSpace === null || props.node.totalSpace === 0
      ? ''
      : ` (${String(Math.round((props.node.freeSpace / props.node.totalSpace) * 100))}%)`;
  const of = props.node.totalSpace === null ? '' : ` of ${formatBytes(props.node.totalSpace)}`;
  return `${formatBytes(props.node.freeSpace)} free${of}${share}${props.node.lowSpace ? ' - below the low-space threshold' : ''}`;
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

        <template v-if="!flat">
          <button
            v-if="!node.flags.includes('rootFolder')"
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
                  : 'Nothing to expand here'
            "
            @click="emit('toggle')"
          >
            {{ glyph }}
          </button>
          <span v-else class="w-4 shrink-0"></span>
        </template>

        <span
          data-name
          class="min-w-0 flex-1 truncate font-mono"
          :class="nameClasses"
          :title="diskTitle"
        >
          {{ label }}
        </span>

        <button
          v-if="canFocus"
          type="button"
          class="shrink-0 text-[11px] text-faint transition-colors hover:text-accent"
          title="Focus: re-root this view at this folder"
          :disabled="busy"
          @click="emit('action', 'focus')"
        >
          ⌖
        </button>

        <!-- What is wrong with this folder, right where its name is, and in one reading
             order: the states, then anything staged against them, then the glyph that
             summarises the lot. The old State column put all three a full table away
             from the name they describe. -->
        <PathFlagBadge v-for="flag in badges" :key="flag" :flag="flag" class="shrink-0" />

        <span
          v-if="intent"
          class="shrink-0 rounded border px-1.5 py-0.5 text-[10px]"
          :class="TONE_CLASSES[intent.tone]"
          :title="`${intent.label} is staged for this folder`"
        >
          {{ intent.icon }} staged
        </span>

        <span
          v-if="severity"
          class="w-3 shrink-0 text-right text-[11px]"
          :class="severity.classes"
          :title="severityTitle"
          data-severity="own"
        >
          {{ severity.glyph }}
        </span>
        <span
          v-else-if="inheritedSeverity"
          class="w-3 shrink-0 text-right text-[11px] opacity-40"
          :class="inheritedSeverity.classes"
          title="Something inside this folder needs attention"
          data-severity="child"
        >
          {{ inheritedSeverity.glyph }}
        </span>
      </div>
    </th>

    <PathOwnerChips
      :owners="node.owners"
      :path="node.path"
      :unknown-count="unknownCount"
      :staged="stagedForCell"
      @remove="emit('ownerRemove', $event)"
    />

    <!-- media -->
    <td class="border-b border-l border-line px-2 py-1.5 text-[11px] text-muted">
      <span v-if="media" class="truncate" :title="media.detail">{{ media.label }}</span>
      <span v-else class="text-faint">—</span>
    </td>

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

    <td class="border-b border-l border-line px-2 py-1.5 text-[11px] whitespace-nowrap text-faint">
      {{ node.modifiedAt === null ? '—' : formatRelativeTime(node.modifiedAt) }}
    </td>

    <td
      class="border-b border-l border-line px-2 py-1.5 font-mono text-[11px] whitespace-nowrap"
      :class="node.lowSpace ? 'text-drift' : 'text-muted'"
      :title="spaceTitle"
    >
      <span v-if="node.lowSpace" data-low-space="true">⚠ </span>
      {{ node.freeSpace === null ? '—' : formatBytes(node.freeSpace) }}
    </td>

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
