<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseCheckbox from '@/components/base/BaseCheckbox.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import IconWarning from '@/components/base/icons/IconWarning.vue';
import { importListCloneCandidates } from '@/lib/import-lists';
import type { ImportListRow } from '@/lib/matrix';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore } from '@/stores/queue';

/**
 * Copy this list onto other same-kind instances. The dest POST is a clone of the
 * source raw body; tag ids are stripped at execute time because they do not transfer.
 */
const props = defineProps<{ row: ImportListRow }>();
const emit = defineEmits<{ close: [] }>();

const matrix = useMatrixStore();
const queue = useQueueStore();

const selected = ref<number[]>([]);

const candidates = computed(() => importListCloneCandidates(props.row, matrix.columns));

const missing = computed(() => candidates.value.filter((entry) => !entry.alreadyHas));

const pairs = computed(() =>
  selected.value.flatMap((instanceId) => {
    const candidate = candidates.value.find((entry) => entry.instanceId === instanceId);
    if (candidate === undefined || candidate.alreadyHas) return [];
    return [
      {
        instanceId,
        name: props.row.name,
        sourceInstanceId: candidate.source.instanceId,
        sourceImportListId: candidate.source.listId,
        rootFolderPath: candidate.source.rootFolderPath,
      },
    ];
  }),
);

const missingRootOn = computed(() =>
  pairs.value.filter((pair) => {
    if (pair.rootFolderPath.length === 0) return false;
    const column = matrix.columns.find((entry) => entry.instance.id === pair.instanceId);
    return !(column?.rootFolders.some((folder) => folder.path === pair.rootFolderPath) ?? false);
  }),
);

const valid = computed(() => pairs.value.length > 0);

function toggle(instanceId: number): void {
  selected.value = selected.value.includes(instanceId)
    ? selected.value.filter((id) => id !== instanceId)
    : [...selected.value, instanceId];
}

function nameOf(instanceId: number): string {
  return candidates.value.find((entry) => entry.instanceId === instanceId)?.name ?? `instance ${String(instanceId)}`;
}

async function confirm(): Promise<void> {
  await queue.createImportListAcross(pairs.value);
  emit('close');
}
</script>

<template>
  <BaseModal
    :title="`Copy “${row.name}” onto the fleet`"
    subtitle="Staged per instance - the dest gets a POST of the source list, tags stripped"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <span class="text-xs text-muted">Target instances</span>
          <button
            type="button"
            class="text-[11px] text-accent hover:underline"
            @click="selected = missing.map((entry) => entry.instanceId)"
          >
            select all that do not have it
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
                <BaseCheckbox
                  :model-value="selected.includes(candidate.instanceId)"
                  :disabled="candidate.alreadyHas"
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

      <p
        v-if="valid && missingRootOn.length > 0"
        class="rounded-md border border-drift/40 bg-drift/5 px-3 py-2 text-[11px] leading-relaxed text-drift"
      >
        <IconWarning />
        {{ missingRootOn[0]?.rootFolderPath }} is not a root folder on
        {{ missingRootOn.map((pair) => nameOf(pair.instanceId)).join(', ') }}. *Arr may reject the
        create there - the path is copied as-is, never translated.
      </p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!valid" :loading="queue.busy" @click="confirm()">
        Stage {{ pairs.length }} cop{{ pairs.length === 1 ? 'y' : 'ies' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
