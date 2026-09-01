<script setup lang="ts">
import { computed } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import { formatRelativeTime, initialsOf } from '@/lib/format';
import { useMatrixStore } from '@/stores/matrix';

const matrix = useMatrixStore();

const KIND_LABEL = { radarr: 'Radarr', sonarr: 'Sonarr' } as const;

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
          targeting {{ matrix.selectedInstanceIds.length }} of {{ matrix.columns.length }}
        </span>
        <BaseButton
          v-if="!allSelected"
          size="sm"
          variant="ghost"
          @click="matrix.clearSelection()"
        >
          target whole fleet
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
      {{ matrix.failedColumns.length }} instance(s) did not answer - their columns show
      <span class="font-mono">?</span> instead of "missing", and batch actions skip them.
    </p>
  </section>
</template>
