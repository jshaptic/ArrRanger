import type {
  FsEntry,
  FsMeasurement,
  FsOp,
  FsPreflight,
  FsRoot,
  QueuePayloadFor,
  ReconcileReport,
} from '@arrranger/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { ApiRequestError } from '@/api/client';
import { storageApi } from '@/api/storage';
import { classifyEntries, indexReconcile, missingUnder, type ClassifiedEntry } from '@/lib/fs-tree';
import { useUiStore } from './ui';

function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : 'Request failed';
}

export interface DirectoryState {
  readonly entries: readonly FsEntry[];
  readonly parent: string | null;
  readonly error: string | null;
  readonly loading: boolean;
}

/**
 * Storage state: roots, lazily loaded directories, measurements, and the reconcile report
 * that says which folders *Arr knows about.
 */
export const useFilesystemStore = defineStore('filesystem', () => {
  const ui = useUiStore();

  const enabled = ref(false);
  const roots = ref<readonly FsRoot[]>([]);
  const directories = ref<Record<string, DirectoryState>>({});
  const measurements = ref<Record<string, FsMeasurement>>({});
  const measuring = ref<Record<string, boolean>>({});
  const expanded = ref<string[]>([]);
  const currentPath = ref<string | null>(null);
  const report = ref<ReconcileReport | null>(null);
  const loadingRoots = ref(false);
  const loadingReport = ref(false);

  const reconcileIndex = computed(() => indexReconcile(report.value));

  const usableRoots = computed(() => roots.value.filter((root) => root.exists));
  const rootPaths = computed(() => usableRoots.value.map((root) => root.path));

  const unwritableRoots = computed(() =>
    roots.value.filter((root) => root.exists && !root.writable),
  );
  const brokenRoots = computed(() => roots.value.filter((root) => !root.exists));

  const currentDirectory = computed<DirectoryState | null>(() =>
    currentPath.value === null ? null : (directories.value[currentPath.value] ?? null),
  );

  /** Rows for the listing pane: real entries plus the *Arr paths that should be here. */
  const currentEntries = computed<ClassifiedEntry[]>(() => {
    const directory = currentDirectory.value;
    if (directory === null) return [];
    return classifyEntries(directory.entries, reconcileIndex.value);
  });

  const currentMissing = computed(() =>
    currentPath.value === null ? [] : missingUnder(report.value, currentPath.value),
  );

  const orphanCount = computed(() => report.value?.counts.orphan ?? 0);
  const missingCount = computed(() => report.value?.counts.missing ?? 0);
  const mismatches = computed(() => report.value?.mismatches ?? []);

  async function loadRoots(): Promise<void> {
    loadingRoots.value = true;
    try {
      const response = await storageApi.roots();
      enabled.value = response.enabled;
      roots.value = response.roots;

      if (currentPath.value === null) {
        const first = response.roots.find((root) => root.exists);
        if (first !== undefined) {
          currentPath.value = first.path;
          expanded.value = [first.path];
          await openDirectory(first.path);
        }
      }
    } catch (caught) {
      ui.notify('error', `Could not read storage roots: ${messageOf(caught)}`);
    } finally {
      loadingRoots.value = false;
    }
  }

  /** Reads one directory. Lazy on purpose: a library is far too large to walk eagerly. */
  async function openDirectory(target: string, options: { force?: boolean } = {}): Promise<void> {
    const known = directories.value[target];
    if (known !== undefined && !known.loading && options.force !== true) return;

    directories.value = {
      ...directories.value,
      [target]: { entries: known?.entries ?? [], parent: known?.parent ?? null, error: null, loading: true },
    };

    try {
      const response = await storageApi.list(target);
      directories.value = {
        ...directories.value,
        [target]: { entries: response.entries, parent: response.parent, error: null, loading: false },
      };
    } catch (caught) {
      directories.value = {
        ...directories.value,
        [target]: { entries: [], parent: null, error: messageOf(caught), loading: false },
      };
    }
  }

  async function navigate(target: string): Promise<void> {
    currentPath.value = target;
    if (!expanded.value.includes(target)) expanded.value = [...expanded.value, target];
    await openDirectory(target, { force: true });
  }

  async function toggle(target: string): Promise<void> {
    if (expanded.value.includes(target)) {
      expanded.value = expanded.value.filter((entry) => entry !== target);
      return;
    }
    expanded.value = [...expanded.value, target];
    await openDirectory(target);
  }

  function childrenOf(target: string): readonly FsEntry[] {
    return (directories.value[target]?.entries ?? []).filter((entry) => entry.kind === 'directory');
  }

  /** Recursive size, on demand only - this is the expensive call. */
  async function measure(target: string): Promise<void> {
    measuring.value = { ...measuring.value, [target]: true };
    try {
      const measurement = await storageApi.measure(target);
      measurements.value = { ...measurements.value, [target]: measurement };
    } catch (caught) {
      ui.notify('error', `Could not measure ${target}: ${messageOf(caught)}`);
    } finally {
      const next = { ...measuring.value };
      delete next[target];
      measuring.value = next;
    }
  }

  async function loadReport(refresh = false): Promise<void> {
    loadingReport.value = true;
    try {
      report.value = await storageApi.reconcile(refresh);
    } catch (caught) {
      // A disabled filesystem is not an error worth shouting about; the view explains it.
      if (caught instanceof ApiRequestError && caught.code === 'fs_disabled') {
        report.value = null;
      } else {
        ui.notify('error', `Could not reconcile storage: ${messageOf(caught)}`);
      }
    } finally {
      loadingReport.value = false;
    }
  }

  function preflight<K extends FsOp>(op: K, payload: QueuePayloadFor<K>): Promise<FsPreflight> {
    return storageApi.preflight(op, payload);
  }

  /** Called after a run mutates the disk. */
  async function refreshAll(): Promise<void> {
    measurements.value = {};
    const open = [...expanded.value];
    await Promise.all(open.map((target) => openDirectory(target, { force: true })));
    if (currentPath.value !== null) await openDirectory(currentPath.value, { force: true });
    await loadReport(true);
  }

  return {
    enabled,
    roots,
    directories,
    measurements,
    measuring,
    expanded,
    currentPath,
    report,
    loadingRoots,
    loadingReport,
    usableRoots,
    rootPaths,
    unwritableRoots,
    brokenRoots,
    currentDirectory,
    currentEntries,
    currentMissing,
    orphanCount,
    missingCount,
    mismatches,
    reconcileIndex,
    loadRoots,
    openDirectory,
    navigate,
    toggle,
    childrenOf,
    measure,
    loadReport,
    preflight,
    refreshAll,
  };
});
