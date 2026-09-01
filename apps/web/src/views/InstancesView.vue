<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Instance } from '@arrranger/shared';
import BaseButton from '@/components/base/BaseButton.vue';
import EmptyState from '@/components/base/EmptyState.vue';
import InstanceFormModal from '@/components/instances/InstanceFormModal.vue';
import { formatRelativeTime, initialsOf } from '@/lib/format';
import { useInstancesStore } from '@/stores/instances';
import { useMatrixStore } from '@/stores/matrix';
import { useUiStore } from '@/stores/ui';

const instances = useInstancesStore();
const matrix = useMatrixStore();
const ui = useUiStore();

const editing = ref<Instance | null | undefined>(undefined);
const confirmingRemoval = ref<Instance | null>(null);

const sorted = computed(() =>
  [...instances.items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'radarr' ? -1 : 1;
    return a.name.localeCompare(b.name, 'en');
  }),
);

function healthOf(instance: Instance): { label: string; classes: string } {
  if (!instance.enabled) return { label: 'disabled', classes: 'border-line bg-raised text-faint' };
  if (instance.lastError !== null) {
    return { label: 'unreachable', classes: 'border-danger/40 bg-danger/10 text-danger' };
  }
  if (instance.lastConnectedAt === null) {
    return { label: 'never probed', classes: 'border-drift/40 bg-drift/10 text-drift' };
  }
  return { label: 'connected', classes: 'border-sync/40 bg-sync/10 text-sync' };
}

async function probe(instance: Instance): Promise<void> {
  const result = await instances.test(instance.id);
  if (result.ok) {
    ui.notify('success', `${instance.name} answered - version ${result.appVersion ?? 'unknown'}`);
    await matrix.reload(instance.id, true);
  } else {
    ui.notify('error', `${instance.name}: ${result.error?.message ?? 'connection failed'}`);
  }
}

async function remove(instance: Instance): Promise<void> {
  await instances.remove(instance.id);
  matrix.prune();
  confirmingRemoval.value = null;
  ui.notify('info', `${instance.name} removed`);
}

onMounted(() => {
  if (!instances.loadedOnce) void instances.load();
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex gap-2 text-xs text-muted">
        <span class="rounded border border-line bg-raised px-2 py-1">
          {{ instances.radarr.length }} Radarr
        </span>
        <span class="rounded border border-line bg-raised px-2 py-1">
          {{ instances.sonarr.length }} Sonarr
        </span>
        <span
          v-if="instances.unreachable.length > 0"
          class="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-danger"
        >
          {{ instances.unreachable.length }} unreachable
        </span>
      </div>
      <BaseButton class="ml-auto" variant="primary" size="sm" @click="editing = null">
        Connect an instance
      </BaseButton>
    </div>

    <EmptyState
      v-if="sorted.length === 0"
      title="No instances yet"
      description="ArrRanger works across the whole fleet at once. Connect every Radarr and Sonarr you run - the comparison views only get useful with two or more."
      icon="🔌"
    >
      <BaseButton variant="primary" size="sm" @click="editing = null">Connect an instance</BaseButton>
    </EmptyState>

    <div v-else class="overflow-x-auto rounded-lg border border-line">
      <table class="w-full text-left text-xs">
        <thead class="bg-raised/60 text-[11px] text-muted">
          <tr>
            <th class="px-3 py-2 font-semibold">Instance</th>
            <th class="px-3 py-2 font-semibold">URL</th>
            <th class="px-3 py-2 font-semibold">Version</th>
            <th class="px-3 py-2 font-semibold">Last probe</th>
            <th class="px-3 py-2 font-semibold">Health</th>
            <th class="px-3 py-2 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="instance in sorted"
            :key="instance.id"
            class="border-t border-line hover:bg-raised/40"
          >
            <td class="px-3 py-2">
              <div class="flex items-center gap-2">
                <span
                  class="flex h-6 w-6 items-center justify-center rounded font-mono text-[10px] font-bold"
                  :class="
                    instance.kind === 'radarr'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-sky-500/20 text-sky-300'
                  "
                >
                  {{ initialsOf(instance.name) }}
                </span>
                <span>
                  <span class="block text-ink">{{ instance.name }}</span>
                  <span class="block text-[10px] text-faint uppercase">{{ instance.kind }}</span>
                </span>
              </div>
            </td>
            <td class="px-3 py-2 font-mono text-[11px] text-muted">
              {{ instance.baseUrl }}
              <span v-if="!instance.verifySsl" class="ml-1 text-drift" title="TLS verification is off">
                ⚠ no TLS check
              </span>
            </td>
            <td class="px-3 py-2 font-mono text-[11px] text-muted">
              {{ instance.appVersion ?? '—' }}
            </td>
            <td class="px-3 py-2 text-[11px] text-muted">
              {{ formatRelativeTime(instance.lastConnectedAt) }}
            </td>
            <td class="px-3 py-2">
              <span
                class="rounded border px-1.5 py-0.5 text-[10px]"
                :class="healthOf(instance).classes"
                :title="instance.lastError ?? ''"
              >
                {{ healthOf(instance).label }}
              </span>
            </td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              <span class="inline-flex gap-1">
                <BaseButton
                  size="sm"
                  variant="ghost"
                  :loading="instances.probing[instance.id] === true"
                  @click="probe(instance)"
                >
                  test
                </BaseButton>
                <BaseButton size="sm" variant="ghost" @click="editing = instance">edit</BaseButton>
                <BaseButton size="sm" variant="ghost" @click="confirmingRemoval = instance">
                  remove
                </BaseButton>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="instances.unreachable.length > 0" class="text-[11px] leading-relaxed text-muted">
      Unreachable instances stay in the fleet: their matrix columns show
      <span class="font-mono">?</span> rather than "missing", so a temporary outage never looks like
      a configuration gap - and batch actions skip them.
    </p>

    <InstanceFormModal
      v-if="editing !== undefined"
      :instance="editing"
      @close="editing = undefined"
    />

    <Teleport v-if="confirmingRemoval" to="body">
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div class="w-full max-w-md rounded-xl border border-line bg-overlay p-5">
          <h2 class="text-base font-semibold text-ink">Remove {{ confirmingRemoval.name }}?</h2>
          <p class="mt-2 text-xs leading-relaxed text-muted">
            ArrRanger forgets the connection and any staged operations targeting it. Nothing is
            changed on the instance itself.
          </p>
          <div class="mt-4 flex justify-end gap-2">
            <BaseButton variant="ghost" size="sm" @click="confirmingRemoval = null">Cancel</BaseButton>
            <BaseButton variant="danger" size="sm" @click="remove(confirmingRemoval)">Remove</BaseButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
