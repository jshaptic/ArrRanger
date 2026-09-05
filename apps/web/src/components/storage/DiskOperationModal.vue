<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { FsOp, FsPreflight, NewFsQueueItem } from '@arrranger/shared';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import { resourcesApi } from '@/api/resources';
import { basename, joinPath, parentOf } from '@/lib/fs-tree';
import { formatBytes } from '@/lib/format';
import { usePathsStore } from '@/stores/paths';
import { useQueueStore } from '@/stores/queue';

/**
 * What this dialog still does to a folder that exists.
 *
 * Creating one left: it is `NewFoldersDialog` now, one box taking `mkdir -p` syntax for the
 * whole shape at once, rather than a per-row dialog that could only ever make one.
 */
export type DiskOperation = 'rename' | 'move' | 'delete';

/**
 * An instance whose root folder *is* the folder being renamed, and can therefore follow it.
 *
 * This is what the separate "align" dialog used to be. Renaming a root folder on disk and
 * re-pointing the instances that root at it were two buttons asking the same first question
 * - the new name - and differing only in whether the *Arr half happened; a rename that
 * skipped it left the media missing, so it was never really an independent choice. One
 * dialog, with the *Arr half as instance checkboxes: the disk step is always staged first
 * and everything else hangs off it.
 *
 * Only root folders appear here. An individual media folder deliberately gets no align
 * chain - `media.moveRootFolder` only sets `rootFolderPath` and `media.refresh` re-reads
 * the stored path, so nothing in the operation set can make *Arr adopt a renamed media
 * folder. Those instances are named in the dangling warning instead.
 */
export interface AlignTarget {
  readonly instanceId: number;
  readonly name: string;
  readonly kind: 'radarr' | 'sonarr';
  readonly rootFolderId: number | null;
  readonly mediaUnder: number;
}

const props = withDefaults(
  defineProps<{
    operation: DiskOperation;
    target: string;
    /**
     * Instances with media at or under `target`. Optional so every existing call site
     * keeps working; when given, a relocation says out loud what it would leave behind.
     */
    trackedBy?: ReadonlyArray<{ instanceId: number; name: string; mediaCount: number }>;
    /** Instances rooting at exactly `target` - the ones a rename can carry along. */
    alignTargets?: readonly AlignTarget[];
  }>(),
  { trackedBy: () => [], alignTargets: () => [] },
);
const emit = defineEmits<{ close: [] }>();

const fs = usePathsStore();
const queue = useQueueStore();

const parent = computed(() => parentOf(props.target) ?? props.target);

const name = ref(basename(props.target));
const destination = ref(props.operation === 'move' ? (parentOf(props.target) ?? '') : '');
const recursive = ref(false);
const force = ref(false);
const confirmation = ref('');

const preflight = ref<FsPreflight | null>(null);
const checking = ref(false);

/** Only a rename can be followed: a move crosses into a directory *Arr may not root at. */
const alignable = computed(() => props.operation === 'rename' && props.alignTargets.length > 0);
const selectedInstances = ref<number[]>([]);
const mediaIds = ref<Record<number, number[] | 'loading' | 'error'>>({});
const removeOld = ref(true);
const refreshAfter = ref(true);

const TITLES: Record<DiskOperation, string> = {
  rename: 'Rename on disk',
  move: 'Move on disk',
  delete: 'Delete from disk',
};

const title = computed(() =>
  alignable.value ? 'Rename & align' : TITLES[props.operation],
);

/** The payload as staged - built here so the preview and the queue can never disagree. */
const item = computed<NewFsQueueItem | null>(() => {
  const trimmed = name.value.trim();

  switch (props.operation) {
    case 'rename':
      if (trimmed.length === 0 || trimmed === basename(props.target)) return null;
      return { op: 'fs.rename', payload: { from: props.target, to: joinPath(parent.value, trimmed) } };
    case 'move': {
      const to = destination.value.trim();
      if (to.length === 0 || !to.startsWith('/')) return null;
      return { op: 'fs.move', payload: { from: props.target, to: joinPath(to, trimmed) } };
    }
    case 'delete':
      return {
        op: 'fs.delete',
        payload: { path: props.target, recursive: recursive.value, force: force.value },
      };
  }
});

const blockers = computed(() => preflight.value?.checks.filter((check) => check.status === 'blocker') ?? []);
const warnings = computed(() => preflight.value?.checks.filter((check) => check.status === 'warning') ?? []);
const passed = computed(() => preflight.value?.checks.filter((check) => check.status === 'ok') ?? []);

/** Deleting is the one operation that asks you to type the name back. */
const confirmed = computed(
  () => props.operation !== 'delete' || confirmation.value.trim() === basename(props.target),
);

// ------------------------------------------------------------------- the align half

const chosen = computed(() =>
  props.alignTargets.filter((entry) => selectedInstances.value.includes(entry.instanceId)),
);

/** The ids counted for an instance, or none while the count is still running or failed. */
function idsFor(instanceId: number): readonly number[] {
  const ids = mediaIds.value[instanceId];
  return Array.isArray(ids) ? ids : [];
}

/**
 * Staging while a count is in flight would realign the items it had got to and silently
 * leave the rest pointing at a path that no longer exists.
 */
const counting = computed(() =>
  props.alignTargets.some((entry) => mediaIds.value[entry.instanceId] === 'loading'),
);

/** What the footer promises, counted the way the queue will actually build it. */
const stepCount = computed(
  () =>
    1 +
    chosen.value.reduce((sum, entry) => {
      const items = idsFor(entry.instanceId).length;
      return (
        sum +
        1 +
        (items > 0 ? 1 : 0) +
        (items > 0 && refreshAfter.value ? 1 : 0) +
        (removeOld.value && entry.rootFolderId !== null ? 1 : 0)
      );
    }, 0),
);

async function loadMediaIds(): Promise<void> {
  for (const entry of props.alignTargets) {
    if (mediaIds.value[entry.instanceId] !== undefined) continue;
    mediaIds.value = { ...mediaIds.value, [entry.instanceId]: 'loading' };
    try {
      const ids = await resourcesApi.allMediaIdsInRootFolder(entry.instanceId, props.target);
      mediaIds.value = { ...mediaIds.value, [entry.instanceId]: ids };
    } catch {
      mediaIds.value = { ...mediaIds.value, [entry.instanceId]: 'error' };
    }
  }
}

function toggleInstance(instanceId: number): void {
  selectedInstances.value = selectedInstances.value.includes(instanceId)
    ? selectedInstances.value.filter((id) => id !== instanceId)
    : [...selectedInstances.value, instanceId];
}

const canStage = computed(
  () =>
    item.value !== null &&
    preflight.value?.ok === true &&
    confirmed.value &&
    !queue.busy &&
    !(alignable.value && counting.value),
);

async function check(): Promise<void> {
  const candidate = item.value;
  if (candidate === null) {
    preflight.value = null;
    return;
  }

  checking.value = true;
  try {
    preflight.value = await fs.preflight(candidate.op as FsOp, candidate.payload);
  } catch (error) {
    preflight.value = {
      op: candidate.op,
      ok: false,
      checks: [
        {
          id: 'request_failed',
          status: 'blocker',
          message: error instanceof Error ? error.message : 'Preflight failed',
        },
      ],
      measurement: null,
      freeSpace: null,
      referencedBy: [],
    };
  } finally {
    checking.value = false;
  }
}

async function stage(): Promise<void> {
  const candidate = item.value;
  if (candidate === null) return;

  // With instances selected the disk step is the head of a chain, not a lone operation:
  // `stageReconcile` owns the dependency wiring so a failed rename touches no instance.
  if (candidate.op === 'fs.rename' && chosen.value.length > 0) {
    await queue.stageReconcile({
      from: candidate.payload.from,
      to: candidate.payload.to,
      removeOldRootFolder: removeOld.value,
      refreshAfter: refreshAfter.value,
      targets: chosen.value.map((entry) => ({
        instanceId: entry.instanceId,
        mediaIds: idsFor(entry.instanceId),
        oldRootFolderId: entry.rootFolderId,
      })),
    });
  } else {
    await queue.stageFsOperation(candidate, describeStaging());
  }
  emit('close');
}

function describeStaging(): string {
  switch (props.operation) {
    case 'rename':
      return `the rename of ${basename(props.target)}`;
    case 'move':
      return `the move of ${basename(props.target)}`;
    case 'delete':
      return `the deletion of ${basename(props.target)}`;
  }
}

onMounted(() => {
  void check();
  if (alignable.value) {
    selectedInstances.value = props.alignTargets.map((entry) => entry.instanceId);
    void loadMediaIds();
  }
});

watch([name, destination, recursive, force], () => void check());
</script>

<template>
  <BaseModal
    :title="title"
    :subtitle="
      alignable
        ? `${props.target} - renamed on disk and followed in every selected instance, without copying a byte`
        : props.target
    "
    width="lg"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <!--
        Relocating a tracked folder is a legitimate move, but doing it without re-pointing
        the instances leaves those paths dangling - so say so before anything is staged.
        A rename that *is* carrying its instances along says it in the chain preview
        instead, so this only speaks when nothing is following the folder.
      -->
      <section
        v-if="trackedBy.length > 0 && props.operation !== 'delete' && chosen.length === 0"
        class="rounded-md border border-drift/40 bg-drift/5 px-3 py-2 text-[11px] leading-relaxed text-drift"
      >
        <p v-for="owner in trackedBy" :key="owner.instanceId">
          {{ owner.name }} has {{ owner.mediaCount }} item(s) at or under this folder.
        </p>
        <p class="mt-1 text-muted">
          <template v-if="alignable">
            No instance is selected below, so this changes the disk only - that media will
            show as missing until something points those instances at the new path.
          </template>
          <template v-else>
            This changes the disk only, and nothing here can make *Arr adopt a renamed media
            folder: re-map those instances afterwards, or that media will show as missing.
          </template>
        </p>
      </section>

      <!-- inputs -->
      <label v-if="props.operation === 'rename'" class="block">
        <span class="mb-1 block text-xs text-muted">New name (stays in {{ parent }})</span>
        <input
          v-model="name"
          type="text"
          data-testid="disk-operation-name"
          class="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
        />
      </label>

      <div v-else-if="props.operation === 'move'" class="space-y-3">
        <label class="block">
          <span class="mb-1 block text-xs text-muted">Destination directory</span>
          <input
            v-model="destination"
            type="text"
            list="storage-roots"
            class="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
          />
          <datalist id="storage-roots">
            <option v-for="root in fs.rootPaths" :key="root" :value="root" />
          </datalist>
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-muted">Folder name at the destination</span>
          <input
            v-model="name"
            type="text"
            class="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
          />
        </label>
      </div>

      <div v-else class="space-y-3">
        <p class="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs leading-relaxed text-danger">
          This deletes the folder and everything under it from disk. ArrRanger has no recycle
          bin - once the queue applies this step, the only way back is your backups.
        </p>
        <label class="flex items-start gap-2 text-xs text-muted">
          <input v-model="recursive" type="checkbox" class="mt-0.5 accent-[var(--color-danger)]" />
          <span>
            <span class="font-medium text-ink">Delete contents too</span>
            <span class="block text-[11px]">Required for a folder that is not empty.</span>
          </span>
        </label>
        <label class="flex items-start gap-2 text-xs text-muted">
          <input v-model="force" type="checkbox" class="mt-0.5 accent-[var(--color-danger)]" />
          <span>
            <span class="font-medium text-ink">Delete even though an instance still tracks it</span>
            <span class="block text-[11px]">
              Leaves that instance pointing at a path that no longer exists.
            </span>
          </span>
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-muted">
            Type <span class="font-mono text-ink">{{ basename(props.target) }}</span> to confirm
          </span>
          <input
            v-model="confirmation"
            type="text"
            autocomplete="off"
            class="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-danger"
          />
        </label>
      </div>

      <!-- follow it in *Arr: the old align dialog, now the second half of the rename -->
      <div v-if="alignable" class="space-y-2" data-testid="align-targets">
        <p class="text-xs text-muted">Instances using this path as a root folder</p>
        <ul class="space-y-1">
          <li v-for="entry in props.alignTargets" :key="entry.instanceId">
            <label class="flex items-center justify-between gap-3 rounded border border-line bg-raised/60 px-2.5 py-1.5 text-xs">
              <span class="flex items-center gap-2">
                <input
                  type="checkbox"
                  :checked="selectedInstances.includes(entry.instanceId)"
                  class="accent-[var(--color-accent)]"
                  @change="toggleInstance(entry.instanceId)"
                />
                {{ entry.name }}
                <span class="text-[10px] text-faint uppercase">{{ entry.kind }}</span>
              </span>
              <span class="text-[11px] text-muted">
                <template v-if="mediaIds[entry.instanceId] === 'loading'">counting…</template>
                <template v-else-if="mediaIds[entry.instanceId] === 'error'">
                  <span class="text-danger">count failed</span>
                </template>
                <template v-else>{{ idsFor(entry.instanceId).length }} item(s) to realign</template>
              </span>
            </label>
          </li>
        </ul>

        <div class="space-y-2 rounded-md border border-line bg-raised/40 px-3 py-2.5 text-xs">
          <label class="flex items-start gap-2">
            <input v-model="refreshAfter" type="checkbox" class="mt-0.5 accent-[var(--color-accent)]" />
            <span>
              <span class="font-medium text-ink">Rescan afterwards</span>
              <span class="block text-[11px] text-muted">
                Sends RefreshMovie / RefreshSeries so the instance re-reads the new paths.
              </span>
            </span>
          </label>
          <label class="flex items-start gap-2">
            <input v-model="removeOld" type="checkbox" class="mt-0.5 accent-[var(--color-accent)]" />
            <span>
              <span class="font-medium text-ink">Remove the old root folder</span>
              <span class="block text-[11px] text-muted">
                Only runs if that instance's realignment succeeded.
              </span>
            </span>
          </label>
        </div>

        <!-- the exact chain, in words -->
        <div v-if="chosen.length > 0" class="rounded-lg border border-staged/40 bg-staged/5 px-3 py-2.5">
          <p class="mb-1.5 text-[11px] font-semibold text-staged">What will be staged</p>
          <ol class="space-y-1 text-[11px] text-muted">
            <li>
              <span class="font-mono text-ink">1.</span>
              rename <span class="font-mono">{{ props.target }}</span> to
              <span class="font-mono">{{ item?.op === 'fs.rename' ? item.payload.to : '' }}</span>
              on disk
            </li>
            <li v-for="(entry, index) in chosen" :key="entry.instanceId">
              <span class="font-mono text-ink">{{ index + 2 }}.</span>
              on {{ entry.name }}: add the new root folder<template
                v-if="idsFor(entry.instanceId).length > 0"
              >, point its media at it with
                <span class="font-mono text-sync">moveFiles: false</span><span v-if="refreshAfter">, rescan</span></template>
              <span v-if="removeOld && entry.rootFolderId !== null">, then drop the old root folder</span>
            </li>
          </ol>
          <p class="mt-2 text-[11px] leading-relaxed text-muted">
            Every *Arr step waits for the disk step. If the rename fails, nothing after it runs -
            and because <span class="font-mono">moveFiles</span> is false, no instance will try to
            copy the media that just moved.
          </p>
        </div>
      </div>

      <!-- preflight -->
      <div class="rounded-lg border border-line bg-raised/40 px-3 py-2.5">
        <p class="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted">
          Preflight
          <span v-if="checking" class="text-faint">checking…</span>
          <span v-else-if="preflight?.ok" class="text-sync">all checks passed</span>
          <span v-else-if="preflight" class="text-danger">{{ blockers.length }} blocker(s)</span>
        </p>

        <ul v-if="preflight" class="space-y-1 text-[11px]">
          <li v-for="check in blockers" :key="check.id" class="flex gap-2 text-danger">
            <span>✕</span>
            <span>{{ check.message }}</span>
          </li>
          <li v-for="check in warnings" :key="check.id" class="flex gap-2 text-drift">
            <span>⚠</span>
            <span>{{ check.message }}</span>
          </li>
          <li v-for="check in passed" :key="check.id" class="flex gap-2 text-muted">
            <span class="text-sync">✓</span>
            <span>{{ check.message }}</span>
          </li>
        </ul>

        <p v-if="preflight?.measurement" class="mt-2 text-[11px] text-muted">
          {{ formatBytes(preflight.measurement.sizeOnDisk) }} in
          {{ preflight.measurement.fileCount }} file(s)
          <span v-if="preflight.measurement.truncated">(at least - the walk hit its cap)</span>
        </p>
        <p v-if="preflight?.freeSpace !== null && preflight?.freeSpace !== undefined" class="text-[11px] text-faint">
          {{ formatBytes(preflight.freeSpace) }} free on that filesystem
        </p>
      </div>

      <p class="text-[11px] leading-relaxed text-muted">
        Nothing happens now: this is added to Pending Fleet Changes, and the preflight runs
        again immediately before it executes.
      </p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton
        :variant="props.operation === 'delete' ? 'danger' : 'primary'"
        :disabled="!canStage"
        :loading="queue.busy"
        @click="stage()"
      >
        <template v-if="chosen.length > 0">Stage {{ stepCount }} step(s)</template>
        <template v-else>Stage {{ props.operation }}</template>
      </BaseButton>
    </template>
  </BaseModal>
</template>
