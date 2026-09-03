<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { FsOp, FsPreflight, NewFsQueueItem } from '@arrranger/shared';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import { basename, joinPath, parentOf } from '@/lib/fs-tree';
import { formatBytes } from '@/lib/format';
import { usePathsStore } from '@/stores/paths';
import { useQueueStore } from '@/stores/queue';

export type DiskOperation = 'mkdir' | 'rename' | 'move' | 'delete';

const props = withDefaults(
  defineProps<{
    operation: DiskOperation;
    target: string;
    /**
     * Instances with media at or under `target`. Optional so every existing call site
     * keeps working; when given, a relocation says out loud what it would leave behind.
     */
    trackedBy?: ReadonlyArray<{ instanceId: number; name: string; mediaCount: number }>;
  }>(),
  { trackedBy: () => [] },
);
const emit = defineEmits<{ close: [] }>();

const fs = usePathsStore();
const queue = useQueueStore();

const parent = computed(() => parentOf(props.target) ?? props.target);

const name = ref(props.operation === 'mkdir' ? '' : basename(props.target));
const destination = ref(props.operation === 'move' ? (parentOf(props.target) ?? '') : '');
const recursive = ref(false);
const force = ref(false);
const confirmation = ref('');

const preflight = ref<FsPreflight | null>(null);
const checking = ref(false);

const TITLES: Record<DiskOperation, string> = {
  mkdir: 'Create a directory',
  rename: 'Rename on disk',
  move: 'Move on disk',
  delete: 'Delete from disk',
};

/** The payload as staged - built here so the preview and the queue can never disagree. */
const item = computed<NewFsQueueItem | null>(() => {
  const trimmed = name.value.trim();

  switch (props.operation) {
    case 'mkdir':
      if (trimmed.length === 0) return null;
      return { op: 'fs.mkdir', payload: { path: joinPath(props.target, trimmed), recursive: recursive.value } };
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

const canStage = computed(
  () => item.value !== null && preflight.value?.ok === true && confirmed.value && !queue.busy,
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

  await queue.stageFsOperation(candidate, describeStaging());
  emit('close');
}

function describeStaging(): string {
  switch (props.operation) {
    case 'mkdir':
      return `a new directory ${name.value.trim()}`;
    case 'rename':
      return `the rename of ${basename(props.target)}`;
    case 'move':
      return `the move of ${basename(props.target)}`;
    case 'delete':
      return `the deletion of ${basename(props.target)}`;
  }
}

onMounted(() => void check());
watch([name, destination, recursive, force], () => void check());
</script>

<template>
  <BaseModal :title="TITLES[props.operation]" :subtitle="props.target" width="lg" @close="emit('close')">
    <div class="space-y-4">
      <!--
        Relocating a tracked folder is a legitimate move - it is what Reconcile & Align
        does - but doing it without realigning leaves those paths dangling, so say so
        before anything is staged.
      -->
      <section
        v-if="trackedBy.length > 0 && (props.operation === 'rename' || props.operation === 'move')"
        class="rounded-md border border-drift/40 bg-drift/5 px-3 py-2 text-[11px] leading-relaxed text-drift"
      >
        <p v-for="owner in trackedBy" :key="owner.instanceId">
          {{ owner.name }} has {{ owner.mediaCount }} item(s) at or under this folder.
        </p>
        <p class="mt-1 text-muted">
          Moving it here changes the disk only. Use <span class="font-medium text-ink">align</span>
          instead to rename and re-point the instances in one chain, or re-map them
          afterwards - otherwise that media will show as missing.
        </p>
      </section>

      <!-- inputs -->
      <div v-if="props.operation === 'mkdir'" class="space-y-3">
        <label class="block">
          <span class="mb-1 block text-xs text-muted">New directory name</span>
          <input
            v-model="name"
            type="text"
            placeholder="movies-4k"
            class="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
          />
        </label>
        <label class="flex items-center gap-2 text-xs text-muted">
          <input v-model="recursive" type="checkbox" class="accent-[var(--color-accent)]" />
          create parent directories as needed
        </label>
      </div>

      <label v-else-if="props.operation === 'rename'" class="block">
        <span class="mb-1 block text-xs text-muted">New name (stays in {{ parent }})</span>
        <input
          v-model="name"
          type="text"
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
        Stage {{ props.operation }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
