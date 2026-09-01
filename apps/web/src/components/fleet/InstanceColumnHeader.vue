<script setup lang="ts">
import { initialsOf } from '@/lib/format';
import type { InstanceSnapshot } from '@/lib/matrix';
import { useMatrixStore } from '@/stores/matrix';

defineProps<{ column: InstanceSnapshot }>();

const matrix = useMatrixStore();
</script>

<template>
  <th
    scope="col"
    class="border-b border-l border-line px-2 py-2 align-bottom"
    :class="matrix.isSelected(column.instance.id) ? 'bg-accent/5' : ''"
  >
    <button
      type="button"
      class="flex w-full flex-col items-center gap-1"
      :title="`Toggle ${column.instance.name} as a batch target`"
      @click="matrix.toggleInstance(column.instance.id)"
    >
      <span
        class="flex h-6 w-6 items-center justify-center rounded font-mono text-[10px] font-bold"
        :class="
          column.status === 'error'
            ? 'bg-danger/20 text-danger'
            : column.instance.kind === 'radarr'
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-sky-500/20 text-sky-300'
        "
      >
        {{ initialsOf(column.instance.name) }}
      </span>
      <span class="max-w-[7rem] truncate text-[11px] font-medium text-ink">
        {{ column.instance.name }}
      </span>
      <span
        class="inline-flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px]"
        :class="
          matrix.isSelected(column.instance.id)
            ? 'border-accent bg-accent/30 text-accent'
            : 'border-line-strong text-transparent'
        "
      >
        ✓
      </span>
    </button>
  </th>
</template>
