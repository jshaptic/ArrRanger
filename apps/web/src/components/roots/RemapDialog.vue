<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore, type RemapTarget } from '@/stores/queue';
import { useUiStore } from '@/stores/ui';

const props = defineProps<{ fromPath: string }>();
const emit = defineEmits<{ close: [] }>();

const matrix = useMatrixStore();
const queue = useQueueStore();
const ui = useUiStore();

const toPath = ref('');
const moveFiles = ref(false);
const removeOld = ref(false);
const included = ref<number[]>([]);
const counts = ref<Record<number, number | 'loading' | 'error'>>({});

/** Instances that actually have the source path - only they can be re-mapped. */
const sourceRow = computed(() =>
  matrix.rootFolderRows.find((row) => row.path === props.fromPath) ?? null,
);

const candidates = computed(() =>
  (sourceRow.value?.presentOn ?? []).map((instanceId) => {
    const column = matrix.columns.find((entry) => entry.instance.id === instanceId);
    const hasDestination =
      column?.rootFolders.some((folder) => folder.path === toPath.value.trim()) ?? false;
    return {
      instanceId,
      name: column?.instance.name ?? `instance ${String(instanceId)}`,
      kind: column?.instance.kind ?? 'radarr',
      hasDestination,
      oldRootFolderId:
        column?.rootFolders.find((folder) => folder.path === props.fromPath)?.id ?? null,
    };
  }),
);

const knownPaths = computed(() =>
  matrix.allPaths.filter((path) => path !== props.fromPath),
);

const totalMedia = computed(() =>
  included.value.reduce((sum, instanceId) => {
    const count = counts.value[instanceId];
    return sum + (typeof count === 'number' ? count : 0);
  }, 0),
);

const valid = computed(
  () =>
    toPath.value.trim().startsWith('/') &&
    toPath.value.trim() !== props.fromPath &&
    included.value.length > 0 &&
    totalMedia.value > 0,
);

async function loadCounts(): Promise<void> {
  for (const candidate of candidates.value) {
    if (counts.value[candidate.instanceId] !== undefined) continue;
    counts.value = { ...counts.value, [candidate.instanceId]: 'loading' };
    try {
      const ids = await matrix.mediaIdsInRootFolder(candidate.instanceId, props.fromPath);
      counts.value = { ...counts.value, [candidate.instanceId]: ids.length };
    } catch {
      counts.value = { ...counts.value, [candidate.instanceId]: 'error' };
    }
  }
}

function toggle(instanceId: number): void {
  included.value = included.value.includes(instanceId)
    ? included.value.filter((id) => id !== instanceId)
    : [...included.value, instanceId];
}

async function confirm(): Promise<void> {
  const targets: RemapTarget[] = [];

  for (const candidate of candidates.value) {
    if (!included.value.includes(candidate.instanceId)) continue;
    const mediaIds = await matrix.mediaIdsInRootFolder(candidate.instanceId, props.fromPath);
    if (mediaIds.length === 0) continue;

    targets.push({
      instanceId: candidate.instanceId,
      mediaIds,
      needsRootFolder: !candidate.hasDestination,
      removeRootFolderId: removeOld.value ? candidate.oldRootFolderId : null,
    });
  }

  if (targets.length === 0) {
    ui.notify('info', 'No media found under that path - nothing to re-map');
    return;
  }

  await queue.remapRootFolder({ targets, toPath: toPath.value.trim(), moveFiles: moveFiles.value });
  emit('close');
}

onMounted(() => {
  included.value = sourceRow.value?.presentOn ? [...sourceRow.value.presentOn] : [];
  void loadCounts();
});

watch(candidates, () => void loadCounts());
</script>

<template>
  <BaseModal
    title="Re-map a root folder across instances"
    :subtitle="`Moving media out of ${props.fromPath}`"
    width="lg"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <label class="block">
        <span class="mb-1 block text-xs text-muted">Destination path</span>
        <input
          v-model="toPath"
          type="text"
          list="known-paths"
          placeholder="/data/media/movies"
          class="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
        />
        <datalist id="known-paths">
          <option v-for="path in knownPaths" :key="path" :value="path" />
        </datalist>
      </label>

      <div>
        <p class="mb-1.5 text-xs text-muted">Instances holding {{ props.fromPath }}</p>
        <ul class="space-y-1">
          <li v-for="candidate in candidates" :key="candidate.instanceId">
            <label
              class="flex items-center justify-between gap-3 rounded border border-line bg-raised/60 px-2.5 py-1.5 text-xs"
            >
              <span class="flex items-center gap-2">
                <input
                  type="checkbox"
                  :checked="included.includes(candidate.instanceId)"
                  class="accent-[var(--color-accent)]"
                  @change="toggle(candidate.instanceId)"
                />
                {{ candidate.name }}
                <span class="text-[10px] text-faint uppercase">{{ candidate.kind }}</span>
              </span>
              <span class="flex items-center gap-2 text-[11px]">
                <span
                  v-if="toPath.trim().length > 0 && !candidate.hasDestination"
                  class="rounded border border-sync/40 bg-sync/10 px-1.5 py-0.5 text-sync"
                  title="The destination root folder will be created here first"
                >
                  + root folder
                </span>
                <span class="text-muted">
                  <template v-if="counts[candidate.instanceId] === 'loading'">counting…</template>
                  <template v-else-if="counts[candidate.instanceId] === 'error'">
                    <span class="text-danger">count failed</span>
                  </template>
                  <template v-else>{{ counts[candidate.instanceId] ?? 0 }} item(s)</template>
                </span>
              </span>
            </label>
          </li>
        </ul>
      </div>

      <div class="space-y-2 rounded-md border border-line bg-raised/40 px-3 py-2.5">
        <label class="flex items-start gap-2 text-xs">
          <input
            v-model="moveFiles"
            type="checkbox"
            data-testid="move-files"
            class="mt-0.5 accent-[var(--color-danger)]"
          />
          <span>
            <span class="font-medium text-ink">Move the files on disk</span>
            <span class="block text-[11px] leading-relaxed text-muted">
              <template v-if="moveFiles">
                <span class="text-danger">
                  ⚠ *Arr will physically relocate {{ totalMedia }} item(s). This is slow, needs free
                  space at the destination, and cannot be undone by ArrRanger.
                </span>
              </template>
              <template v-else>
                Off: only the root folder assignment changes. Existing files stay where they are and
                *Arr keeps their current paths.
              </template>
            </span>
          </span>
        </label>

        <label class="flex items-start gap-2 text-xs">
          <input
            v-model="removeOld"
            type="checkbox"
            data-testid="remove-old"
            class="mt-0.5 accent-[var(--color-accent)]"
          />
          <span>
            <span class="font-medium text-ink">Remove {{ props.fromPath }} afterwards</span>
            <span class="block text-[11px] leading-relaxed text-muted">
              Staged as a dependent step - it only runs if that instance's move succeeded.
            </span>
          </span>
        </label>
      </div>

      <p class="text-[11px] text-muted">
        Will stage
        <span class="text-ink">{{ included.length }} move(s)</span>
        covering
        <span class="text-ink">{{ totalMedia }} media item(s)</span
        >.
      </p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton
        :variant="moveFiles ? 'danger' : 'primary'"
        :disabled="!valid"
        :loading="queue.busy"
        @click="confirm()"
      >
        Stage re-map
      </BaseButton>
    </template>
  </BaseModal>
</template>
