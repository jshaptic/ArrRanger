<script setup lang="ts">
import { computed } from 'vue';
import type { ParityState } from '@/lib/matrix';

const props = defineProps<{ parity: ParityState; presentOn: number; total: number }>();

const STYLES: Record<ParityState, string> = {
  full: 'border-sync/40 bg-sync/10 text-sync',
  partial: 'border-drift/40 bg-drift/10 text-drift',
  unique: 'border-line-strong bg-raised text-muted',
};

const LABELS: Record<ParityState, string> = {
  full: 'in sync',
  partial: 'drift',
  unique: 'single',
};

const title = computed(
  () => `Present on ${String(props.presentOn)} of ${String(props.total)} healthy instances`,
);
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap"
    :class="STYLES[props.parity]"
    :title="title"
  >
    {{ LABELS[props.parity] }}
    <span class="font-mono opacity-70">{{ props.presentOn }}/{{ props.total }}</span>
  </span>
</template>
