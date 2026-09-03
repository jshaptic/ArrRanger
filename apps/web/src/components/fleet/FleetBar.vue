<script setup lang="ts">
import { computed } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import { formatRelativeTime, initialsOf } from '@/lib/format';
import { useMatrixStore } from '@/stores/matrix';

/**
 * `target` - the selection is what batch actions fan out across (tags, import lists).
 * `filter` - the selection is what the view shows (paths, where a folder has one owner
 * and the dialogs ask which instance rather than the bar deciding silently).
 *
 * The two share `matrix.selectedInstanceIds`, so the copy has to say which it is or the
 * bar lies on one of the routes.
 */
const props = withDefaults(defineProps<{ mode?: 'target' | 'filter' }>(), { mode: 'target' });

const matrix = useMatrixStore();

const KIND_LABEL = { radarr: 'Radarr', sonarr: 'Sonarr' } as const;

const COPY = {
  target: {
    active: (selected: number, total: number) => `targeting ${String(selected)} of ${String(total)}`,
    clear: 'target whole fleet',
    unreachable: 'instead of "missing", and batch actions skip them.',
  },
  filter: {
    active: (selected: number, total: number) => `showing ${String(selected)} of ${String(total)}`,
    clear: 'show whole fleet',
    unreachable: 'instead of "missing", and their folders are not shown.',
  },
} as const;

const copy = computed(() => COPY[props.mode]);

const allSelected = computed(() => matrix.selectedInstanceIds.length === 0);

function chipClasses(instanceId: number, status: 'ok' | 'error' | 'loading'): string[] {
  const selected = allSelected.value || matrix.isSelected(instanceId);
  const base = ['border transition-colors'];

  if (status === 'error') {
    base.push(selected ? 'border-danger/60 bg-danger/15 text-danger' : 'border-danger/30 bg-raised text-danger/70');
  } else if (status === 'loading') {
    base.push('border-line bg-raised text-faint');
  } else {
    base.push(
      selected
        ? 'border-accent/60 bg-accent/10 text-ink'
        : 'border-line bg-raised text-faint hover:border-line-strong',
    );
  }

  return base;
}
</script>

<template>
  <section class="rounded-lg border border-line bg-raised/60 px-3 py-2.5">
    <div class="flex flex-wrap items-center gap-2">
      <span class="mr-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Fleet</span>

      <button
        v-for="column in matrix.columns"
        :key="column.instance.id"
        type="button"
        class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left"
        :class="chipClasses(column.instance.id, column.status)"
        :title="
          column.status === 'error'
            ? `${column.instance.name}: ${column.error ?? 'unreachable'}`
            : `${column.instance.name} · ${KIND_LABEL[column.instance.kind]} · snapshot ${formatRelativeTime(column.fetchedAt)}`
        "
        @click="matrix.toggleInstance(column.instance.id)"
      >
        <span
          class="flex h-5 w-5 items-center justify-center rounded font-mono text-[10px] font-bold"
          :class="
            column.instance.kind === 'radarr'
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-sky-500/20 text-sky-300'
          "
        >
          {{ initialsOf(column.instance.name) }}
        </span>
        <span class="flex flex-col leading-tight">
          <span class="text-xs font-medium">{{ column.instance.name }}</span>
          <span class="text-[10px] opacity-70">
            <template v-if="column.status === 'error'">unreachable</template>
            <template v-else-if="column.status === 'loading'">loading…</template>
            <template v-else>
              {{ column.tags.length }} tags · {{ column.rootFolders.length }} roots
            </template>
          </span>
        </span>
      </button>

      <div class="ml-auto flex items-center gap-2">
        <span v-if="!allSelected" class="text-[11px] text-staged">
          {{ copy.active(matrix.selectedInstanceIds.length, matrix.columns.length) }}
        </span>
        <BaseButton
          v-if="!allSelected"
          size="sm"
          variant="ghost"
          @click="matrix.clearSelection()"
        >
          {{ copy.clear }}
        </BaseButton>
        <span class="hidden text-[11px] text-faint sm:inline">
          snapshot {{ formatRelativeTime(matrix.lastLoadedAt) }}
        </span>
        <BaseButton size="sm" :loading="matrix.loading" @click="matrix.load({ refresh: true })">
          Refresh fleet
        </BaseButton>
      </div>
    </div>

    <p v-if="matrix.failedColumns.length > 0" class="mt-2 text-[11px] text-danger">
      {{ matrix.failedColumns.length }} instance(s) did not answer - they show
      <span class="font-mono">?</span> {{ copy.unreachable }}
    </p>
  </section>
</template>
