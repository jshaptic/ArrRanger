<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { Instance, QueueItem } from '@arrranger/shared';
import ImportListInstanceCard from './ImportListInstanceCard.vue';
import IconCreate from '@/components/base/icons/IconCreate.vue';
import IconUnknown from '@/components/base/icons/IconUnknown.vue';
import { initialsOf } from '@/lib/format';
import { LIST_CHIP_CLASSES, ownerStateLabel, type ImportListOwner } from '@/lib/import-lists';
import type { ImportListRow } from '@/lib/matrix';
import { KIND_CLASSES } from '@/lib/path-matrix';
import { stagedIntent, TONE_CLASSES } from '@/lib/staging';

/**
 * Which instances have this list - chips, not a column per instance.
 *
 * The + after the chips copies this list onto another same-kind instance, the way
 * Paths offers add-root on a folder that could take one.
 */
const props = defineProps<{
  owners: readonly ImportListOwner[];
  row: ImportListRow;
  /** Instances that could not be read - "no owner" and "unknown" must not look alike. */
  unknownCount: number;
  canAdd: boolean;
  staged: (instanceId: number, listId: number) => readonly QueueItem[];
  pending?: readonly PendingCreate[];
}>();

const emit = defineEmits<{
  setEnabled: [target: { instanceId: number; importListId: number; enabled: boolean }];
  add: [];
}>();

export interface PendingCreate {
  readonly instanceId: number;
  readonly name: string;
  readonly kind: Instance['kind'];
}

const HOVER_MS = 160;
const LEAVE_MS = 140;

interface OpenCard {
  readonly owner: ImportListOwner;
  readonly anchor: { top: number; bottom: number; left: number };
}

const open = ref<OpenCard | null>(null);
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

function show(owner: ImportListOwner, event: Event): void {
  clearTimers();
  open.value = { owner, anchor: anchorOf(event) };
}

function hover(owner: ImportListOwner, event: Event): void {
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

function toggle(owner: ImportListOwner, event: Event): void {
  if (pinned.value && open.value?.owner.instanceId === owner.instanceId) {
    close();
    return;
  }
  pinned.value = true;
  show(owner, event);
}

function setEnabled(owner: ImportListOwner, enabled: boolean): void {
  close();
  emit('setEnabled', { instanceId: owner.instanceId, importListId: owner.listId, enabled });
}

function intentOf(owner: ImportListOwner) {
  return stagedIntent(props.staged(owner.instanceId, owner.listId));
}

function chipClasses(owner: ImportListOwner): string {
  const intent = intentOf(owner);
  if (intent !== null) return `${TONE_CLASSES[intent.tone]} ring-1 ring-inset ring-current/30`;
  return LIST_CHIP_CLASSES[owner.enabled ? 'enabled' : 'disabled'];
}

function titleOf(owner: ImportListOwner): string {
  const intent = intentOf(owner);
  const state = ownerStateLabel(owner);
  const claim = intent === null ? state.title : `${intent.label} staged for ${props.row.name}`;
  return `${owner.name}: ${claim} - click for the full breakdown`;
}

const pendingCreates = computed(() => props.pending ?? []);

const unknownTitle = computed(
  () =>
    `${String(props.unknownCount)} instance(s) did not answer, so this list may exist on one of them - unknown, deliberately not "nobody"`,
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
        :data-owner="owner.enabled ? 'enabled' : 'disabled'"
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
        <span
          class="font-mono text-[10px] text-faint"
          data-metric="state"
          :title="ownerStateLabel(owner).title"
        >
          · {{ ownerStateLabel(owner).value }}
        </span>
      </button>

      <span
        v-for="ghost in pendingCreates"
        :key="`pending-${ghost.instanceId}`"
        data-owner="pending"
        class="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap ring-1 ring-inset ring-current/30"
        :class="TONE_CLASSES.create"
        :title="`${ghost.name}: copy staged for ${row.name}`"
      >
        <span
          class="flex h-4 w-4 items-center justify-center rounded font-mono text-[9px] font-bold"
          :class="KIND_CLASSES[ghost.kind]"
        >
          {{ initialsOf(ghost.name) }}
        </span>
        <span>{{ ghost.name }}</span>
        <span class="font-mono text-[10px] text-faint">· new</span>
      </span>

      <IconUnknown
        v-if="owners.length === 0 && unknownCount > 0"
        size="xs"
        class="text-danger/70"
        :title="unknownTitle"
      />

      <button
        v-if="canAdd"
        type="button"
        data-action="addList"
        class="shrink-0 text-[11px] text-faint transition-colors hover:text-accent"
        title="copy this list onto another instance"
        aria-label="copy this list onto another instance"
        @click="emit('add')"
      >
        <IconCreate size="lg" />
      </button>
    </div>

    <Teleport to="body">
      <div v-if="pinned && open" class="fixed inset-0 z-40" @click="close"></div>
      <ImportListInstanceCard
        v-if="open"
        :owner="open.owner"
        :row="row"
        :anchor="open.anchor"
        :staged="intentOf(open.owner)"
        @mouseenter="clearTimers"
        @mouseleave="scheduleClose"
        @set-enabled="setEnabled(open.owner, $event)"
        @close="close"
      />
    </Teleport>
  </td>
</template>
