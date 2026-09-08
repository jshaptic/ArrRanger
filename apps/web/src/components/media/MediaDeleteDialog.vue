<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseCheckbox from '@/components/base/BaseCheckbox.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import BaseInstanceBadge from '@/components/base/BaseInstanceBadge.vue';
import IconWarning from '@/components/base/icons/IconWarning.vue';
import { formatBytes } from '@/lib/format';
import { useMediaStore } from '@/stores/media';
import { useQueueStore, type MediaTarget } from '@/stores/queue';

/**
 * The strongest confirmation in the app, and the only place with a typed one.
 *
 * Everything else here is recoverable by re-staging; bytes removed from a disk are not. So
 * `deleteFiles` earns a gate nothing else has, and both flags start off - defaulting either
 * would decide the irreversible half on someone's behalf.
 */
const props = defineProps<{ targets: readonly MediaTarget[] }>();
const emit = defineEmits<{ close: [] }>();

const media = useMediaStore();
const queue = useQueueStore();

const deleteFiles = ref(false);
const addImportExclusion = ref(false);
const typed = ref('');

const totalItems = computed(() =>
  props.targets.reduce((sum, target) => sum + target.mediaIds.length, 0),
);

const targetedIds = computed(() => new Set(props.targets.map((target) => target.instanceId)));

/** The titles about to go, with who holds each copy. */
const victims = computed(() =>
  media.selectedRows
    .map((row) => ({
      key: row.key,
      title: row.title,
      year: row.year,
      copies: row.facets.filter(
        (facet) => facet.matched && targetedIds.value.has(facet.instanceId),
      ),
    }))
    .filter((row) => row.copies.length > 0),
);

/**
 * How much would leave the disk.
 *
 * Summed across copies, because HD and 4K hold different files - and it is only ever the
 * copies actually being deleted, never the row's whole footprint.
 */
const bytes = computed(() => {
  const sizes = victims.value
    .flatMap((row) => row.copies.map((facet) => facet.sizeOnDisk))
    .filter((size): size is number => size !== null);
  return sizes.length === 0 ? null : sizes.reduce((sum, size) => sum + size, 0);
});

const confirmed = computed(
  () => !deleteFiles.value || typed.value.trim() === String(totalItems.value),
);

const valid = computed(() => totalItems.value > 0 && confirmed.value);

async function confirm(): Promise<void> {
  await queue.deleteMediaAcross(props.targets, {
    deleteFiles: deleteFiles.value,
    addImportExclusion: addImportExclusion.value,
  });
  emit('close');
}
</script>

<template>
  <BaseModal
    title="Delete media across the fleet"
    :subtitle="`${String(totalItems)} item(s) on ${String(props.targets.length)} instance(s)`"
    width="lg"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <ul class="max-h-56 space-y-1 overflow-y-auto rounded border border-line bg-raised/40 p-2">
        <li
          v-for="row in victims"
          :key="row.key"
          data-testid="delete-victim"
          class="flex flex-wrap items-center gap-2 text-xs"
        >
          <span class="text-danger line-through">
            {{ row.title }}<template v-if="row.year"> ({{ row.year }})</template>
          </span>
          <span v-for="facet in row.copies" :key="facet.instanceId" class="flex items-center gap-1">
            <BaseInstanceBadge :name="facet.name" :kind="facet.kind" size="sm" />
            <span class="font-mono text-[10px] text-faint">{{ facet.path || '—' }}</span>
          </span>
        </li>
      </ul>

      <div class="space-y-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5">
        <label class="flex items-start gap-2 text-xs">
          <BaseCheckbox
            v-model="deleteFiles"
            data-testid="delete-files"
            tone="danger"
            class="mt-0.5"
          />
          <span>
            <span class="font-medium text-ink">Also delete the files on disk</span>
            <span class="block text-[11px] leading-relaxed text-muted">
              <template v-if="deleteFiles">
                <span class="text-danger">
                  <IconWarning /> This removes
                  <span class="font-medium">{{ bytes === null ? 'an unknown amount' : formatBytes(bytes) }}</span>
                  and cannot be undone by ArrRanger.
                </span>
              </template>
              <template v-else>
                Off: the items leave *Arr, the files stay where they are.
              </template>
            </span>
          </span>
        </label>

        <label class="flex items-start gap-2 text-xs">
          <BaseCheckbox
            v-model="addImportExclusion"
            data-testid="add-import-exclusion"
            tone="danger"
            class="mt-0.5"
          />
          <span>
            <span class="font-medium text-ink">Add an import-list exclusion</span>
            <span class="block text-[11px] leading-relaxed text-muted">
              Leaving this off means the next list sync may bring everything straight back.
            </span>
          </span>
        </label>
      </div>

      <label v-if="deleteFiles" class="block" data-testid="delete-confirm-field">
        <span class="mb-1 block text-xs text-danger">
          Type <span class="font-mono">{{ totalItems }}</span> to confirm the file deletion
        </span>
        <input
          v-model="typed"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          data-testid="delete-confirm"
          class="w-32 rounded-md border border-danger/60 bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-danger"
        />
      </label>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton
        variant="danger"
        :disabled="!valid"
        :loading="queue.busy"
        data-testid="delete-confirm-button"
        @click="confirm()"
      >
        Delete {{ totalItems }} item(s){{ deleteFiles ? ' and their files' : '' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
