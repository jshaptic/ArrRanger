<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore } from '@/stores/queue';

/**
 * `paths` is the batch form: several selected folders staged against the same instances,
 * one `rootFolder.create` per pair. `path` stays for the single-row case, where the field
 * is editable so a path can be typed by hand.
 */
const props = withDefaults(
  defineProps<{ path?: string; paths?: readonly string[]; preselect?: readonly number[] }>(),
  { path: '', paths: () => [], preselect: () => [] },
);

const emit = defineEmits<{ close: [] }>();

const matrix = useMatrixStore();
const queue = useQueueStore();

const path = ref(props.path);
const selected = ref<number[]>([...props.preselect]);

const batch = computed(() => props.paths.length > 0);
const targets = computed(() => (batch.value ? [...props.paths] : [path.value.trim()]));

const candidates = computed(() =>
  matrix.healthyColumns.map((column) => ({
    instanceId: column.instance.id,
    name: column.instance.name,
    kind: column.instance.kind,
    // In batch mode "already present" is per pair, so it cannot disable the whole row -
    // the pairs that already exist are simply dropped when staging.
    alreadyHas: targets.value.every((target) =>
      column.rootFolders.some((folder) => folder.path === target),
    ),
  })),
);

const valid = computed(
  () => targets.value.every((target) => target.startsWith('/')) && selected.value.length > 0,
);

/** One create per path x instance, minus the pairs that already exist. */
const pairs = computed(() =>
  selected.value.flatMap((instanceId) => {
    const column = matrix.healthyColumns.find((entry) => entry.instance.id === instanceId);
    return targets.value
      .filter((target) => !(column?.rootFolders.some((folder) => folder.path === target) ?? false))
      .map((target) => ({ instanceId, path: target }));
  }),
);

function toggle(instanceId: number): void {
  selected.value = selected.value.includes(instanceId)
    ? selected.value.filter((id) => id !== instanceId)
    : [...selected.value, instanceId];
}

async function confirm(): Promise<void> {
  // Grouped by path so each call keeps its own "on N instance(s)" description.
  for (const target of targets.value) {
    const instanceIds = pairs.value
      .filter((pair) => pair.path === target)
      .map((pair) => pair.instanceId);
    if (instanceIds.length > 0) await queue.createRootFolderAcross(target, instanceIds);
  }
  emit('close');
}
</script>

<template>
  <BaseModal
    title="Add a root folder to the fleet"
    subtitle="Staged per instance - the path must already be mounted inside each container"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <div v-if="batch">
        <span class="mb-1.5 block text-xs text-muted">
          {{ paths.length }} folder(s), as the *Arr containers see them
        </span>
        <ul class="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-line bg-raised/40 px-3 py-2">
          <li v-for="target in paths" :key="target" class="font-mono text-[11px] text-ink">
            {{ target }}
          </li>
        </ul>
      </div>

      <label v-else class="block">
        <span class="mb-1 block text-xs text-muted">Path (as the *Arr container sees it)</span>
        <input
          v-model="path"
          type="text"
          placeholder="/data/media/movies-4k"
          class="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
        />
      </label>

      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <span class="text-xs text-muted">Target instances</span>
          <button
            type="button"
            class="text-[11px] text-accent hover:underline"
            @click="selected = candidates.filter((entry) => !entry.alreadyHas).map((entry) => entry.instanceId)"
          >
            select all that are missing it
          </button>
        </div>
        <ul class="space-y-1">
          <li v-for="candidate in candidates" :key="candidate.instanceId">
            <label
              class="flex items-center justify-between gap-3 rounded border px-2.5 py-1.5 text-xs"
              :class="
                candidate.alreadyHas
                  ? 'border-line bg-raised/30 text-faint'
                  : 'border-line bg-raised/60 text-ink hover:border-line-strong'
              "
            >
              <span class="flex items-center gap-2">
                <input
                  type="checkbox"
                  :checked="selected.includes(candidate.instanceId)"
                  :disabled="candidate.alreadyHas"
                  class="accent-[var(--color-accent)]"
                  @change="toggle(candidate.instanceId)"
                />
                {{ candidate.name }}
                <span class="text-[10px] text-faint uppercase">{{ candidate.kind }}</span>
              </span>
              <span v-if="candidate.alreadyHas" class="text-[11px] text-sync">already present</span>
            </label>
          </li>
        </ul>
      </div>

      <p class="rounded-md border border-line bg-raised/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
        *Arr rejects a root folder it cannot see. If a path is missing on the host or not mapped
        into that container, the step fails and the queue halts there - nothing after it runs.
      </p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!valid" :loading="queue.busy" @click="confirm()">
        Stage {{ pairs.length }} root folder(s) on {{ selected.length }} instance(s)
      </BaseButton>
    </template>
  </BaseModal>
</template>
