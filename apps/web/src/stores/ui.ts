import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
}

const AUTO_DISMISS_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 5000,
  // Failures stay until dismissed - they usually carry an *Arr error worth reading.
  error: 12_000,
};

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([]);
  const drawerOpen = ref(false);
  const executionOpen = ref(false);
  let nextId = 1;

  const hasToasts = computed(() => toasts.value.length > 0);

  function notify(kind: ToastKind, message: string): number {
    const id = nextId++;
    toasts.value = [...toasts.value, { id, kind, message }];
    window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS[kind]);
    return id;
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function openDrawer(): void {
    drawerOpen.value = true;
  }

  function toggleDrawer(): void {
    drawerOpen.value = !drawerOpen.value;
  }

  function openExecution(): void {
    executionOpen.value = true;
    drawerOpen.value = false;
  }

  function closeExecution(): void {
    executionOpen.value = false;
  }

  return {
    toasts,
    hasToasts,
    drawerOpen,
    executionOpen,
    notify,
    dismiss,
    openDrawer,
    toggleDrawer,
    openExecution,
    closeExecution,
  };
});
