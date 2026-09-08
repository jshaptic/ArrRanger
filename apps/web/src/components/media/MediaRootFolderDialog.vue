<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseCheckbox from '@/components/base/BaseCheckbox.vue';
import BaseModal from '@/components/base/BaseModal.vue';
import BaseInstanceBadge from '@/components/base/BaseInstanceBadge.vue';
import IconCreate from '@/components/base/icons/IconCreate.vue';
import IconWarning from '@/components/base/icons/IconWarning.vue';
import { useMediaStore } from '@/stores/media';
import { useQueueStore, type MediaMoveTarget, type MediaTarget } from '@/stores/queue';

/**
 * Move the selected copies to a root folder chosen **per instance**.
 *
 * One box per instance rather than one for the fleet, and they start blank on purpose:
 * ArrRanger never translates a path from one instance onto another, and pre-filling them all
 * from a single value is exactly how a translation sneaks in wearing a convenience's clothes.
 */
const props = defineProps<{ targets: readonly MediaTarget[] }>();
const emit = defineEmits<{ close: [] }>();

const media = useMediaStore();
const queue = useQueueStore();

const destinations = ref<Record<number, string>>({});
const moveFiles = ref(false);
const literal = ref('');

const rows = computed(() =>
  props.targets.map((target) => {
    const column = media.columnFor(target.instanceId);
    const typed = (destinations.value[target.instanceId] ?? '').trim();
    const roots = column?.rootFolders ?? [];
    return {
      instanceId: target.instanceId,
      name: column?.name ?? `instance ${String(target.instanceId)}`,
      kind: column?.kind ?? 'radarr',
      items: target.mediaIds.length,
      mediaIds: target.mediaIds,
      roots,
      typed,
      needsRootFolder: typed.length > 0 && !roots.includes(typed),
    };
  }),
);

const participating = computed(() => rows.value.filter((row) => row.typed.startsWith('/')));

const totalItems = computed(() => participating.value.reduce((sum, row) => sum + row.items, 0));

const valid = computed(() => participating.value.length > 0);

/** Deliberately labelled as a copy, not an alignment: the same characters, nothing mapped. */
function copyLiteral(): void {
  const value = literal.value.trim();
  if (value.length === 0) return;
  destinations.value = Object.fromEntries(props.targets.map((target) => [target.instanceId, value]));
}

async function confirm(): Promise<void> {
  const targets: MediaMoveTarget[] = participating.value.map((row) => ({
    instanceId: row.instanceId,
    mediaIds: row.mediaIds,
    toRootFolderPath: row.typed,
    needsRootFolder: row.needsRootFolder,
  }));

  await queue.moveMediaAcross({ targets, moveFiles: moveFiles.value });
  emit('close');
}
</script>

<template>
  <BaseModal
    title="Change root folder"
    :subtitle="`${String(totalItems)} item(s) on ${String(participating.length)} instance(s)`"
    width="lg"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <div>
        <p class="mb-1.5 text-xs text-muted">Destination, per instance</p>
        <ul class="space-y-1">
          <li v-for="row in rows" :key="row.instanceId">
            <div
              class="flex flex-wrap items-center gap-2 rounded border border-line bg-raised/60 px-2.5 py-1.5 text-xs"
              data-testid="destination-row"
            >
              <span class="flex min-w-[9rem] items-center gap-2">
                <BaseInstanceBadge :name="row.name" :kind="row.kind" size="sm" />
                {{ row.name }}
              </span>
              <span class="text-[10px] text-faint">{{ row.items }} item(s)</span>
              <input
                v-model="destinations[row.instanceId]"
                type="text"
                :list="`roots-${String(row.instanceId)}`"
                :data-testid="`destination-${String(row.instanceId)}`"
                placeholder="/data/media/movies"
                class="min-w-0 flex-1 rounded border border-line bg-raised px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
              />
              <datalist :id="`roots-${String(row.instanceId)}`">
                <option v-for="root in row.roots" :key="root" :value="root" />
              </datalist>
              <span
                v-if="row.needsRootFolder"
                class="rounded border border-sync/40 bg-sync/10 px-1.5 py-0.5 text-[11px] text-sync"
                title="Not a root folder here yet - it is created first, and the move waits on it"
              >
                <IconCreate size="xs" /> will be created
              </span>
            </div>
          </li>
        </ul>
      </div>

      <div class="flex flex-wrap items-center gap-2 rounded-md border border-line bg-raised/40 px-3 py-2">
        <input
          v-model="literal"
          type="text"
          data-testid="literal-path"
          placeholder="/data/media/movies"
          class="min-w-0 flex-1 rounded border border-line bg-raised px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
        />
        <BaseButton size="sm" variant="ghost" data-testid="copy-literal" @click="copyLiteral()">
          copy this literal path to every instance
        </BaseButton>
      </div>

      <p class="text-[11px] leading-relaxed text-muted">
        The path is copied as-is, never translated - ArrRanger does not map one instance's paths
        onto another's, and each instance must see the folder at exactly the path written here.
      </p>

      <div class="rounded-md border border-line bg-raised/40 px-3 py-2.5">
        <label class="flex items-start gap-2 text-xs">
          <BaseCheckbox v-model="moveFiles" data-testid="move-files" tone="danger" class="mt-0.5" />
          <span>
            <span class="font-medium text-ink">Move the files on disk</span>
            <span class="block text-[11px] leading-relaxed text-muted">
              <template v-if="moveFiles">
                <span class="text-danger">
                  <IconWarning /> *Arr will physically relocate {{ totalItems }} item(s). This is
                  slow, needs free space at the destination, and cannot be undone by ArrRanger.
                </span>
              </template>
              <template v-else>
                Off: only the root folder assignment changes. Existing files stay where they are
                and *Arr keeps their current paths.
              </template>
            </span>
          </span>
        </label>
      </div>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton
        :variant="moveFiles ? 'danger' : 'primary'"
        :disabled="!valid"
        :loading="queue.busy"
        data-testid="move-confirm"
        @click="confirm()"
      >
        Stage move of {{ totalItems }} item(s)
      </BaseButton>
    </template>
  </BaseModal>
</template>
