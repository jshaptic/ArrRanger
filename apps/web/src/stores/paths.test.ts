import type { PathMatrixLevel, PathMatrixResponse, PathNode, PathRollup } from '@arrranger/shared';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/api/client';
import type { MatrixParams } from '@/api/storage';

function rollup(overrides: Partial<PathRollup> = {}): PathRollup {
  return {
    entries: 0,
    tracked: 0,
    untracked: 0,
    neutral: 0,
    missing: 0,
    rootFolders: 0,
    candidates: 0,
    symlinks: 0,
    empty: null,
    unreadable: null,
    mediaUnder: 0,
    ...overrides,
  };
}

function node(path: string): PathNode {
  return {
    path,
    name: path.split('/').filter(Boolean).at(-1) ?? path,
    origin: 'disk',
    exists: true,
    kind: 'directory',
    inScope: true,
    modifiedAt: null,
    childCount: 1,
    readable: true,
    writable: true,
    deviceId: '1',
    freeSpace: null,
    totalSpace: null,
    sizeOnDisk: null,
    error: null,
    cells: [],
    flags: [],
    rollup: null,
    expandable: true,
  };
}

function level(path: string | null, nodes: PathNode[], overrides: Partial<PathMatrixLevel> = {}): PathMatrixLevel {
  return {
    path,
    parent: null,
    nodes,
    rollup: rollup({ entries: nodes.length }),
    selection: ['all'],
    matched: nodes.length,
    offset: 0,
    limit: 200,
    truncated: false,
    childCountsResolved: true,
    error: null,
    ...overrides,
  };
}

function response(levels: PathMatrixLevel[], overrides: Partial<PathMatrixResponse> = {}): PathMatrixResponse {
  return {
    enabled: true,
    scannedAt: '2026-09-01T00:00:00.000Z',
    roots: [],
    columns: [],
    levels,
    totals: {
      rootFolderPaths: 1,
      unseenRootFolders: 1,
      unmanaged: 0,
      untracked: 3,
      missing: 2,
      candidates: 1,
    },
    mismatches: [],
    ...overrides,
  };
}

const calls: MatrixParams[] = [];
let handler: (params: MatrixParams) => Promise<PathMatrixResponse> = () =>
  Promise.resolve(response([]));

vi.mock('@/api/storage', () => ({
  storageApi: {
    matrix: (params: MatrixParams = {}) => {
      calls.push(params);
      return handler(params);
    },
    measure: vi.fn(),
    preflight: vi.fn(),
    roots: vi.fn(),
  },
}));

const { usePathsStore } = await import('./paths');

beforeEach(() => {
  setActivePinia(createPinia());
  calls.length = 0;
  handler = () => Promise.resolve(response([]));
});

describe('usePathsStore', () => {
  it('opens every level the spine returned', async () => {
    handler = () =>
      Promise.resolve(
        response([level(null, [node('/data')]), level('/data', [node('/data/media')])]),
      );

    const store = usePathsStore();
    await store.load();

    expect(store.expanded).toEqual(['/data']);
    expect(store.rows.map((row) => row.node?.path)).toEqual(['/data', '/data/media']);
    expect(store.loadedOnce).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('fetches a level once, then serves the expansion from cache', async () => {
    handler = (params) =>
      Promise.resolve(
        response(
          (params.paths ?? []).length === 0
            ? [level(null, [node('/data')])]
            : [level('/data', [node('/data/media')])],
        ),
      );

    const store = usePathsStore();
    await store.load();
    await store.expand('/data');
    const afterFirst = calls.length;

    store.collapse('/data');
    await store.expand('/data');
    expect(calls.length).toBe(afterFirst);
  });

  it('collapsing a path also drops its descendants from the tree', async () => {
    handler = () =>
      Promise.resolve(
        response([
          level(null, [node('/data')]),
          level('/data', [node('/data/media')]),
          level('/data/media', [node('/data/media/movies')]),
        ]),
      );

    const store = usePathsStore();
    await store.load();
    expect(store.expanded).toEqual(['/data', '/data/media']);

    store.collapse('/data');
    expect(store.expanded).toEqual([]);
    expect(store.rows.map((row) => row.node?.path)).toEqual(['/data']);
  });

  it('refetches every open level in one request when the filter changes', async () => {
    handler = (params) =>
      Promise.resolve(
        response(
          (params.paths ?? []).length === 0
            ? [level(null, [node('/data')]), level('/data', [node('/data/media')])]
            : (params.paths ?? []).map((path) => level(path, [])),
        ),
      );

    const store = usePathsStore();
    await store.load();
    calls.length = 0;

    await store.setFilter('dune');

    // One request carrying every open path - the reason `path` is repeatable.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.paths).toEqual(['/data']);
    expect(calls[0]?.filter).toBe('dune');
  });

  it('appends when paging a level rather than replacing what is on screen', async () => {
    const first = level('/data', [node('/data/a')], {
      rollup: rollup({ entries: 3 }),
      matched: 3,
      truncated: true,
      limit: 1,
    });

    handler = (params) =>
      Promise.resolve(
        response(
          (params.paths ?? []).length === 0
            ? [level(null, [node('/data')]), first]
            : [level('/data', [node('/data/b')], { offset: 1, limit: 1, matched: 3, truncated: true })],
        ),
      );

    const store = usePathsStore();
    await store.load();
    await store.loadMore('/data');

    expect(store.levels['/data']?.nodes.map((entry) => entry.path)).toEqual([
      '/data/a',
      '/data/b',
    ]);
  });

  it('asks for everything in one request when showing all', async () => {
    handler = (params) =>
      Promise.resolve(
        response(
          (params.paths ?? []).length === 0 ? [level(null, [node('/data')])] : [level('/data', [])],
        ),
      );

    const store = usePathsStore();
    await store.load();
    calls.length = 0;

    await store.showAll('/data');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.only).toEqual(['all']);
  });

  it('re-roots at a focused path', async () => {
    handler = () =>
      Promise.resolve(
        response([
          level(null, [node('/data')]),
          level('/data', [node('/data/media')]),
          level('/data/media', [node('/data/media/movies')]),
        ]),
      );

    const store = usePathsStore();
    await store.load();
    await store.focusOn('/data/media');

    expect(store.rows.map((row) => row.node?.path)).toEqual(['/data/media/movies']);

    store.clearFocus();
    expect(store.rows.length).toBeGreaterThan(1);
  });

  it('counts the things that need a decision for the nav badge', async () => {
    handler = () => Promise.resolve(response([level(null, [])]));

    const store = usePathsStore();
    await store.load();

    // untracked 3 + missing 2 + unseen 1 + unmanaged 0
    expect(store.problemCount).toBe(6);
  });

  it('treats a disabled filesystem as a state, not an error', async () => {
    handler = () =>
      Promise.reject(new ApiRequestError({ code: 'fs_disabled', message: 'off', status: 503 }));

    const store = usePathsStore();
    await store.load();

    expect(store.enabled).toBe(false);
  });
});
