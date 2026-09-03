<script setup lang="ts">
import type { PathFlag } from '@arrranger/shared';
import { FLAG_STYLES } from '@/lib/path-matrix';

defineProps<{ flag: PathFlag }>();
</script>

<template>
  <span
    class="rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap"
    :class="FLAG_STYLES[flag].classes"
    :title="FLAG_STYLES[flag].title"
  >
    {{ FLAG_STYLES[flag].label }}
  </span>
</template>
