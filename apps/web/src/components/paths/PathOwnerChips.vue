<script setup lang="ts">
import { computed } from 'vue';
import type { PathOwner, QueueItem } from '@arrranger/shared';
import { initialsOf } from '@/lib/format';
import { stagedIntent, TONE_CLASSES } from '@/lib/staging';

/**
 * Which instances use this folder - the column that replaced a grid of mostly-empty cells.
 *
 * A folder is essentially never reused by two instances, so this is one chip on almost
 * every row. Two chips is legal and renders fine; it is just not what the layout is built
 * around, and there is deliberately no parity vocabulary here to make it look like drift.
 */
const props = defineProps<{
  owners: readonly PathOwner[];
  path: string;
  /** Instances that could not be read - "no owner" and "unknown" must not look alike. */
  unknownCount: number;
  staged: (instanceId: number, path: string) => readonly QueueItem[];
}>();

const emit = defineEmits<{ remove: [target: { instanceId: number; rootFolderId: number | null }] }>();

const KIND_BADGES = {
  radarr: 'bg-amber-500/20 text-amber-300',
  sonarr: 'bg-sky-500/20 text-sky-300',
} as const;

/** Only a root folder is actionable: clicking it stages its removal from that instance. */
function actionable(owner: PathOwner): boolean {
  return owner.use === 'rootFolder';
}

function intentOf(owner: PathOwner) {
  return stagedIntent(props.staged(owner.instanceId, props.path));
}

function chipClasses(owner: PathOwner): string {
  const intent = intentOf(owner);
  if (intent !== null) return `${TONE_CLASSES[intent.tone]} ring-1 ring-inset ring-current/30`;

  if (owner.use === 'rootFolder') {
    return owner.accessible === false
      ? 'border-drift/50 bg-drift/10 text-drift'
      : 'border-sync/40 bg-sync/8 text-ink hover:border-sync/70';
  }
  return 'border-line bg-transparent text-muted';
}

function titleOf(owner: PathOwner): string {
  const intent = intentOf(owner);
  if (intent !== null) return `${owner.name}: ${intent.label} staged for ${props.path}`;

  switch (owner.use) {
    case 'rootFolder':
      return owner.accessible === false
        ? `${owner.name}: root folder here, but it reports the path as not accessible - check the container mount`
        // Free space is a fact about the filesystem, not about the instance - the Free
        // column reports it once instead of once per chip.
        : `${owner.name}: root folder here - click to stage its removal`;
    case 'tracked':
      return `${owner.name}: tracks "${owner.title ?? 'media'}" at exactly this path`;
    default:
      return `${owner.name}: ${String(owner.mediaUnder)} item(s) below this folder, so it is in use`;
  }
}

const unknownTitle = computed(
  () =>
    `${String(props.unknownCount)} instance(s) did not answer, so this folder may be used by one of them - unknown, deliberately not "nobody"`,
);
</script>

<template>
  <td class="border-b border-l border-line px-2 py-1.5">
    <div class="flex flex-wrap items-center gap-1">
      <button
        v-for="owner in owners"
        :key="owner.instanceId"
        type="button"
        :data-owner="owner.use"
        class="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap transition-colors"
        :class="[chipClasses(owner), actionable(owner) ? '' : 'cursor-default']"
        :disabled="!actionable(owner)"
        :title="titleOf(owner)"
        @click="emit('remove', { instanceId: owner.instanceId, rootFolderId: owner.rootFolderId })"
      >
        <span
          class="flex h-4 w-4 items-center justify-center rounded font-mono text-[9px] font-bold"
          :class="KIND_BADGES[owner.kind]"
        >
          {{ initialsOf(owner.name) }}
        </span>
        <span>{{ owner.name }}</span>
        <span v-if="owner.use === 'rootFolder' && owner.accessible === false" class="text-[10px]">⚠</span>
      </button>

      <template v-if="owners.length === 0">
        <span class="text-[11px] text-faint">—</span>
        <!-- Only where "nobody" could be wrong. A row that already has an owner does not
             need the caveat repeated on it; the notice above the table covers the rest. -->
        <span v-if="unknownCount > 0" class="font-mono text-[11px] text-danger/70" :title="unknownTitle">
          ?
        </span>
      </template>
    </div>
  </td>
</template>
