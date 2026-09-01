<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { FsPreflight } from '@arrranger/shared';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import { resourcesApi } from '@/api/resources';
import { basename, joinPath, parentOf } from '@/lib/fs-tree';
import { useFilesystemStore } from '@/stores/filesystem';
import { useInstancesStore } from '@/stores/instances';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore } from '@/stores/queue';

const props = defineProps<{ path: string }>();
const emit = defineEmits<{ close: [] }>();

const fs = useFilesystemStore();
const matrix = useMatrixStore();
const instances = useInstancesStore();
const queue = useQueueStore();

const newName = ref(basename(props.path));
const removeOld = ref(true);
const refreshAfter = ref(true);
const selected = ref<number[]>([]);
const mediaIds = ref<Record<number, number[] | 'loading' | 'error'>>({});
const preflight = ref<FsPreflight | null>(null);

const parent = computed(() => parentOf(props.path) ?? props.path);
const destination = computed(() => joinPath(parent.value, newName.value.trim()));

/** Instances that use this path as a root folder - they are the ones to realign. */
const candidates = computed(() =>
  matrix.healthyColumns
    .filter((column) => column.rootFolders.some((folder) => folder.path === props.path))
    .map((column) => ({
      instanceId: column.instance.id,
      name: column.instance.name,
      kind: column.instance.kind,
      oldRootFolderId: column.rootFolders.find((folder) => folder.path === props.path)?.id ?? null,
    })),
);

const valid = computed(
  () =>
    newName.value.trim().length > 0 &&
    !newName.value.includes('/') &&
    destination.value !== props.path &&
    preflight.value?.ok === true &&
    selected.value.length > 0,
);

const totalMedia = computed(() =>
  selected.value.reduce((sum, instanceId) => {
    const ids = mediaIds.value[instanceId];
    return sum + (Array.isArray(ids) ? ids.length : 0);
  }, 0),
);

async function loadMediaIds(): Promise<void> {
  for (const candidate of candidates.value) {
    if (mediaIds.value[candidate.instanceId] !== undefined) continue;
    mediaIds.value = { ...mediaIds.value, [candidate.instanceId]: 'loading' };
    try {
      const ids = await resourcesApi.allMediaIdsInRootFolder(candidate.instanceId, props.path);
      mediaIds.value = { ...mediaIds.value, [candidate.instanceId]: ids };
    } catch {
      mediaIds.value = { ...mediaIds.value, [candidate.instanceId]: 'error' };
    }
  }
}

async function check(): Promise<void> {
  if (newName.value.trim().length === 0) return;
  try {
    preflight.value = await fs.preflight('fs.rename', { from: props.path, to: destination.value });
  } catch (error) {
    preflight.value = {
      op: 'fs.rename',
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
  }
}

function toggle(instanceId: number): void {
  selected.value = selected.value.includes(instanceId)
    ? selected.value.filter((id) => id !== instanceId)
    : [...selected.value, instanceId];
}

async function stage(): Promise<void> {
  await queue.stageReconcile({
    from: props.path,
    to: destination.value,
    removeOldRootFolder: removeOld.value,
    refreshAfter: refreshAfter.value,
    targets: candidates.value
      .filter((candidate) => selected.value.includes(candidate.instanceId))
      .map((candidate) => {
        const ids = mediaIds.value[candidate.instanceId];
        return {
          instanceId: candidate.instanceId,
          mediaIds: Array.isArray(ids) ? ids : [],
          oldRootFolderId: candidate.oldRootFolderId,
        };
      })
      .filter((target) => target.mediaIds.length > 0),
  });
  emit('close');
}

onMounted(() => {
  void syncCandidates();
  void check();
});

/**
 * The fleet snapshot can arrive after this dialog opens. Without this, the counts would
 * stay at zero and staging would quietly skip the instances it could not count.
 */
async function syncCandidates(): Promise<void> {
  if (selected.value.length === 0) {
    selected.value = candidates.value.map((candidate) => candidate.instanceId);
  }
  await loadMediaIds();
}

watch(candidates, () => void syncCandidates());
watch(newName, () => void check());
</script>

<template>
  <BaseModal
    title="Reconcile &amp; align"
    subtitle="Rename the folder on disk and follow it in every selected instance - without copying a byte"
    width="lg"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <label class="block">
        <span class="mb-1 block text-xs text-muted">New folder name in {{ parent }}</span>
        <input
          v-model="newName"
          type="text"
          class="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
        />
      </label>

      <p
        v-if="preflight && !preflight.ok"
        class="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[11px] leading-relaxed text-danger"
      >
        {{ preflight.checks.find((check) => check.status === 'blocker')?.message }}
      </p>

      <div v-if="candidates.length > 0">
        <p class="mb-1.5 text-xs text-muted">Instances using this path as a root folder</p>
        <ul class="space-y-1">
          <li v-for="candidate in candidates" :key="candidate.instanceId">
            <label class="flex items-center justify-between gap-3 rounded border border-line bg-raised/60 px-2.5 py-1.5 text-xs">
              <span class="flex items-center gap-2">
                <input
                  type="checkbox"
                  :checked="selected.includes(candidate.instanceId)"
                  class="accent-[var(--color-accent)]"
                  @change="toggle(candidate.instanceId)"
                />
                {{ candidate.name }}
                <span class="text-[10px] text-faint uppercase">{{ candidate.kind }}</span>
              </span>
              <span class="text-[11px] text-muted">
                <template v-if="mediaIds[candidate.instanceId] === 'loading'">counting…</template>
                <template v-else-if="mediaIds[candidate.instanceId] === 'error'">
                  <span class="text-danger">count failed</span>
                </template>
                <template v-else>
                  {{ Array.isArray(mediaIds[candidate.instanceId]) ? (mediaIds[candidate.instanceId] as number[]).length : 0 }}
                  item(s) to realign
                </template>
              </span>
            </label>
          </li>
        </ul>
      </div>

      <p v-else class="rounded-md border border-line bg-raised/40 px-3 py-2 text-[11px] text-muted">
        No connected instance uses {{ props.path }} as a root folder, so only the disk rename
        will be staged.
      </p>

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
      <div class="rounded-lg border border-staged/40 bg-staged/5 px-3 py-2.5">
        <p class="mb-1.5 text-[11px] font-semibold text-staged">What will be staged</p>
        <ol class="space-y-1 text-[11px] text-muted">
          <li>
            <span class="font-mono text-ink">1.</span>
            rename <span class="font-mono">{{ props.path }}</span> to
            <span class="font-mono">{{ destination }}</span> on disk
          </li>
          <li v-for="(instanceId, index) in selected" :key="instanceId">
            <span class="font-mono text-ink">{{ index + 2 }}.</span>
            on {{ instances.byId.get(instanceId)?.name ?? instanceId }}: add the new root folder,
            point its media at it with
            <span class="font-mono text-sync">moveFiles: false</span>
            <span v-if="refreshAfter">, rescan</span>
            <span v-if="removeOld">, then drop the old root folder</span>
          </li>
        </ol>
        <p class="mt-2 text-[11px] leading-relaxed text-muted">
          Every *Arr step waits for the disk step. If the rename fails, nothing after it runs -
          and because <span class="font-mono">moveFiles</span> is false, no instance will try to
          copy the {{ totalMedia }} item(s) that just moved.
        </p>
      </div>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!valid" :loading="queue.busy" @click="stage()">
        Stage {{ 1 + selected.length }} step(s)
      </BaseButton>
    </template>
  </BaseModal>
</template>
