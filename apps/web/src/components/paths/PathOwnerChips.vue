<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { PathOwner, QueueItem } from '@arrranger/shared';
import PathOwnerCard from './PathOwnerCard.vue';
import { initialsOf } from '@/lib/format';
import { KIND_CLASSES, ownerHeadline, ownerMedia, USE_CLASSES } from '@/lib/path-matrix';
import { stagedIntent, TONE_CLASSES } from '@/lib/staging';

/**
 * Which instances use this folder - the column that replaced a grid of mostly-empty cells.
 *
 * A folder is essentially never reused by two instances, so this is one chip on almost
 * every row. Two chips is legal and renders fine; it is just not what the layout is built
 * around, and there is deliberately no parity vocabulary here to make it look like drift.
 *
 * The chip carries the counts that fit on one line and hands the rest to
 * {@link PathOwnerCard} on hover or click. Everything the card shows used to live in a
 * `title` attribute, where it could not be read without a mouse and could not hold an
 * action - which is why removing a root folder used to be a bare click on the chip, with
 * nothing on screen saying so.
 */
const props = defineProps<{
  owners: readonly PathOwner[];
  path: string;
  /** Instances that could not be read - "no owner" and "unknown" must not look alike. */
  unknownCount: number;
  staged: (instanceId: number, path: string) => readonly QueueItem[];
}>();

const emit = defineEmits<{ remove: [target: { instanceId: number; rootFolderId: number | null }] }>();

/** Long enough that dragging the pointer across a column does not flash cards. */
const HOVER_MS = 160;
/** Short enough to feel immediate, long enough to cross the gap into the card. */
const LEAVE_MS = 140;

interface OpenCard {
  readonly owner: PathOwner;
  readonly anchor: { top: number; bottom: number; left: number };
}

const open = ref<OpenCard | null>(null);
/** A clicked card stays until it is dismissed; a hovered one follows the pointer. */
const pinned = ref(false);

let openTimer: number | null = null;
let closeTimer: number | null = null;

function clearTimers(): void {
  if (openTimer !== null) window.clearTimeout(openTimer);
  if (closeTimer !== null) window.clearTimeout(closeTimer);
  openTimer = null;
  closeTimer = null;
}

function anchorOf(event: Event): OpenCard['anchor'] {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left };
}

function show(owner: PathOwner, event: Event): void {
  clearTimers();
  open.value = { owner, anchor: anchorOf(event) };
}

function hover(owner: PathOwner, event: Event): void {
  clearTimers();
  const anchor = anchorOf(event);
  openTimer = window.setTimeout(() => {
    if (!pinned.value) open.value = { owner, anchor };
  }, HOVER_MS);
}

function scheduleClose(): void {
  clearTimers();
  if (pinned.value) return;
  closeTimer = window.setTimeout(() => {
    open.value = null;
  }, LEAVE_MS);
}

function close(): void {
  clearTimers();
  pinned.value = false;
  open.value = null;
}

/** Clicking pins the card open, so its actions can be reached without a steady hand. */
function toggle(owner: PathOwner, event: Event): void {
  if (pinned.value && open.value?.owner.instanceId === owner.instanceId) {
    close();
    return;
  }
  pinned.value = true;
  show(owner, event);
}

function remove(owner: PathOwner): void {
  close();
  emit('remove', { instanceId: owner.instanceId, rootFolderId: owner.rootFolderId });
}

function intentOf(owner: PathOwner) {
  return stagedIntent(props.staged(owner.instanceId, props.path));
}

function chipClasses(owner: PathOwner): string {
  const intent = intentOf(owner);
  if (intent !== null) return `${TONE_CLASSES[intent.tone]} ring-1 ring-inset ring-current/30`;
  // An instance that cannot see its own root folder overrides the per-use tone: it is the
  // one thing on this chip that is a problem rather than a description.
  if (owner.use === 'rootFolder' && owner.accessible === false) {
    return 'border-drift/50 bg-drift/10 text-drift';
  }
  return USE_CLASSES[owner.use];
}

/** The tooltip stays, for the pointer that never stops moving. */
function titleOf(owner: PathOwner): string {
  const intent = intentOf(owner);
  const claim = intent === null ? ownerHeadline(owner) : `${intent.label} staged for ${props.path}`;
  return `${owner.name}: ${claim} - click for the full breakdown`;
}

const unknownTitle = computed(
  () =>
    `${String(props.unknownCount)} instance(s) did not answer, so this folder may be used by one of them - unknown, deliberately not "nobody"`,
);

onBeforeUnmount(clearTimers);
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
        :class="chipClasses(owner)"
        :title="titleOf(owner)"
        :aria-expanded="open?.owner.instanceId === owner.instanceId"
        @click="toggle(owner, $event)"
        @mouseenter="hover(owner, $event)"
        @mouseleave="scheduleClose"
        @focus="show(owner, $event)"
        @blur="scheduleClose"
      >
        <span
          class="flex h-4 w-4 items-center justify-center rounded font-mono text-[9px] font-bold"
          :class="KIND_CLASSES[owner.kind]"
        >
          {{ initialsOf(owner.name) }}
        </span>
        <span>{{ owner.name }}</span>

        <!-- The one count that belongs here: this instance's share of the folder. The
             Media column beside it sums the fleet, so neither can stand in for the
             other, and a zero is a fact worth stating rather than a chip left bare. -->
        <span
          class="font-mono text-[10px] text-faint"
          data-metric="media"
          :title="ownerMedia(owner).title"
        >
          · {{ ownerMedia(owner).value }}
        </span>

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

    <Teleport to="body">
      <!-- A pinned card is dismissed by clicking anywhere else, which is what makes the
           chip's own click safe to repurpose from "stage a removal" to "explain". -->
      <div v-if="pinned && open" class="fixed inset-0 z-40" @click="close"></div>
      <PathOwnerCard
        v-if="open"
        :owner="open.owner"
        :path="path"
        :anchor="open.anchor"
        :staged="intentOf(open.owner)"
        @mouseenter="clearTimers"
        @mouseleave="scheduleClose"
        @remove="remove(open.owner)"
        @close="close"
      />
    </Teleport>
  </td>
</template>
