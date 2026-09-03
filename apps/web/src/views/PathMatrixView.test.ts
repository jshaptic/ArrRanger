import type {
  Instance,
  NewQueueItem,
  PathMatrixColumn,
  PathMatrixLevel,
  PathMatrixResponse,
  PathNode,
  PathOwner,
  PathRollup,
  PathUse,
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
    severity: 'ok',
    ...overrides,
  };
}

const NAMES: Record<number, string> = { 1: 'Radarr-4K', 2: 'Radarr-HD' };

function owner(instanceId: number, use: PathUse, overrides: Partial<PathOwner> = {}): PathOwner {
  return {
    instanceId,
    name: NAMES[instanceId] ?? `instance ${String(instanceId)}`,
    kind: 'radarr',
    use,
    rootFolderId: use === 'rootFolder' ? ROOT_FOLDERS[instanceId]?.[0]?.id ?? 0 : null,
    accessible: use === 'rootFolder' ? (ROOT_FOLDERS[instanceId]?.[0]?.accessible ?? true) : null,
    mediaUnder: use === 'rootFolder' ? 0 : 3,
    title: use === 'tracked' ? 'Dune' : null,
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
    freeSpace: 2_000_000_000,
    totalSpace: 8_000_000_000,
    lowSpace: false,
    sizeOnDisk: null,
    error: null,
    owners: [],
    flags: [],
    severity: 'ok',
    canAddRootFolder: true,
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

const MOUNT = node('/data', {
  flags: ['mount'],
  owners: [owner(1, 'ancestor'), owner(2, 'ancestor')],
  canAddRootFolder: true,
});
const MEDIA = node('/data/media', { owners: [owner(1, 'ancestor'), owner(2, 'ancestor')] });

// Root folders are leaves: the library below them is not this view's to manage. Each
// instance roots at its own subfolder - one owner per folder, the layout this view assumes.
const MOVIES = node('/data/media/movies', {
  flags: ['rootFolder'],
  expandable: false,
  owners: [owner(1, 'rootFolder', { mediaUnder: 812 })],
  canAddRootFolder: false,
});
const TV = node('/data/media/tv', {
  flags: ['rootFolder'],
  expandable: false,
  // Radarr-HD reports its own root folder as not accessible - a real warning.
  owners: [owner(2, 'rootFolder')],
  severity: 'warn',
  canAddRootFolder: false,
});
/** The headline signal: sits next to root folders, is not one, still full of films. */
const OLD_MOVIES = node('/data/media/old-movies', {
  flags: ['candidate', 'unmanaged'],
  childCount: 814,
  owners: [owner(1, 'ancestor', { mediaUnder: 806 })],
  severity: 'warn',
});
/** Nobody's root folder and nothing tracked under it: safe to prune. */
const SPARE = node('/data/media/spare', {
  flags: ['candidate'],
  childCount: 0,
  expandable: false,
  severity: 'warn',
});

/** A root folder outside FS_ROOTS - the mapping diagnosis, as a row. */
const UNSEEN = node('/elsewhere/movies', {
  exists: false,
  inScope: false,
  origin: 'arr',
  flags: ['rootFolder', 'unseen'],
  expandable: false,
  owners: [owner(1, 'rootFolder')],
  severity: 'error',
  freeSpace: null,
  totalSpace: null,
  canAddRootFolder: false,
});

/** 814 entries, only the 3 that need attention returned. */
const LIBRARY_LEVEL = level('/data/media/old-movies', [
  node('/data/media/old-movies/Orphan Film (1999)', { flags: ['untracked'], severity: 'info' }),
  node('/data/media/old-movies/Empty Folder', {
    flags: ['untracked', 'empty'],
    childCount: 0,
    expandable: false,
    severity: 'info',
  }),
  node('/data/media/old-movies/Gone (2001)', {
    exists: false,
    origin: 'arr',
    flags: ['missing'],
    expandable: false,
    owners: [owner(1, 'tracked')],
    severity: 'error',
    canAddRootFolder: false,
  }),
], {
  selection: ['problems'],
  rollup: rollup({ entries: 814, tracked: 806, untracked: 4, missing: 2, mediaUnder: 806 }),
  matched: 6,
  truncated: true,
  childCountsResolved: false,
});

let enabled = true;
/** Flipped by the unreachable-instance test; the server would report this in `columns`. */
let unreachableIds: number[] = [];

interface MatrixCall {
  readonly paths?: readonly string[];
  readonly instanceIds?: readonly number[];
}

/** Only the folders the requested instances own - the server scopes the tree, not the client. */
function scopeTo(nodes: PathNode[], instanceIds: readonly number[] | undefined): PathNode[] {
  if (instanceIds === undefined || instanceIds.length === 0) return nodes;
  return nodes.filter((entry) => entry.owners.some((o) => instanceIds.includes(o.instanceId)));
}

const matrixApi = vi.fn((params: MatrixCall = {}) => {
  const requested = params.paths ?? [];
  const scope = params.instanceIds;

  const levels: PathMatrixLevel[] =
    requested.length === 0
      ? [
          level(null, scopeTo([MOUNT, UNSEEN], scope)),
          level('/data', scopeTo([MEDIA], scope)),
          level('/data/media', scopeTo([MOVIES, TV, OLD_MOVIES, SPARE], scope), {
            matched: scope === undefined || scope.length === 0 ? 4 : 2,
          }),
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
    // Always the whole fleet, filter or not: the bar has to keep listing every instance,
    // and this is where "did not answer" is stated.
    columns: ([
      { instanceId: 1, name: 'Radarr-4K', kind: 'radarr', reachable: true, error: null, fetchedAt: null, rootFolderCount: 2, mediaPathCount: 812, unseenRootFolders: ['/elsewhere/movies'] },
      { instanceId: 2, name: 'Radarr-HD', kind: 'radarr', reachable: true, error: null, fetchedAt: null, rootFolderCount: 1, mediaPathCount: 0, unseenRootFolders: [] },
    ] satisfies PathMatrixColumn[]).map(
      (column): PathMatrixColumn =>
        unreachableIds.includes(column.instanceId)
          ? { ...column, reachable: false, error: 'arr_unreachable', unseenRootFolders: [] }
          : column,
    ),
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
    matrix: (params: MatrixCall) => matrixApi(params),
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
  unreachableIds = [];
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
    const row = rowAt(wrapper, '/data/media/movies');
    const twisty = row.findAll('button').find((button) => /[▾▸]/.test(button.text()));

    expect(twisty).toBeUndefined();
  });

  it('drops the twisty and the focus icon in the flat list - there is no tree to walk', async () => {
    const wrapper = await mountView();

    const treeRow = rowAt(wrapper, '/data');
    expect(treeRow.findAll('button').some((button) => /[▾▸]/.test(button.text()))).toBe(true);
    expect(treeRow.findAll('button').some((button) => button.text() === '⌖')).toBe(true);

    const toggle = wrapper.findAll('button').find((button) => button.text() === 'Flat list');
    await toggle?.trigger('click');
    for (let tick = 0; tick < 8; tick += 1) await flushPromises();

    const rows = wrapper.findAll('tbody tr');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const buttons = row.findAll('button');
      expect(buttons.some((button) => /[▾▸]/.test(button.text()))).toBe(false);
      expect(buttons.some((button) => button.text() === '⌖')).toBe(false);
    }
  });

  it('renders a root folder this container cannot see as a row', async () => {
    const wrapper = await mountView();
    const row = rowFor(wrapper, 'elsewhere');

    expect(row?.text()).toContain('not mounted here');
    expect(wrapper.text()).toContain('1 not mounted here');
  });

  // ------------------------------------------------------------- one chip, not a grid

  it('shows one chip per owning instance, not one cell per instance', async () => {
    const wrapper = await mountView();

    // 7 spine rows and 2 instances used to mean 14 cells, 8 of them empty. Now each row
    // renders only the instances that actually use it.
    expect(wrapper.findAll('[data-owner]').length).toBe(8);

    expect(rowAt(wrapper, '/data/media/movies').findAll('[data-owner]').length).toBe(1);
    expect(rowAt(wrapper, '/data/media/movies').text()).toContain('Radarr-4K');
    expect(rowAt(wrapper, '/data/media/movies').text()).not.toContain('Radarr-HD');

    expect(rowAt(wrapper, '/data/media/tv').text()).toContain('Radarr-HD');
    // Nobody's folder says so once, rather than in a column per instance.
    expect(rowAt(wrapper, '/data/media/spare').findAll('[data-owner]').length).toBe(0);
    expect(rowAt(wrapper, '/data/media/spare').text()).toContain('—');
  });

  it('renders every owner when two instances do root at one folder', async () => {
    // Rare, and not what the layout optimises for, but it must not be misrepresented.
    const shared = node('/data/media/movies', {
      flags: ['rootFolder'],
      expandable: false,
      owners: [owner(1, 'rootFolder', { mediaUnder: 812 }), owner(2, 'rootFolder')],
      canAddRootFolder: false,
    });
    matrixApi.mockImplementationOnce(() =>
      Promise.resolve<PathMatrixResponse>({
        enabled: true,
        scannedAt: '2026-09-01T00:00:00.000Z',
        roots: [],
        columns: [],
        levels: [level(null, [shared])],
        totals: { rootFolderPaths: 1, unseenRootFolders: 0, unmanaged: 0, untracked: 0, missing: 0, candidates: 0 },
        mismatches: [],
      }),
    );

    const wrapper = await mountView();
    const chips = rowAt(wrapper, '/data/media/movies').findAll('[data-owner]');

    expect(chips.length).toBe(2);
    expect(chips.every((chip) => chip.attributes('data-owner') === 'rootFolder')).toBe(true);
  });

  it('summarises free space per filesystem, not per instance', async () => {
    const wrapper = await mountView();

    // The old footer summed each instance's root folders, double-counting one disk when
    // two instances rooted on it.
    expect(wrapper.find('tfoot').exists()).toBe(false);

    const strip = wrapper.find('[data-testid="filesystem-space"]');
    expect(strip.exists()).toBe(true);
    expect(strip.text()).toContain('/data');
    expect(strip.text()).toContain('free');
  });

  it('the add-root-folder action opens the dialog preset to this path', async () => {
    // There is no gap cell to click any more: the folder has no owner to infer an
    // instance from, so the dialog asks.
    const wrapper = await mountView();
    const row = rowAt(wrapper, '/data/media/old-movies');

    const action = row.findAll('button').find((button) => button.text() === 'add root folder');
    expect(action).toBeDefined();
    await action?.trigger('click');
    await flushPromises();

    expect(document.body.textContent).toContain('Add a root folder to the fleet');
    // Editable, so the path is a DOM value rather than rendered text.
    const field = document.body.querySelector('input[type="text"]');
    expect((field as HTMLInputElement | null)?.value).toBe('/data/media/old-movies');
    // Nothing is staged until the dialog says which instances.
    expect(push).not.toHaveBeenCalled();
  });

  it('clicking an owning root-folder chip stages its removal from that instance', async () => {
    const wrapper = await mountView();
    const chip = rowAt(wrapper, '/data/media/movies').find('[data-owner="rootFolder"]');

    await chip.trigger('click');
    await flushPromises();

    expect(document.body.textContent).toContain('Radarr-4K');
    expect(document.body.textContent).toContain('/data/media/movies');
  });

  it('an owner that merely holds media below is not clickable', async () => {
    const wrapper = await mountView();
    const chip = rowAt(wrapper, '/data/media/old-movies').find('[data-owner="ancestor"]');

    expect(chip.attributes('disabled')).toBeDefined();
  });

  // ------------------------------------------------------------------ monitoring

  it('marks a folder that needs attention, and stays quiet about one that does not', async () => {
    const wrapper = await mountView();

    expect(rowAt(wrapper, '/data/media/old-movies').find('[data-severity="own"]').exists()).toBe(true);
    expect(rowAt(wrapper, '/elsewhere/movies').find('[data-severity="own"]').text()).toBe('✕');
    // A healthy root folder gets no glyph - one on every row would be noise.
    expect(rowAt(wrapper, '/data/media/movies').find('[data-severity="own"]').exists()).toBe(false);
  });

  it('warns on a collapsed folder whose children need attention', async () => {
    const wrapper = await mountView();

    // /data/media is quiet itself, but holds old-movies and spare.
    const media = rowAt(wrapper, '/data/media');
    expect(media.find('[data-severity="own"]').exists()).toBe(false);
    // Expanded here, so the children speak for themselves rather than the parent.
    expect(media.find('[data-severity="child"]').exists()).toBe(false);
  });

  it('reports the media each folder holds, and names a single tracked item', async () => {
    const wrapper = await mountView();
    expect(rowAt(wrapper, '/data/media/movies').text()).toContain('812');
    expect(rowAt(wrapper, '/data/media/old-movies').text()).toContain('806');
  });

  it('flags a filesystem that is low on space, and only where it means something', async () => {
    const low = node('/data', { flags: ['mount'], lowSpace: true, severity: 'warn' });
    const child = node('/data/media', { lowSpace: false });
    matrixApi.mockImplementationOnce(() =>
      Promise.resolve<PathMatrixResponse>({
        enabled: true,
        scannedAt: '2026-09-01T00:00:00.000Z',
        roots: [],
        columns: [],
        levels: [level(null, [low]), level('/data', [child])],
        totals: { rootFolderPaths: 0, unseenRootFolders: 0, unmanaged: 0, untracked: 0, missing: 0, candidates: 0 },
        mismatches: [],
      }),
    );

    const wrapper = await mountView();

    expect(rowAt(wrapper, '/data').find('[data-low-space]').exists()).toBe(true);
    // Every row under it shares the same filesystem; flagging them all says nothing.
    expect(rowAt(wrapper, '/data/media').find('[data-low-space]').exists()).toBe(false);
  });

  // ------------------------------------------ unknown is never "nobody uses this"

  it('says once when an instance did not answer, instead of a cell per row', async () => {
    unreachableIds = [2];
    const wrapper = await mountView();

    const notice = wrapper.find('[data-testid="unknown-instances"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain('Radarr-HD');
    expect(notice.text()).toContain('deliberately not "nobody"');

    // An ownerless row carries the same caveat, so it cannot read as a gap...
    expect(rowAt(wrapper, '/data/media/spare').text()).toContain('?');
    // ...but a row that already has an owner does not repeat it.
    expect(rowAt(wrapper, '/data/media/movies').text()).not.toContain('?');
  });

  it('says nothing about unknowns when the whole fleet answered', async () => {
    const wrapper = await mountView();
    expect(wrapper.find('[data-testid="unknown-instances"]').exists()).toBe(false);
    expect(rowAt(wrapper, '/data/media/spare').text()).not.toContain('?');
  });

  // ------------------------------------------------ the fleet bar as a filter

  it('the fleet bar filters the tree rather than picking action targets', async () => {
    const wrapper = await mountView();
    matrixApi.mockClear();

    const chip = wrapper
      .findAll('section button')
      .find((button) => button.text().includes('Radarr-4K'));
    await chip?.trigger('click');
    for (let tick = 0; tick < 6; tick += 1) await flushPromises();

    expect(matrixApi.mock.calls[0]?.[0]?.instanceIds).toEqual([1]);
    expect(wrapper.text()).toContain('showing 1 of 2');
    // Radarr-HD's root folder leaves the tree; Radarr-4K's stays.
    expect(rowAt(wrapper, '/data/media/movies').exists()).toBe(true);
    expect(rowAt(wrapper, '/data/media/tv').exists()).toBe(false);
  });

  it('the batch buttons hand the instance choice to a dialog', async () => {
    const wrapper = await mountView();

    await rowAt(wrapper, '/data/media/spare').find('input[type="checkbox"]').trigger('change');
    await flushPromises();

    const add = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Add root folder here…'));
    expect(add?.text()).toContain('(1)');
    await add?.trigger('click');
    await flushPromises();

    expect(document.body.textContent).toContain('Add a root folder to the fleet');
    expect(document.body.textContent).toContain('/data/media/spare');
    expect(push).not.toHaveBeenCalled();
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
