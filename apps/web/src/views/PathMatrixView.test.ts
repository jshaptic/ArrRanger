import type {
  Instance,
  NewQueueItem,
  PathInstanceCell,
  PathMatrixLevel,
  PathMatrixResponse,
  PathNode,
  PathRole,
  PathRollup,
} from '@arrranger/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function instance(id: number, name: string, kind: Instance['kind'] = 'radarr'): Instance {
  return {
    id,
    name,
    kind,
    baseUrl: `http://host:${String(7000 + id)}`,
    verifySsl: true,
    enabled: true,
    timeoutMs: 20_000,
    appVersion: '5.0.0',
    lastConnectedAt: null,
    lastError: null,
    createdAt: '',
    updatedAt: '',
  };
}

const INSTANCES = [instance(1, 'Radarr-4K'), instance(2, 'Radarr-HD')];

/** Each instance roots at its own subfolder - a normal fleet layout. */
const ROOT_FOLDERS: Record<number, Array<{ id: number; path: string; accessible: boolean }>> = {
  1: [{ id: 1, path: '/data/media/movies', accessible: true }],
  2: [{ id: 5, path: '/data/media/tv', accessible: false }],
};

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

function cell(instanceId: number, role: PathRole, overrides: Partial<PathInstanceCell> = {}): PathInstanceCell {
  return {
    instanceId,
    known: role !== 'unknown',
    role,
    rootFolderId: role === 'rootFolder' ? ROOT_FOLDERS[instanceId]?.[0]?.id ?? 0 : null,
    accessible: role === 'rootFolder' ? (ROOT_FOLDERS[instanceId]?.[0]?.accessible ?? true) : null,
    freeSpace: role === 'rootFolder' ? 1_000_000_000 : null,
    totalSpace: role === 'rootFolder' ? 4_000_000_000 : null,
    mediaUnder: role === 'tracked' || role === 'ancestor' ? 3 : 0,
    title: role === 'tracked' ? 'Dune' : null,
    ...overrides,
  };
}

function node(path: string, overrides: Partial<PathNode> = {}): PathNode {
  return {
    path,
    name: path.split('/').filter(Boolean).at(-1) ?? path,
    origin: 'disk',
    exists: true,
    kind: 'directory',
    inScope: true,
    modifiedAt: '2026-09-01T00:00:00.000Z',
    childCount: 2,
    readable: true,
    writable: true,
    deviceId: '1',
    freeSpace: null,
    totalSpace: null,
    sizeOnDisk: null,
    error: null,
    cells: [cell(1, 'outside'), cell(2, 'outside')],
    flags: [],
    rollup: null,
    expandable: true,
    ...overrides,
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

const MOUNT = node('/data', { flags: ['mount'], freeSpace: 2_000_000_000, cells: [cell(1, 'ancestor'), cell(2, 'ancestor')] });
const MEDIA = node('/data/media', { cells: [cell(1, 'ancestor'), cell(2, 'ancestor')] });

// Root folders are leaves: the library below them is not this view's to manage.
const MOVIES = node('/data/media/movies', {
  flags: ['rootFolder'],
  expandable: false,
  cells: [cell(1, 'rootFolder', { mediaUnder: 812 }), cell(2, 'outside')],
});
const TV = node('/data/media/tv', {
  flags: ['rootFolder'],
  expandable: false,
  cells: [cell(1, 'outside'), cell(2, 'rootFolder')],
});
/** The headline signal: sits next to root folders, is not one, still full of films. */
const OLD_MOVIES = node('/data/media/old-movies', {
  flags: ['candidate', 'unmanaged'],
  childCount: 814,
  cells: [cell(1, 'ancestor', { mediaUnder: 806 }), cell(2, 'outside')],
});
/** Nobody's root folder and nothing tracked under it: safe to prune. */
const SPARE = node('/data/media/spare', { flags: ['candidate'], childCount: 0, expandable: false });

/** A root folder outside FS_ROOTS - the mapping diagnosis, as a row. */
const UNSEEN = node('/elsewhere/movies', {
  exists: false,
  inScope: false,
  origin: 'arr',
  flags: ['rootFolder', 'unseen'],
  expandable: false,
  cells: [cell(1, 'rootFolder'), cell(2, 'outside')],
});

/** 814 entries, only the 3 that need attention returned. */
const LIBRARY_LEVEL = level('/data/media/old-movies', [
  node('/data/media/old-movies/Orphan Film (1999)', { flags: ['untracked'] }),
  node('/data/media/old-movies/Empty Folder', { flags: ['untracked', 'empty'], childCount: 0, expandable: false }),
  node('/data/media/old-movies/Gone (2001)', {
    exists: false,
    origin: 'arr',
    flags: ['missing'],
    expandable: false,
    cells: [cell(1, 'tracked'), cell(2, 'outside')],
  }),
], {
  selection: ['problems'],
  rollup: rollup({ entries: 814, tracked: 806, untracked: 4, missing: 2, mediaUnder: 806 }),
  matched: 6,
  truncated: true,
  childCountsResolved: false,
});

let enabled = true;

const matrixApi = vi.fn((params: { paths?: readonly string[] } = {}) => {
  const requested = params.paths ?? [];

  const levels: PathMatrixLevel[] =
    requested.length === 0
      ? [
          level(null, [MOUNT, UNSEEN]),
          level('/data', [MEDIA]),
          level('/data/media', [MOVIES, TV, OLD_MOVIES, SPARE]),
        ]
      : requested.includes('/data/media/old-movies')
        ? [LIBRARY_LEVEL]
        : [level(requested[0] ?? null, [])];

  return Promise.resolve<PathMatrixResponse>({
    enabled,
    scannedAt: '2026-09-01T00:00:00.000Z',
    roots: [
      {
        path: '/data',
        exists: true,
        readable: true,
        writable: true,
        deviceId: '1',
        freeSpace: 2_000_000_000,
        totalSpace: 8_000_000_000,
        error: null,
      },
    ],
    columns: [
      { instanceId: 1, name: 'Radarr-4K', kind: 'radarr', reachable: true, error: null, fetchedAt: null, rootFolderCount: 2, mediaPathCount: 812, unseenRootFolders: ['/elsewhere/movies'] },
      { instanceId: 2, name: 'Radarr-HD', kind: 'radarr', reachable: true, error: null, fetchedAt: null, rootFolderCount: 1, mediaPathCount: 0, unseenRootFolders: [] },
    ],
    levels,
    totals: {
      rootFolderPaths: 3,
      unseenRootFolders: 1,
      unmanaged: 0,
      untracked: 4,
      missing: 2,
      candidates: 1,
    },
    mismatches: [],
  });
});

const preflight = vi.fn(() =>
  Promise.resolve({
    op: 'fs.delete' as const,
    ok: true,
    checks: [{ id: 'inside_root', status: 'ok' as const, message: 'inside a root' }],
    measurement: null,
    freeSpace: 1_000_000_000,
    referencedBy: [],
  }),
);

const push = vi.fn((items: readonly NewQueueItem[]) =>
  Promise.resolve({
    items: items.map((entry, index) => ({
      id: index + 1,
      instanceId: entry.instanceId ?? null,
      runId: null,
      dependsOnId: entry.dependsOnId ?? null,
      sortOrder: index + 1,
      status: 'pending' as const,
      op: entry.op,
      payload: entry.payload,
      targetKind: 'rootFolder' as const,
      targetId: null,
      targetLabel: '',
      summary: '',
      affectedCount: 1,
      attempts: 0,
      error: null,
      result: null,
      createdAt: '',
      updatedAt: '',
      startedAt: null,
      finishedAt: null,
    })),
  }),
);

vi.mock('@/api/instances', () => ({
  instancesApi: { list: () => Promise.resolve({ instances: INSTANCES }) },
}));

vi.mock('@/api/storage', () => ({
  storageApi: {
    matrix: (params: { paths?: readonly string[] }) => matrixApi(params),
    roots: () => Promise.resolve({ enabled: true, roots: [] }),
    measure: vi.fn(),
    preflight: () => preflight(),
  },
}));

vi.mock('@/api/resources', () => ({
  resourcesApi: {
    snapshot: (instanceId: number) =>
      Promise.resolve({
        instanceId,
        fetchedAt: '2026-09-01T00:00:00.000Z',
        tags: [],
        rootFolders: (ROOT_FOLDERS[instanceId] ?? []).map((folder) => ({
          ...folder,
          freeSpace: 1_000_000_000,
          totalSpace: 4_000_000_000,
        })),
        importLists: [],
      }),
    media: vi.fn(),
    allMediaIdsInRootFolder: (instanceId: number) =>
      Promise.resolve(instanceId === 1 ? [10, 11, 12] : []),
    refresh: vi.fn(),
  },
}));

vi.mock('@/api/queue', () => ({
  queueApi: {
    list: () => Promise.resolve({ items: [], activeRun: null }),
    push,
    detail: vi.fn(),
    reorder: vi.fn(),
    retry: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    runs: vi.fn(),
    run: vi.fn(),
    start: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    events: vi.fn(),
    openStream: vi.fn(() => () => undefined),
  },
}));

const PathMatrixView = (await import('./PathMatrixView.vue')).default;

async function mountView() {
  const wrapper = mount(PathMatrixView, {
    global: { plugins: [createPinia()], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  for (let tick = 0; tick < 8; tick += 1) await flushPromises();
  return wrapper;
}

const rowFor = (wrapper: Awaited<ReturnType<typeof mountView>>, needle: string) =>
  wrapper.findAll('tbody tr').find((row) => row.text().includes(needle));

/** By path, because rendered names collide: /elsewhere/movies vs /data/media/movies. */
const rowAt = (wrapper: Awaited<ReturnType<typeof mountView>>, path: string) =>
  wrapper.find(`[data-path="${path}"]`);

beforeEach(() => {
  push.mockClear();
  matrixApi.mockClear();
  preflight.mockClear();
  enabled = true;
  document.body.innerHTML = '';
});

describe('PathMatrixView', () => {
  it('renders the spine on first load: every mount and every root folder', async () => {
    const wrapper = await mountView();
    const text = wrapper.text();

    expect(text).toContain('data');
    expect(text).toContain('movies');
    expect(text).toContain('tv');
    // One request for the whole spine, not one per level.
    expect(matrixApi).toHaveBeenCalledTimes(1);
  });

  it('flags a folder that is nobody root folder', async () => {
    const wrapper = await mountView();
    const row = rowFor(wrapper, 'old-movies');

    expect(row?.text()).toContain('not a root folder');
    expect(wrapper.text()).toContain('1 not used as a root folder');
  });

  it('flags a root folder an instance cannot reach', async () => {
    const wrapper = await mountView();
    // Radarr-HD reports /data/media/tv as inaccessible.
    expect(rowFor(wrapper, 'tv')?.text()).toContain('⚠');
  });

  it('never renders a mount badge - the leading slash already says it', async () => {
    const wrapper = await mountView();
    expect(rowAt(wrapper, '/data').text()).not.toContain('mount');
  });

  it('does not offer to expand a root folder', async () => {
    const wrapper = await mountView();
    const twisty = rowAt(wrapper, '/data/media/movies').findAll('button')[0];

    expect(twisty?.attributes('disabled')).toBeDefined();
    expect(twisty?.attributes('title')).toContain('does not manage');
  });

  it('renders a root folder this container cannot see as a row', async () => {
    const wrapper = await mountView();
    const row = rowFor(wrapper, 'elsewhere');

    expect(row?.text()).toContain('not mounted here');
    expect(wrapper.text()).toContain('1 not mounted here');
  });

  it('shows a cell per instance, and a fleet free-space footer', async () => {
    const wrapper = await mountView();

    expect(wrapper.find('tfoot').text()).toContain('free space');
    // 7 spine rows x 2 instances.
    expect(wrapper.findAll('[data-cell]').length).toBe(14);
  });

  it('clicking a gap stages the root folder on that instance only', async () => {
    const wrapper = await mountView();
    const cells = rowAt(wrapper, '/data/media/old-movies').findAll('[data-cell]');

    await cells[1]?.trigger('click');
    await flushPromises();

    expect(push.mock.calls[0]?.[0]).toEqual([
      { instanceId: 2, op: 'rootFolder.create', payload: { path: '/data/media/old-movies' } },
    ]);
  });

  // ------------------------------------------------- the whole point of the merge

  it('summarises a folder still full of films instead of rendering 814 rows', async () => {
    const wrapper = await mountView();

    const twisty = rowAt(wrapper, '/data/media/old-movies').findAll('button')[0];
    await twisty?.trigger('click');
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    const rows = wrapper.findAll('tbody tr');
    expect(rows.length).toBeLessThan(15);

    // The rollup states the truth even though only the problems are on screen.
    const summary = rows.find((row) => row.text().includes('of 814 folders here'));
    expect(summary).toBeDefined();
    expect(summary?.text()).toContain('806 tracked');
    expect(summary?.text()).toContain('4 untracked');
    expect(summary?.text()).toContain('2 missing');
    expect(summary?.text()).toContain('show all 814');

    // Only the folders that need attention became rows.
    expect(wrapper.text()).toContain('Orphan Film (1999)');
    expect(wrapper.text()).toContain('Gone (2001)');
  });

  it('says what a search matched, not the whole folder state', async () => {
    const wrapper = await mountView();
    const twisty = rowAt(wrapper, '/data/media/old-movies').findAll('button')[0];
    await twisty?.trigger('click');
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    const search = wrapper.find('input[type="search"]');
    await search.setValue('orphan');
    await search.trigger('change');
    for (let tick = 0; tick < 6; tick += 1) await flushPromises();

    // During a search the folder's own state counts describe rows that are not on
    // screen, so they are left out and the line says what it is really counting.
    const summary = wrapper.findAll('tbody tr').find((row) => row.text().includes('match'));
    expect(summary?.text()).toContain('of 814 folders here match');
    expect(summary?.text()).not.toContain('tracked');
  });

  it('badges what is tracked, untracked and missing inside that folder', async () => {
    const wrapper = await mountView();
    const twisty = rowAt(wrapper, '/data/media/old-movies').findAll('button')[0];
    await twisty?.trigger('click');
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    expect(rowFor(wrapper, 'Orphan Film (1999)')?.text()).toContain('untracked');
    expect(rowFor(wrapper, 'Empty Folder')?.text()).toContain('empty');
    expect(rowFor(wrapper, 'Gone (2001)')?.text()).toContain('missing');
  });

  // --------------------------------------------------------------- disk actions

  it('offers align on a root folder, and never a re-map on a plain folder', async () => {
    const wrapper = await mountView();

    expect(rowAt(wrapper, '/data/media/movies').text()).toContain('align');
    expect(rowAt(wrapper, '/data/media/movies').text()).toContain('re-map');
    expect(rowFor(wrapper, 'old-movies')?.text()).not.toContain('re-map');
  });

  it('never offers a disk action on a mount', async () => {
    const wrapper = await mountView();
    const row = rowAt(wrapper, '/data');

    expect(row.text()).not.toContain('prune');
    expect(row.text()).not.toContain('rename');
  });

  it('pruning requires typing the folder name, then stages one fs.delete', async () => {
    const wrapper = await mountView();
    const prune = rowAt(wrapper, '/data/media/spare')
      .findAll('button')
      .find((button) => button.text() === 'prune');
    await prune?.trigger('click');
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    const confirm = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Stage'),
    );
    expect(confirm?.hasAttribute('disabled')).toBe(true);

    const input = document.body.querySelector<HTMLInputElement>('input[type="text"]');
    if (input) {
      input.value = 'spare';
      input.dispatchEvent(new Event('input'));
    }
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    const armed = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Stage'),
    );
    armed?.click();
    for (let tick = 0; tick < 6; tick += 1) await flushPromises();

    expect(push.mock.calls[0]?.[0]).toEqual([
      { op: 'fs.delete', payload: { path: '/data/media/spare', recursive: false, force: false } },
    ]);
    wrapper.unmount();
  });

  it('warns before relocating a folder an instance still tracks', async () => {
    const wrapper = await mountView();
    const rename = rowAt(wrapper, '/data/media/old-movies')
      .findAll('button')
      .find((button) => button.text() === 'rename');
    await rename?.trigger('click');
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    expect(document.body.textContent).toContain('Radarr-4K has 806 item(s)');
    wrapper.unmount();
  });

  // ---------------------------------------------------------------- teaching state

  it('explains exactly what to configure when the filesystem is off', async () => {
    enabled = false;
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('Filesystem access is off');
    expect(wrapper.text()).toContain('FS_ROOTS: /data');
  });
});
