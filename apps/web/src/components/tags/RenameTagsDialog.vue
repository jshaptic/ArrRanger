<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import { findCollisions } from '@/lib/matrix';
import { useInstancesStore } from '@/stores/instances';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore, type TagTarget } from '@/stores/queue';

const props = defineProps<{ label: string; targets: readonly TagTarget[] }>();
const emit = defineEmits<{ close: [] }>();

const matrix = useMatrixStore();
const instances = useInstancesStore();
const queue = useQueueStore();

const nextLabel = ref(props.label);

const collisions = computed(() =>
  findCollisions(
    matrix.columns,
    props.targets.map((target) => ({ instanceId: target.instanceId, to: nextLabel.value })),
  ),
);

const valid = computed(
  () => nextLabel.value.trim().length > 0 && nextLabel.value.trim() !== props.label,
);

function nameOf(instanceId: number): string {
  return instances.byId.get(instanceId)?.name ?? `instance ${String(instanceId)}`;
}

async function confirm(): Promise<void> {
  await queue.renameTagAcross(props.targets, nextLabel.value.trim());
  emit('close');
}
</script>

<template>
  <BaseModal
    title="Rename across selected instances"
    :subtitle="`One rename operation per instance that carries &quot;${props.label}&quot;`"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <label class="block">
        <span class="mb-1 block text-xs text-muted">New label</span>
        <input
          v-model="nextLabel"
          type="text"
          class="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          @keyup.enter="valid && confirm()"
        />
      </label>

      <div>
        <p class="mb-1.5 text-xs text-muted">
          {{ props.targets.length }} instance(s) will be renamed:
        </p>
        <ul class="space-y-1">
          <li
            v-for="target in props.targets"
            :key="target.instanceId"
            class="flex items-center justify-between rounded border border-line bg-raised/60 px-2.5 py-1.5 text-xs"
          >
            <span class="text-ink">{{ nameOf(target.instanceId) }}</span>
            <span class="font-mono text-[11px] text-muted">
              <span class="line-through opacity-60">{{ target.label }}</span>
              <span class="mx-1 text-accent">→</span>
              <span class="text-ink">{{ nextLabel || '…' }}</span>
            </span>
          </li>
        </ul>
      </div>

      <p
        v-if="collisions.size > 0"
        class="rounded-md border border-drift/40 bg-drift/5 px-3 py-2 text-[11px] leading-relaxed text-drift"
      >
        ⚠ {{ collisions.size }} instance(s) already have a tag called "{{ nextLabel }}". A rename
        there would be rejected by *Arr - use Find &amp; Replace instead, which merges into the
        existing tag rather than colliding with it.
      </p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton
        variant="primary"
        :disabled="!valid || collisions.size > 0"
        :loading="queue.busy"
        @click="confirm()"
      >
        Stage {{ props.targets.length }} rename(s)
      </BaseButton>
    </template>
  </BaseModal>
</template>
