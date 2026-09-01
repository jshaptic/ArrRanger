<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import { findCollisions } from '@/lib/matrix';
import { useInstancesStore } from '@/stores/instances';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore } from '@/stores/queue';

const emit = defineEmits<{ close: [] }>();

const matrix = useMatrixStore();
const instances = useInstancesStore();
const queue = useQueueStore();

const find = ref('');
const replace = ref('');
const caseSensitive = ref(false);
const onlyTargets = ref(false);

const previews = computed(() =>
  matrix.findReplacePreview(find.value, replace.value, {
    caseSensitive: caseSensitive.value,
    onlySelected: onlyTargets.value,
  }),
);

const collisions = computed(() => findCollisions(matrix.columns, previews.value));

const merges = computed(() =>
  previews.value.filter((preview) =>
    collisions.value.has(`${String(preview.instanceId)}|${preview.to}`),
  ),
);

const renames = computed(() =>
  previews.value.filter(
    (preview) => !collisions.value.has(`${String(preview.instanceId)}|${preview.to}`),
  ),
);

const instancesTouched = computed(
  () => new Set(previews.value.map((preview) => preview.instanceId)).size,
);

function nameOf(instanceId: number): string {
  return instances.byId.get(instanceId)?.name ?? `instance ${String(instanceId)}`;
}

async function confirm(): Promise<void> {
  await queue.applyFindReplace(previews.value, collisions.value);
  emit('close');
}
</script>

<template>
  <BaseModal
    title="Find &amp; replace across the fleet"
    subtitle="Matches every tag label on every healthy instance at once"
    width="lg"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-xs text-muted">Find</span>
          <input
            v-model="find"
            type="text"
            placeholder="e.g. 4k-"
            class="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-muted">Replace with</span>
          <input
            v-model="replace"
            type="text"
            placeholder="e.g. uhd-"
            class="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
          />
        </label>
      </div>

      <div class="flex flex-wrap gap-4 text-xs text-muted">
        <label class="flex items-center gap-2">
          <input v-model="caseSensitive" type="checkbox" class="accent-[var(--color-accent)]" />
          case sensitive
        </label>
        <label class="flex items-center gap-2">
          <input v-model="onlyTargets" type="checkbox" class="accent-[var(--color-accent)]" />
          only the {{ matrix.targetInstanceIds.length }} targeted instance(s)
        </label>
      </div>

      <div v-if="find.length > 0">
        <p class="mb-1.5 text-xs text-muted">
          {{ previews.length }} match(es) on {{ instancesTouched }} instance(s)
          <span v-if="merges.length > 0" class="text-drift">
            · {{ merges.length }} become merges
          </span>
        </p>

        <ul v-if="previews.length > 0" class="max-h-64 space-y-1 overflow-y-auto">
          <li
            v-for="preview in previews"
            :key="`${preview.instanceId}-${preview.tagId}`"
            class="flex items-center justify-between gap-3 rounded border border-line bg-raised/60 px-2.5 py-1.5 text-xs"
          >
            <span class="font-mono">
              <span class="text-muted line-through opacity-70">{{ preview.from }}</span>
              <span class="mx-1.5 text-accent">→</span>
              <span class="text-ink">{{ preview.to }}</span>
            </span>
            <span class="flex items-center gap-2 text-[11px] whitespace-nowrap">
              <span
                v-if="collisions.has(`${preview.instanceId}|${preview.to}`)"
                class="rounded border border-drift/40 bg-drift/10 px-1.5 py-0.5 text-drift"
                title="A tag with the new label already exists here - the source tag is merged into it and deleted"
              >
                merge
              </span>
              <span class="text-muted">{{ nameOf(preview.instanceId) }}</span>
            </span>
          </li>
        </ul>

        <p v-else class="rounded border border-dashed border-line px-3 py-4 text-center text-xs text-faint">
          Nothing matches "{{ find }}".
        </p>
      </div>

      <p
        v-if="merges.length > 0"
        class="rounded-md border border-drift/40 bg-drift/5 px-3 py-2 text-[11px] leading-relaxed text-drift"
      >
        On {{ merges.length }} instance(s) the new label already exists. Those are staged as a
        merge: the media carrying the old tag gets the existing tag, then the old tag is deleted.
      </p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton
        variant="primary"
        :disabled="previews.length === 0"
        :loading="queue.busy"
        @click="confirm()"
      >
        Stage {{ renames.length }} rename(s)<span v-if="merges.length > 0">
          + {{ merges.length }} merge(s)</span
        >
      </BaseButton>
    </template>
  </BaseModal>
</template>
