<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import EmptyState from '@/components/base/EmptyState.vue';
import DiskOperationModal, { type DiskOperation } from '@/components/storage/DiskOperationModal.vue';
import ReconcileDialog from '@/components/storage/ReconcileDialog.vue';
import { BADGE_STYLES, basename, breadcrumbs } from '@/lib/fs-tree';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { stagedIntent, TONE_CLASSES } from '@/lib/staging';
import { useFilesystemStore } from '@/stores/filesystem';
import { useInstancesStore } from '@/stores/instances';
import { useMatrixStore } from '@/stores/matrix';
import { useQueueStore } from '@/stores/queue';

const fs = useFilesystemStore();
const queue = useQueueStore();
const matrix = useMatrixStore();
const instances = useInstancesStore();

const filter = ref('');
const onlyProblems = ref(false);
const operation = ref<{ operation: DiskOperation; target: string } | null>(null);
const reconciling = ref<string | null>(null);

const crumbs = computed(() =>
  fs.currentPath === null ? [] : breadcrumbs(fs.currentPath, fs.rootPaths),
);

const rows = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  return fs.currentEntries.filter((row) => {
    if (needle.length > 0 && !row.entry.name.toLowerCase().includes(needle)) return false;
    if (onlyProblems.value) {
      return row.badges.some((badge) => badge === 'orphan' || badge === 'unreadable' || badge === 'empty');
    }
    return true;
  });
});

function instanceName(instanceId: number): string {
  return instances.byId.get(instanceId)?.name ?? `instance ${String(instanceId)}`;
}

/** A staged operation on this exact path, for the row badge. */
function stagedFor(path: string): ReturnType<typeof stagedIntent> {
  return stagedIntent(queue.stagedForPath(path));
}

onMounted(async () => {
  await fs.loadRoots();
  await Promise.all([fs.loadReport(), matrix.load()]);
});
</script>

<template>
  <div class="space-y-4">
    <!-- disabled state: say exactly what to add -->
    <EmptyState
      v-if="!fs.enabled && !fs.loadingRoots"
      title="Filesystem access is off"
      description="ArrRanger can inspect and reorganise media folders once it can see them. Mount your media at the same path the *Arr containers use, then set FS_ROOTS."
      icon="🗃"
    >
      <pre class="mt-1 overflow-x-auto rounded-md border border-line bg-raised px-3 py-2 text-left font-mono text-[11px] text-muted">volumes:
  - /mnt/user/data:/data:rw    # the same path Radarr/Sonarr see
environment:
  FS_ROOTS: /data
  PUID: "99"                   # must match the *Arr containers
  PGID: "100"
  UMASK: "002"</pre>
    </EmptyState>

    <template v-else>
      <!-- mapping mismatch: the diagnosis that saves an hour -->
      <section
        v-if="fs.mismatches.length > 0"
        class="rounded-lg border border-drift/40 bg-drift/5 px-4 py-3"
      >
        <h2 class="mb-2 text-sm font-semibold text-drift">
          ⚠ {{ fs.mismatches.length }} instance(s) describe paths this container cannot see
        </h2>
        <ul class="space-y-2 text-[11px]">
          <li v-for="mismatch in fs.mismatches" :key="mismatch.instanceId">
            <p class="text-ink">{{ instanceName(mismatch.instanceId) }}</p>
            <p class="text-muted">
              reports {{ mismatch.mediaPathCount }} media path(s) under
              <span class="font-mono">{{ mismatch.reportedPaths.join(', ') || 'no root folders' }}</span>
            </p>
            <p class="text-muted">
              this container has <span class="font-mono">{{ mismatch.checkedRoots.join(', ') }}</span>
            </p>
          </li>
        </ul>
        <p class="mt-2 text-[11px] leading-relaxed text-muted">
          That is a volume mapping difference, not missing media. ArrRanger deliberately does
          not translate paths: mount the same host directory at the same container path as the
          *Arr apps, and this panel disappears.
        </p>
      </section>

      <section
        v-if="fs.unwritableRoots.length > 0 || fs.brokenRoots.length > 0"
        class="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-[11px] text-danger"
      >
        <p v-for="root in fs.unwritableRoots" :key="root.path">
          {{ root.path }} is readable but not writable - check PUID/PGID and UMASK against the
          *Arr containers.
        </p>
        <p v-for="root in fs.brokenRoots" :key="root.path">
          {{ root.path }} is not reachable: {{ root.error ?? 'missing' }}
        </p>
      </section>

      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="filter"
          type="search"
          placeholder="Filter this folder…"
          class="h-9 w-48 rounded-md border border-line bg-raised px-3 text-sm text-ink outline-none focus:border-accent"
        />
        <label class="flex items-center gap-2 text-[11px] text-muted">
          <input v-model="onlyProblems" type="checkbox" class="accent-[var(--color-accent)]" />
          only orphans, empty and unreadable
        </label>
        <span class="text-[11px] text-faint">
          scanned {{ formatRelativeTime(fs.report?.scannedAt) }}
        </span>
        <div class="ml-auto flex items-center gap-2">
          <BaseButton size="sm" :loading="fs.loadingReport" @click="fs.loadReport(true)">
            Rescan
          </BaseButton>
          <BaseButton
            v-if="fs.currentPath"
            size="sm"
            variant="primary"
            @click="operation = { operation: 'mkdir', target: fs.currentPath }"
          >
            New folder…
          </BaseButton>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <!-- tree -->
        <aside class="rounded-lg border border-line bg-raised/40 p-2">
          <p class="mb-1.5 px-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
            Mounts
          </p>
          <ul class="space-y-0.5 text-xs">
            <li v-for="root in fs.usableRoots" :key="root.path">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors"
                :class="fs.currentPath === root.path ? 'bg-overlay text-ink' : 'text-muted hover:text-ink'"
                @click="fs.navigate(root.path)"
              >
                <span class="truncate font-mono">{{ root.path }}</span>
                <span class="shrink-0 text-[10px] text-faint">{{ formatBytes(root.freeSpace) }}</span>
              </button>

              <ul class="ml-3 space-y-0.5 border-l border-line pl-2">
                <li v-for="child in fs.childrenOf(root.path)" :key="child.path">
                  <button
                    type="button"
                    class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors"
                    :class="fs.currentPath === child.path ? 'bg-overlay text-ink' : 'text-muted hover:text-ink'"
                    @click="fs.navigate(child.path)"
                  >
                    <span class="truncate">{{ child.name }}</span>
                    <span v-if="child.childCount !== null" class="ml-auto text-[10px] text-faint">
                      {{ child.childCount }}
                    </span>
                  </button>
                </li>
              </ul>
            </li>
          </ul>
        </aside>

        <!-- listing -->
        <section class="min-w-0">
          <nav class="mb-2 flex flex-wrap items-center gap-1 text-[11px] text-muted">
            <template v-for="(crumb, index) in crumbs" :key="crumb.path">
              <span v-if="index > 0" class="text-faint">/</span>
              <button
                type="button"
                class="rounded px-1 font-mono transition-colors hover:text-ink"
                :class="index === crumbs.length - 1 ? 'text-ink' : ''"
                @click="fs.navigate(crumb.path)"
              >
                {{ crumb.label }}
              </button>
            </template>
          </nav>

          <p v-if="fs.currentDirectory?.error" class="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
            {{ fs.currentDirectory.error }}
          </p>

          <div v-else class="overflow-x-auto rounded-lg border border-line">
            <table class="w-full text-left text-xs">
              <thead class="bg-raised/60 text-[11px] text-muted">
                <tr>
                  <th class="px-3 py-2 font-semibold">Name</th>
                  <th class="px-3 py-2 font-semibold">State</th>
                  <th class="px-3 py-2 font-semibold">Size</th>
                  <th class="px-3 py-2 font-semibold">Modified</th>
                  <th class="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                <!-- paths an instance believes in that are not here -->
                <tr
                  v-for="missing in fs.currentMissing"
                  :key="missing"
                  class="border-t border-line bg-danger/5"
                >
                  <td class="px-3 py-2 font-mono text-danger line-through">{{ basename(missing) }}</td>
                  <td class="px-3 py-2">
                    <span
                      class="rounded border px-1.5 py-0.5 text-[10px]"
                      :class="BADGE_STYLES.missing.classes"
                      :title="BADGE_STYLES.missing.title"
                    >
                      {{ BADGE_STYLES.missing.label }}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-faint">—</td>
                  <td class="px-3 py-2 text-faint">—</td>
                  <td class="px-3 py-2 text-right text-[11px] text-muted">
                    an instance points here
                  </td>
                </tr>

                <tr
                  v-for="row in rows"
                  :key="row.entry.path"
                  class="group border-t border-line hover:bg-raised/40"
                >
                  <td class="px-3 py-2">
                    <button
                      type="button"
                      class="flex items-center gap-2 text-left"
                      :disabled="row.entry.kind !== 'directory'"
                      @click="row.entry.kind === 'directory' && fs.navigate(row.entry.path)"
                    >
                      <span class="text-faint">
                        {{ row.entry.kind === 'directory' ? '▸' : row.entry.kind === 'symlink' ? '⇢' : '·' }}
                      </span>
                      <span
                        class="font-mono"
                        :class="stagedFor(row.entry.path)?.tone === 'destroy' ? 'text-danger line-through' : 'text-ink'"
                      >
                        {{ row.entry.name }}
                      </span>
                    </button>
                  </td>
                  <td class="px-3 py-2">
                    <span class="flex flex-wrap items-center gap-1">
                      <span
                        v-for="badge in row.badges"
                        :key="badge"
                        class="rounded border px-1.5 py-0.5 text-[10px]"
                        :class="BADGE_STYLES[badge].classes"
                        :title="BADGE_STYLES[badge].title"
                      >
                        {{ BADGE_STYLES[badge].label }}
                      </span>
                      <span
                        v-if="stagedFor(row.entry.path)"
                        class="rounded border px-1.5 py-0.5 text-[10px]"
                        :class="TONE_CLASSES[stagedFor(row.entry.path)!.tone]"
                        :title="`${stagedFor(row.entry.path)!.label} is staged for this folder`"
                      >
                        {{ stagedFor(row.entry.path)!.icon }} staged
                      </span>
                      <span
                        v-if="row.instanceIds.length > 0"
                        class="text-[10px] text-faint"
                        :title="row.instanceIds.map(instanceName).join(', ')"
                      >
                        {{ row.instanceIds.length }} instance(s)
                      </span>
                    </span>
                  </td>
                  <td class="px-3 py-2 font-mono text-[11px] text-muted">
                    <template v-if="fs.measurements[row.entry.path]">
                      {{ formatBytes(fs.measurements[row.entry.path]?.sizeOnDisk ?? 0) }}
                    </template>
                    <template v-else-if="row.entry.sizeOnDisk !== null">
                      {{ formatBytes(row.entry.sizeOnDisk) }}
                    </template>
                    <button
                      v-else-if="row.entry.kind === 'directory'"
                      type="button"
                      class="text-accent hover:underline"
                      :disabled="fs.measuring[row.entry.path] === true"
                      @click="fs.measure(row.entry.path)"
                    >
                      {{ fs.measuring[row.entry.path] ? 'measuring…' : 'measure' }}
                    </button>
                    <span v-else>—</span>
                  </td>
                  <td class="px-3 py-2 text-[11px] text-muted">
                    {{ formatRelativeTime(row.entry.modifiedAt) }}
                  </td>
                  <td class="px-3 py-2 text-right whitespace-nowrap">
                    <span class="inline-flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <BaseButton
                        v-if="row.instanceIds.length > 0 || row.badges.includes('tracked')"
                        size="sm"
                        variant="ghost"
                        title="Rename on disk and realign the instances that track it"
                        @click="reconciling = row.entry.path"
                      >
                        reconcile
                      </BaseButton>
                      <BaseButton
                        size="sm"
                        variant="ghost"
                        :disabled="row.entry.kind !== 'directory'"
                        @click="operation = { operation: 'rename', target: row.entry.path }"
                      >
                        rename
                      </BaseButton>
                      <BaseButton
                        size="sm"
                        variant="ghost"
                        :disabled="row.entry.kind !== 'directory'"
                        @click="operation = { operation: 'move', target: row.entry.path }"
                      >
                        move
                      </BaseButton>
                      <BaseButton
                        size="sm"
                        variant="ghost"
                        :disabled="row.entry.kind !== 'directory'"
                        @click="operation = { operation: 'delete', target: row.entry.path }"
                      >
                        prune
                      </BaseButton>
                    </span>
                  </td>
                </tr>

                <tr v-if="rows.length === 0 && fs.currentMissing.length === 0">
                  <td colspan="5" class="px-3 py-8 text-center text-xs text-faint">
                    {{ fs.currentDirectory?.loading ? 'Reading…' : 'Nothing here' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p class="mt-2 text-[11px] leading-relaxed text-muted">
            Disk operations are staged like any other change: they land in Pending Fleet Changes,
            run in order with the *Arr steps, and their preflight runs again immediately before
            execution. Symlinks are shown but never followed or modified.
          </p>
        </section>
      </div>
    </template>

    <DiskOperationModal
      v-if="operation"
      :operation="operation.operation"
      :target="operation.target"
      @close="operation = null"
    />
    <ReconcileDialog v-if="reconciling" :path="reconciling" @close="reconciling = null" />
  </div>
</template>
