<script setup lang="ts">
import type { InstanceSnapshot } from '@/lib/matrix';
import { useMatrixStore } from '@/stores/matrix';
import BaseInstanceBadge from '@/components/base/BaseInstanceBadge.vue';
import IconCheck from '@/components/base/icons/IconCheck.vue';

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
      <BaseInstanceBadge
        :name="column.instance.name"
        :kind="column.instance.kind"
        :tone="column.status === 'error' ? 'error' : 'kind'"
        size="lg"
      />
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
        <IconCheck size="xs" />
      </span>
    </button>
  </th>
</template>
