<script setup lang="ts">
import { computed } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import { useInstancesStore } from '@/stores/instances';
import { useQueueStore, type RootFolderTarget } from '@/stores/queue';

const props = defineProps<{ targets: readonly RootFolderTarget[] }>();
const emit = defineEmits<{ close: [] }>();

const instances = useInstancesStore();
const queue = useQueueStore();

const paths = computed(() => [...new Set(props.targets.map((target) => target.path))]);

function nameOf(instanceId: number): string {
  return instances.byId.get(instanceId)?.name ?? `instance ${String(instanceId)}`;
}

async function confirm(): Promise<void> {
  await queue.deleteRootFolderAcross(props.targets);
  emit('close');
}
</script>

<template>
  <BaseModal
    title="Remove root folder(s) across the fleet"
    :subtitle="`${props.targets.length} operation(s) on ${paths.length} distinct path(s)`"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <ul class="max-h-56 space-y-1 overflow-y-auto">
        <li
          v-for="target in props.targets"
          :key="`${target.instanceId}-${target.path}`"
          class="flex items-center justify-between rounded border border-line bg-raised/60 px-2.5 py-1.5 text-xs"
        >
          <span class="font-mono text-danger line-through">{{ target.path }}</span>
          <span class="text-[11px] text-muted">{{ nameOf(target.instanceId) }}</span>
        </li>
      </ul>

      <p class="rounded-md border border-drift/40 bg-drift/5 px-3 py-2 text-[11px] leading-relaxed text-drift">
        ⚠ This only removes the root folder entry on each instance - it stops offering the path
        for new imports, but does not touch files on disk or media already assigned to it. If
        anything still points here, re-map it first instead of deleting the folder out from
        under it.
      </p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="danger" :loading="queue.busy" @click="confirm()">
        Stage {{ props.targets.length }} removal(s)
      </BaseButton>
    </template>
  </BaseModal>
</template>
