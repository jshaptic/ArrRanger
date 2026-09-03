import type {
  FsMeasurement,
  FsOp,
  FsPreflight,
  FsRoot,
  MappingMismatch,
  PathMatrixColumn,
  PathMatrixLevel,
  PathMatrixResponse,
  PathMatrixTotals,
  PathNode,
  QueuePayloadFor,
} from '@arrranger/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { ApiRequestError } from '@/api/client';
import { storageApi } from '@/api/storage';
import {
  flattenLeaves,
  flattenLevels,
  levelKey,
  rootFolderTargets,
  TOP_LEVEL,
  type PathRow,
  type RootFolderCellTarget,
} from '@/lib/path-matrix';
import { useUiStore } from './ui';

function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : 'Request failed';
}

function emptyTotals(): PathMatrixTotals {
  return {
    rootFolderPaths: 0,
    unseenRootFolders: 0,
    unmanaged: 0,
    untracked: 0,
    missing: 0,
    candidates: 0,
  };
}

/**
 * The joined storage view: mounts, root folders and what is on disk, in one tree.
 *
 * Levels are fetched lazily and cached by path. Nothing here walks a library - the
 * server summarises a big directory and returns only the rows worth showing, which is
 * why expanding a folder with 812 films costs one request and a handful of rows.
 */
export const usePathsStore = defineStore('paths', () => {
  const ui = useUiStore();

  const enabled = ref(false);
  const roots = ref<readonly FsRoot[]>([]);
  const columns = ref<readonly PathMatrixColumn[]>([]);
  const levels = ref<Record<string, PathMatrixLevel>>({});
  /** The flat list's own cache - see `loadFlatView`. Never shares state with `levels`. */
  const flatLevels = ref<Record<string, PathMatrixLevel>>({});
  const totals = ref<PathMatrixTotals>(emptyTotals());
  const mismatches = ref<readonly MappingMismatch[]>([]);
  const scannedAt = ref<string | null>(null);

  const expanded = ref<string[]>([]);
  const focus = ref<string | null>(null);
  const flatView = ref(false);
  const filter = ref('');
  /** Which instances' folders to show. Empty means the whole fleet. */
  const instanceFilter = ref<number[]>([]);

  const measurements = ref<Record<string, FsMeasurement>>({});
  const measuring = ref<Record<string, boolean>>({});

  const loading = ref(false);
  const loadingPaths = ref<Record<string, boolean>>({});
  const loadedOnce = ref(false);

  /** Anything in flight - drives the one visible "working" signal in the toolbar. */
  const busy = computed(
    () => loading.value || Object.keys(loadingPaths.value).length > 0,
  );

  const isLoadingPath = (path: string): boolean => loadingPaths.value[path] === true;

  const rows = computed<PathRow[]>(() =>
    flatView.value
      ? flattenLeaves({ levels: flatLevels.value, expanded: [], focus: focus.value })
      : flattenLevels({ levels: levels.value, expanded: expanded.value, focus: focus.value }),
  );

  const usableRoots = computed(() => roots.value.filter((root) => root.exists));
  const rootPaths = computed(() => usableRoots.value.map((root) => root.path));
  const unwritableRoots = computed(() =>
    roots.value.filter((root) => root.exists && !root.writable),
  );
  const brokenRoots = computed(() => roots.value.filter((root) => !root.exists));

  /** Root folders this container cannot see - rendered as rows *and* explained. */
  const unseenNodes = computed<PathNode[]>(
    () => levels.value[TOP_LEVEL]?.nodes.filter((node) => !node.inScope) ?? [],
  );

  const reachableColumns = computed(() => columns.value.filter((column) => column.reachable));

  /** What the nav badge counts: things that need a decision. */
  const problemCount = computed(
    () =>
      totals.value.untracked +
      totals.value.missing +
      totals.value.unseenRootFolders +
      totals.value.unmanaged,
  );

  const isExpanded = (path: string): boolean => expanded.value.includes(path);

  function nodeAt(path: string): PathNode | null {
    for (const level of Object.values(levels.value)) {
      const found = level.nodes.find((node) => node.path === path);
      if (found !== undefined) return found;
    }
    return null;
  }

  function rootFolderTargetsFor(path: string): RootFolderCellTarget[] {
    const node = nodeAt(path);
    return node === null ? [] : rootFolderTargets(node);
  }

  function mergeLevels(response: PathMatrixResponse): void {
    const next = { ...levels.value };
    for (const level of response.levels) next[levelKey(level.path)] = level;
    levels.value = next;
    columns.value = response.columns;
    roots.value = response.roots;
    enabled.value = response.enabled;
  }

  function requestFor(paths: readonly string[]): Parameters<typeof storageApi.matrix>[0] {
    return {
      paths,
      ...(filter.value.trim().length === 0 ? {} : { filter: filter.value.trim() }),
      ...(instanceFilter.value.length === 0 ? {} : { instanceIds: instanceFilter.value }),
    };
  }

  /** The spine: every mount and the chain down to each root folder, in one request. */
  async function load(options: { refresh?: boolean } = {}): Promise<void> {
    loading.value = true;
    try {
      const response = await storageApi.matrix({
        ...requestFor([]),
        ...(options.refresh === true ? { refresh: true } : {}),
      });

      levels.value = Object.fromEntries(
        response.levels.map((level) => [levelKey(level.path), level]),
      );
      columns.value = response.columns;
      roots.value = response.roots;
      enabled.value = response.enabled;
      totals.value = response.totals;
      mismatches.value = response.mismatches;
      scannedAt.value = response.scannedAt;

      // Everything the spine returned is open: the user lands on their root folders.
      expanded.value = response.levels
        .map((level) => level.path)
        .filter((path): path is string => path !== null);
      loadedOnce.value = true;
    } catch (caught) {
      // A disabled filesystem is not an error worth shouting about; the view explains it.
      if (caught instanceof ApiRequestError && caught.code === 'fs_disabled') {
        enabled.value = false;
      } else {
        ui.notify('error', `Could not read storage: ${messageOf(caught)}`);
      }
    } finally {
      loading.value = false;
    }
  }

  /**
   * Fetches one or more levels in a single request. Batching matters: changing a filter
   * refetches every open level, and that has to stay one round trip.
   */
  async function fetchLevels(
    paths: readonly string[],
    overrides: { offset?: number; refresh?: boolean } = {},
  ): Promise<void> {
    if (paths.length === 0) return;
    loadingPaths.value = { ...loadingPaths.value, ...Object.fromEntries(paths.map((p) => [p, true])) };

    try {
      const response = await storageApi.matrix({ ...requestFor(paths), ...overrides });
      mergeLevels(response);
      scannedAt.value = response.scannedAt;
    } catch (caught) {
      ui.notify('error', `Could not read ${paths.join(', ')}: ${messageOf(caught)}`);
    } finally {
      const next = { ...loadingPaths.value };
      for (const path of paths) delete next[path];
      loadingPaths.value = next;
    }
  }

  async function expand(path: string): Promise<void> {
    if (!expanded.value.includes(path)) expanded.value = [...expanded.value, path];
    if (levels.value[path] === undefined) await fetchLevels([path]);
  }

  function collapse(path: string): void {
    // Descendants stay cached but leave the tree, so re-expanding is instant.
    expanded.value = expanded.value.filter(
      (entry) => entry !== path && !entry.startsWith(`${path}/`),
    );
  }

  async function toggle(path: string): Promise<void> {
    if (isExpanded(path)) collapse(path);
    else await expand(path);
  }

  /**
   * Opens every expandable node reachable from the current root, fetching whatever level
   * that takes - one batched request per depth, since a level's children are unknown until
   * the level itself is fetched. Bounded the same way ordinary browsing is: a level that
   * summarises a big directory still only returns the rows worth showing.
   */
  async function expandAll(): Promise<void> {
    for (;;) {
      const known = Object.values(levels.value).flatMap((level) => level.nodes);
      const expandable = known.filter((node) => node.expandable);

      const notYetOpen = expandable.map((node) => node.path).filter((path) => !isExpanded(path));
      if (notYetOpen.length > 0) expanded.value = [...expanded.value, ...notYetOpen];

      const unfetched = expandable
        .map((node) => node.path)
        .filter((path) => levels.value[path] === undefined);
      if (unfetched.length === 0) break;
      await fetchLevels(unfetched);
    }
  }

  /** Descendants stay cached, same as a single `collapse` - only the tree closes. */
  function collapseAll(): void {
    expanded.value = [];
  }

  /**
   * Fetches a whole depth of levels for the flat list in one request - `path` is
   * repeatable, and the crawl now visits every folder, so one request per folder would be
   * a request storm on a wide tree.
   *
   * `only: ['all']` so a big directory is not narrowed to problems-only, which would hide
   * ordinary subfolders and make a branch look like a leaf. Anything still truncated is
   * then paged on its own - one extra request per oversized directory, not per path.
   */
  async function fetchFlatLevels(paths: readonly string[]): Promise<PathMatrixLevel[]> {
    if (paths.length === 0) return [];
    const response = await storageApi.matrix({ ...requestFor(paths), only: ['all'], limit: 1000 });

    return Promise.all(
      response.levels.map(async (fetched) => {
        let level = fetched;
        while (level.truncated && level.path !== null) {
          const path = level.path;
          const more = await storageApi.matrix({
            ...requestFor([path]),
            only: ['all'],
            limit: 1000,
            offset: level.offset + level.nodes.length,
          });
          const next = more.levels.find((entry) => entry.path === path);
          if (next === undefined) break;
          level = { ...next, offset: level.offset, nodes: [...level.nodes, ...next.nodes] };
        }
        return level;
      }),
    );
  }

  /**
   * Crawls the whole tree from the current root for the flat list, breadth-first, into a
   * cache of its own (`flatLevels`) rather than the hierarchical `levels` the tree view
   * reads. That separation is deliberate: showing every leaf means asking every big
   * directory for everything rather than the light "problems only" default a normal
   * expand click gets, and that fuller (file-inclusive) listing must never end up where
   * the tree view would render it.
   *
   * The top level (mounts) is reused as-is from the already-loaded spine - it is never
   * large enough to need the "full" treatment, and re-deriving it here would just be a
   * second copy of the same handful of rows.
   */
  async function loadFlatView(): Promise<void> {
    const startPath = focus.value;
    const next: Record<string, PathMatrixLevel> = {};
    let frontier: string[];

    if (startPath === null) {
      const topLevel = levels.value[TOP_LEVEL];
      if (topLevel !== undefined) next[TOP_LEVEL] = topLevel;
      frontier = (topLevel?.nodes ?? [])
        .filter((node) => node.kind === 'directory' && node.expandable)
        .map((node) => node.path);
    } else {
      frontier = [startPath];
    }

    loading.value = true;
    try {
      const visited = new Set<string>();
      while (frontier.length > 0) {
        const fetched = await fetchFlatLevels(frontier);
        const nextFrontier: string[] = [];
        for (const level of fetched) {
          next[levelKey(level.path)] = level;
          for (const node of level.nodes) {
            // Every folder is visited: whether it is a leaf is decided by what its own
            // level holds, and a folder full of files looks identical from up here.
            if (node.kind !== 'directory' || !node.expandable) continue;
            if (visited.has(node.path)) continue;
            visited.add(node.path);
            nextFrontier.push(node.path);
          }
        }
        frontier = nextFrontier;
      }
      flatLevels.value = next;
    } catch (caught) {
      ui.notify('error', `Could not read the flat list: ${messageOf(caught)}`);
    } finally {
      loading.value = false;
    }
  }

  /** Turning flat view on crawls the whole tree first - see `loadFlatView`. */
  async function setFlatView(value: boolean): Promise<void> {
    flatView.value = value;
    if (value) await loadFlatView();
  }

  /** "Show more" on a summary row: the next page of the same level. */
  async function loadMore(path: string): Promise<void> {
    const level = levels.value[levelKey(path === TOP_LEVEL ? null : path)];
    if (level === undefined) return;
    const paths = path === TOP_LEVEL ? [] : [path];
    if (paths.length === 0) return;

    const response = await storageApi.matrix({
      ...requestFor(paths),
      limit: level.limit,
      offset: level.offset + level.nodes.length,
    });

    // Append rather than replace: paging must not throw away what is already on screen.
    const next = { ...levels.value };
    for (const fetched of response.levels) {
      const key = levelKey(fetched.path);
      const known = next[key];
      next[key] =
        known === undefined
          ? fetched
          : { ...fetched, offset: known.offset, nodes: [...known.nodes, ...fetched.nodes] };
    }
    levels.value = next;
  }

  /** Reveal everything in one level, paged from the top. One request, not two. */
  async function showAll(path: string): Promise<void> {
    loadingPaths.value = { ...loadingPaths.value, [path]: true };
    try {
      const response = await storageApi.matrix({
        paths: [path],
        only: ['all'],
        ...(filter.value.trim().length === 0 ? {} : { filter: filter.value.trim() }),
      });
      mergeLevels(response);
    } catch (caught) {
      ui.notify('error', `Could not read ${path}: ${messageOf(caught)}`);
    } finally {
      const next = { ...loadingPaths.value };
      delete next[path];
      loadingPaths.value = next;
    }
  }

  /** One request for every open level - the reason `path` is repeatable. */
  async function refetchOpen(): Promise<void> {
    const open = expanded.value.filter((path) => levels.value[path] !== undefined);
    await fetchLevels(open);
  }

  async function setFilter(value: string): Promise<void> {
    filter.value = value;
    await refetchOpen();
  }

  /**
   * A whole reload, not a refetch of the open levels: the spine itself is scoped to the
   * selected instances, so which levels exist changes with the filter. `refresh: false`
   * keeps it off the *Arr APIs - the cached index already knows who roots where.
   */
  async function setInstanceFilter(ids: readonly number[]): Promise<void> {
    const next = [...ids].sort((a, b) => a - b);
    if (next.join(',') === instanceFilter.value.join(',')) return;
    instanceFilter.value = next;
    await reload({ refresh: false });
  }

  async function focusOn(path: string): Promise<void> {
    focus.value = path;
    await expand(path);
  }

  function clearFocus(): void {
    focus.value = null;
  }

  /** Recursive size, on demand only - this is the expensive call. */
  async function measure(target: string): Promise<void> {
    measuring.value = { ...measuring.value, [target]: true };
    try {
      measurements.value = { ...measurements.value, [target]: await storageApi.measure(target) };
    } catch (caught) {
      ui.notify('error', `Could not measure ${target}: ${messageOf(caught)}`);
    } finally {
      const next = { ...measuring.value };
      delete next[target];
      measuring.value = next;
    }
  }

  function preflight<K extends FsOp>(op: K, payload: QueuePayloadFor<K>): Promise<FsPreflight> {
    return storageApi.preflight(op, payload);
  }

  /**
   * Reload the spine while keeping whatever the user had open, open.
   *
   * `load()` alone would collapse the tree back to the spine, which is the wrong answer
   * both after a run and after a filter change: the levels below are still the levels
   * being worked on.
   */
  async function reload(options: { refresh?: boolean } = {}): Promise<void> {
    const open = [...expanded.value];
    await load(options);
    // Re-open whatever the user had open that the new spine did not already cover.
    const missing = open.filter((path) => levels.value[path] === undefined);
    if (missing.length > 0) {
      expanded.value = [...new Set([...expanded.value, ...missing])];
      await fetchLevels(missing);
    }
  }

  /** Called after a run touched the disk or an instance. */
  async function refreshAll(): Promise<void> {
    measurements.value = {};
    await reload({ refresh: true });
  }

  return {
    enabled,
    roots,
    columns,
    levels,
    flatLevels,
    totals,
    mismatches,
    scannedAt,
    expanded,
    focus,
    flatView,
    filter,
    instanceFilter,
    measurements,
    measuring,
    loading,
    loadingPaths,
    loadedOnce,
    busy,
    isLoadingPath,
    rows,
    usableRoots,
    rootPaths,
    unwritableRoots,
    brokenRoots,
    unseenNodes,
    reachableColumns,
    problemCount,
    isExpanded,
    nodeAt,
    rootFolderTargetsFor,
    load,
    fetchLevels,
    expand,
    collapse,
    toggle,
    expandAll,
    collapseAll,
    setFlatView,
    loadMore,
    showAll,
    setFilter,
    setInstanceFilter,
    focusOn,
    clearFocus,
    measure,
    preflight,
    reload,
    refreshAll,
  };
});
