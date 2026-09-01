<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import ToastStack from '@/components/base/ToastStack.vue';
import ExecutionModal from '@/components/staging/ExecutionModal.vue';
import StagingDrawer from '@/components/staging/StagingDrawer.vue';
import { useFilesystemStore } from '@/stores/filesystem';
import { useInstancesStore } from '@/stores/instances';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore } from '@/stores/queue';
import { useUiStore } from '@/stores/ui';

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly hint: string;
}

const NAV: readonly NavItem[] = [
  { to: '/tags', label: 'Tag parity', hint: 'fleet-wide tag matrix' },
  { to: '/root-folders', label: 'Root folders', hint: 'path topology & drift' },
  { to: '/import-lists', label: 'Import lists', hint: 'settings comparison' },
  { to: '/storage', label: 'Storage', hint: 'folders on disk & drift' },
  { to: '/queue', label: 'Queue', hint: 'staged operations' },
  { to: '/instances', label: 'Instances', hint: 'connections' },
];

const route = useRoute();
const ui = useUiStore();
const instances = useInstancesStore();
const matrix = useMatrixStore();
const queue = useQueueStore();
const filesystem = useFilesystemStore();

const title = computed(() => route.meta.title ?? 'ArrRanger');
const hint = computed(() => route.meta.hint ?? '');

const fleetHealth = computed(() => {
  const stats = matrix.stats;
  if (stats.instances === 0) return { label: 'no instances', classes: 'text-faint' };
  if (stats.failing > 0) {
    return { label: `${String(stats.failing)}/${String(stats.instances)} unreachable`, classes: 'text-danger' };
  }
  if (stats.tagsDrifted > 0 || stats.pathDiscrepancies > 0) {
    return {
      label: `${String(stats.tagsDrifted)} tag gaps · ${String(stats.pathDiscrepancies)} path conflicts`,
      classes: 'text-drift',
    };
  }
  return { label: 'fleet in sync', classes: 'text-sync' };
});

onMounted(async () => {
  await instances.load();
  await Promise.all([matrix.load(), queue.load(), filesystem.loadRoots()]);
  if (filesystem.enabled) await filesystem.loadReport();
  if (queue.staged.length > 0) ui.openDrawer();
});

// A run that touched the disk invalidates both the listings and the orphan report.
watch(
  () => queue.activeRun?.status,
  (status, previous) => {
    if (previous === 'running' && status !== 'running' && filesystem.enabled) {
      void filesystem.refreshAll();
    }
  },
);
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3">
      <div class="flex items-baseline gap-2.5">
        <span class="text-base font-semibold tracking-tight text-ink">ArrRanger</span>
        <span class="hidden text-[11px] text-faint sm:inline">
          one pane of glass over every Radarr &amp; Sonarr
        </span>
      </div>

      <nav class="order-3 flex flex-wrap gap-1 md:order-none">
        <RouterLink
          v-for="item in NAV"
          :key="item.to"
          :to="item.to"
          class="rounded-md px-2.5 py-1.5 text-xs transition-colors"
          :class="
            route.path === item.to
              ? 'bg-raised text-ink'
              : 'text-muted hover:bg-raised/60 hover:text-ink'
          "
          :title="item.hint"
        >
          {{ item.label }}
          <span
            v-if="item.to === '/queue' && queue.staged.length > 0"
            class="ml-1 rounded-full border border-staged/50 bg-staged/10 px-1.5 text-[10px] text-staged"
          >
            {{ queue.staged.length }}
          </span>
          <span
            v-if="item.to === '/storage' && filesystem.orphanCount + filesystem.missingCount > 0"
            class="ml-1 rounded-full border border-drift/50 bg-drift/10 px-1.5 text-[10px] text-drift"
            title="Orphaned folders on disk plus *Arr paths that do not exist"
          >
            {{ filesystem.orphanCount + filesystem.missingCount }}
          </span>
        </RouterLink>
      </nav>

      <div class="ml-auto flex items-center gap-3 text-[11px]">
        <span :class="fleetHealth.classes">{{ fleetHealth.label }}</span>
        <span class="text-faint">
          {{ matrix.stats.healthy }}/{{ matrix.stats.instances }} instances
        </span>
      </div>
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-24">
      <div class="mb-4">
        <h1 class="text-lg font-semibold text-ink">{{ title }}</h1>
        <p v-if="hint" class="text-xs text-muted">{{ hint }}</p>
      </div>
      <RouterView />
    </main>

    <StagingDrawer />
    <ExecutionModal />
    <ToastStack />
  </div>
</template>
