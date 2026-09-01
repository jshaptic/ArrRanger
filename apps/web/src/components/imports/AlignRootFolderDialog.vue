<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import { useInstancesStore } from '@/stores/instances';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore, type ImportListTarget } from '@/stores/queue';

const props = defineProps<{ targets: readonly ImportListTarget[]; names: readonly string[] }>();
const emit = defineEmits<{ close: [] }>();

const matrix = useMatrixStore();
const instances = useInstancesStore();
const queue = useQueueStore();

const rootFolderPath = ref('');

const valid = computed(() => rootFolderPath.value.trim().startsWith('/'));

/** A path the instance does not have would make *Arr reject the whole PUT. */
const missingOn = computed(() =>
  props.targets.filter((target) => {
    const column = matrix.columns.find((entry) => entry.instance.id === target.instanceId);
    return !(
      column?.rootFolders.some((folder) => folder.path === rootFolderPath.value.trim()) ?? false
    );
  }),
);

function nameOf(instanceId: number): string {
  return instances.byId.get(instanceId)?.name ?? `instance ${String(instanceId)}`;
}

async function confirm(): Promise<void> {
  await queue.updateImportListsAcross(props.targets, {
    rootFolderPath: rootFolderPath.value.trim(),
  });
  emit('close');
}
</script>

<template>
  <BaseModal
    title="Align import list root folder"
    :subtitle="`${props.targets.length} list(s) across the fleet: ${props.names.join(', ')}`"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <label class="block">
        <span class="mb-1 block text-xs text-muted">Root folder every selected list should use</span>
        <input
          v-model="rootFolderPath"
          type="text"
          list="fleet-paths"
          placeholder="/data/media/movies"
          class="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
        />
        <datalist id="fleet-paths">
          <option v-for="path in matrix.allPaths" :key="path" :value="path" />
        </datalist>
      </label>

      <p
        v-if="valid && missingOn.length > 0"
        class="rounded-md border border-drift/40 bg-drift/5 px-3 py-2 text-[11px] leading-relaxed text-drift"
      >
        ⚠ {{ rootFolderPath }} is not a root folder on
        {{ missingOn.map((target) => nameOf(target.instanceId)).join(', ') }}. *Arr will reject the
        update there - stage the root folder in the Topology view first, or drop those instances
        from the selection.
      </p>

      <p class="text-[11px] leading-relaxed text-muted">
        The update round-trips each list's full body, so implementation-specific fields (list URL,
        credentials, monitor mode) are preserved untouched.
      </p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!valid" :loading="queue.busy" @click="confirm()">
        Stage {{ props.targets.length }} update(s)
      </BaseButton>
    </template>
  </BaseModal>
</template>
