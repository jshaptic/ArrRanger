<script setup lang="ts">
import { computed } from 'vue';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md';

const props = withDefaults(
  defineProps<{
    variant?: Variant;
    size?: Size;
    disabled?: boolean;
    loading?: boolean;
    title?: string;
  }>(),
  { variant: 'secondary', size: 'md', disabled: false, loading: false, title: undefined },
);

defineEmits<{ click: [event: MouseEvent] }>();

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent/15 text-accent border-accent/40 hover:bg-accent/25',
  secondary: 'bg-raised text-ink border-line hover:border-line-strong hover:bg-overlay',
  ghost: 'bg-transparent text-muted border-transparent hover:text-ink hover:bg-raised',
  danger: 'bg-danger/10 text-danger border-danger/40 hover:bg-danger/20',
  success: 'bg-sync/15 text-sync border-sync/40 hover:bg-sync/25',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

const classes = computed(() => [
  'inline-flex items-center justify-center rounded-md border font-medium transition-colors',
  'disabled:cursor-not-allowed disabled:opacity-40',
  VARIANTS[props.variant],
  SIZES[props.size],
]);
</script>

<template>
  <button
    type="button"
    :class="classes"
    :disabled="disabled || loading"
    :title="title"
    @click="$emit('click', $event)"
  >
    <span
      v-if="loading"
      class="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
    />
    <slot />
  </button>
</template>
