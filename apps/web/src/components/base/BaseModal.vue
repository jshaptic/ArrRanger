<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    width?: 'md' | 'lg' | 'xl';
    closable?: boolean;
  }>(),
  { subtitle: undefined, width: 'md', closable: true },
);

const emit = defineEmits<{ close: [] }>();

const WIDTHS = { md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' } as const;

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.closable) emit('close');
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8">
      <div
        class="w-full rounded-xl border border-line bg-overlay shadow-2xl"
        :class="WIDTHS[props.width]"
        role="dialog"
        aria-modal="true"
      >
        <header class="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 class="text-base font-semibold text-ink">{{ title }}</h2>
            <p v-if="subtitle" class="mt-1 text-xs text-muted">{{ subtitle }}</p>
          </div>
          <button
            v-if="closable"
            type="button"
            class="rounded-md px-2 py-1 text-muted transition-colors hover:bg-raised hover:text-ink"
            aria-label="Close"
            @click="emit('close')"
          >
            ✕
          </button>
        </header>

        <div class="px-5 py-4">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
