<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore } from '@/stores/queue';

const emit = defineEmits<{ close: [] }>();

const matrix = useMatrixStore();
const queue = useQueueStore();

const label = ref('');
const selected = ref<number[]>([]);

const candidates = computed(() =>
  matrix.healthyColumns.map((column) => ({
    instanceId: column.instance.id,
    name: column.instance.name,
    kind: column.instance.kind,
    alreadyHas: column.tags.some((tag) => tag.label === label.value.trim()),
  })),
);

const valid = computed(() => label.value.trim().length > 0 && selected.value.length > 0);

function toggle(instanceId: number): void {
  selected.value = selected.value.includes(instanceId)
    ? selected.value.filter((id) => id !== instanceId)
    : [...selected.value, instanceId];
}

async function confirm(): Promise<void> {
  const targets = selected.value.filter(
    (instanceId) => !candidates.value.find((entry) => entry.instanceId === instanceId)?.alreadyHas,
  );
  await queue.propagateTag(label.value.trim(), targets);
  emit('close');
}
</script>

<template>
  <BaseModal title="Add a tag to the fleet" subtitle="Staged per instance" @close="emit('close')">
    <div class="space-y-4">
      <label class="block">
        <span class="mb-1 block text-xs text-muted">Label</span>
        <input
          v-model="label"
          type="text"
          placeholder="4k-remux"
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
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!valid" :loading="queue.busy" @click="confirm()">
        Stage on {{ selected.length }} instance(s)
      </BaseButton>
    </template>
  </BaseModal>
</template>
