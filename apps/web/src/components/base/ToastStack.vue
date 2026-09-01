<script setup lang="ts">
import { useUiStore } from '@/stores/ui';

const ui = useUiStore();

const STYLES = {
  success: 'border-sync/40 bg-sync/10 text-sync',
  error: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-line-strong bg-overlay text-ink',
} as const;
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
    <div
      v-for="toast in ui.toasts"
      :key="toast.id"
      class="pointer-events-auto flex items-start gap-3 rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur"
      :class="STYLES[toast.kind]"
      role="status"
    >
      <span class="flex-1 leading-relaxed">{{ toast.message }}</span>
      <button
        type="button"
        class="opacity-60 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
        @click="ui.dismiss(toast.id)"
      >
        ✕
      </button>
    </div>
  </div>
</template>
