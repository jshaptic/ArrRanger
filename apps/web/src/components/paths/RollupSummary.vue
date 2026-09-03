<script setup lang="ts">
import { computed } from 'vue';
import type { PathMatrixLevel } from '@arrranger/shared';
import BaseButton from '@/components/base/BaseButton.vue';
import { rollupChips } from '@/lib/path-matrix';
import { pluralise } from '@/lib/format';

const props = defineProps<{
  level: PathMatrixLevel;
  depth: number;
  columns: number;
  busy: boolean;
  /** The active name filter, so the line can say what it is really describing. */
  filter: string;
}>();

const emit = defineEmits<{ showAll: []; showMore: [] }>();

const filtering = computed(() => props.filter.trim().length > 0);
const shown = computed(() => props.level.offset + props.level.nodes.length);

/**
 * One plain sentence about why the rows above are not the whole folder.
 *
 * Filtering and paging are different statements: during a search the folder's own state
 * counts describe entries that are not on screen, so they are left out entirely.
 */
const sentence = computed(() => {
  // pluralise() carries the count itself, e.g. "814 folders".
  const total = pluralise(props.level.rollup.entries, 'folder');

  if (filtering.value) {
    return `${String(props.level.matched)} of ${total} here match “${props.filter.trim()}”`;
  }
  return `showing ${String(shown.value)} of ${total} here`;
});

/** State counts, but only when they describe what the rows above actually are. */
const chips = computed(() => (filtering.value ? [] : rollupChips(props.level)));
</script>

<template>
  <tr class="border-b border-line bg-raised/30">
    <th scope="row" class="sticky left-0 z-10 bg-raised/60 px-3 py-1.5 text-left font-normal">
      <div
        class="flex flex-wrap items-center gap-x-2 gap-y-1"
        :style="{ paddingLeft: `${String(depth * 0.9)}rem` }"
      >
        <span class="text-faint">└</span>
        <span class="text-muted">{{ sentence }}</span>
        <span
          v-for="chip in chips"
          :key="chip.label"
          class="text-[11px]"
          :class="chip.tone"
          :title="chip.title"
        >
          · {{ chip.count }} {{ chip.label }}
        </span>
      </div>
    </th>

    <td :colspan="columns" class="border-l border-line px-2 py-1.5">
      <div class="flex flex-wrap items-center justify-end gap-1">
        <BaseButton v-if="level.truncated" size="sm" variant="ghost" :loading="busy" @click="emit('showMore')">
          show more
        </BaseButton>
        <BaseButton
          v-if="!filtering && (level.selection.length !== 1 || level.selection[0] !== 'all')"
          size="sm"
          variant="ghost"
          :loading="busy"
          title="List every folder here"
          @click="emit('showAll')"
        >
          show all {{ level.rollup.entries }}
        </BaseButton>
      </div>
    </td>
  </tr>
</template>
