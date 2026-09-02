<script setup lang="ts" generic="T extends string | number">
import { computed } from 'vue';

export interface SelectOption<V> {
  readonly value: V;
  readonly label: string;
}

type Size = 'sm' | 'md';

const props = withDefaults(
  defineProps<{
    options: readonly SelectOption<T>[];
    size?: Size;
    disabled?: boolean;
    title?: string;
  }>(),
  { size: 'md', disabled: false, title: undefined },
);

const model = defineModel<T>({ required: true });

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-9 px-3 text-sm',
};

const classes = computed(() => [
  'rounded-md border border-line bg-raised text-ink transition-colors',
  'outline-none focus:border-accent',
  'disabled:cursor-not-allowed disabled:opacity-40',
  SIZES[props.size],
]);
</script>

<template>
  <select v-model="model" :class="classes" :disabled="disabled" :title="title">
    <option v-for="option in options" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</template>
