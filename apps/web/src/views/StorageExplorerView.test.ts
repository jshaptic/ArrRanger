import type { FsPreflight, Instance, NewQueueItem } from '@arrranger/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const INSTANCES: Instance[] = [
  {
    id: 1,
    name: 'Radarr-4K',
    kind: 'radarr',
    baseUrl: 'http://host:7878',
    verifySsl: true,
    enabled: true,
    timeoutMs: 20_000,
    appVersion: '5.0.0',
    lastConnectedAt: null,
    lastError: null,
    createdAt: '',
    updatedAt: '',
  },
];

const ROOT = '/data/movies';

const roots = vi.fn(() =>
  Promise.resolve({
    enabled: true,
    roots: [
      {
        path: ROOT,
        exists: true,
        readable: true,
        writable: true,
        deviceId: '42',
        freeSpace: 900_000_000_000,
        totalSpace: 4_000_000_000_000,
        error: null,
      },
    ],
  }),
);

const list = vi.fn((target: string) =>
  Promise.resolve({
    path: target,
    parent: null,
    entries: [
      {
        path: `${ROOT}/Arrival (2016)`,
        name: 'Arrival (2016)',
        kind: 'directory' as const,
        modifiedAt: '2026-09-01T00:00:00.000Z',
        childCount: 1,
        sizeOnDisk: null,
        fileCount: null,
        readable: true,
        writable: true,
      },
      {
        path: `${ROOT}/Orphan Film (1999)`,
        name: 'Orphan Film (1999)',
        kind: 'directory' as const,
        modifiedAt: '2026-09-01T00:00:00.000Z',
        childCount: 1,
        sizeOnDisk: null,
        fileCount: null,
        readable: true,
        writable: true,
      },
    ],
  }),
);

const reconcile = vi.fn(() =>
  Promise.resolve({
    scannedAt: '2026-09-01T00:00:00.000Z',
    roots: [ROOT],
    entries: [
      {
        path: `${ROOT}/Arrival (2016)`,
        name: 'Arrival (2016)',
        rootFolderPath: ROOT,
        state: 'matched' as const,
        isSymlink: false,
        instanceIds: [1],
        modifiedAt: null,
      },
      {
        path: `${ROOT}/Orphan Film (1999)`,
        name: 'Orphan Film (1999)',
        rootFolderPath: ROOT,
        state: 'orphan' as const,
        isSymlink: false,
        instanceIds: [],
        modifiedAt: null,
      },
    ],
    missing: [
      { path: `${ROOT}/Gone Missing (2001)`, instanceId: 1, kind: 'media' as const, title: 'Gone Missing' },
    ],
    mismatches: [],
    counts: { matched: 1, orphan: 1, empty: 0, missing: 1 },
  }),
);

const preflight = vi.fn(
  (): Promise<FsPreflight> =>
    Promise.resolve({
      op: 'fs.delete',
      ok: true,
      checks: [
        { id: 'inside_root', status: 'ok', message: 'inside an allowed storage root' },
        { id: 'recursive_delete', status: 'warning', message: 'Deletes 1.0 GB in 1 file(s)' },
      ],
      measurement: { path: `${ROOT}/Orphan Film (1999)`, sizeOnDisk: 1_073_741_824, fileCount: 1, directoryCount: 0, truncated: false },
      freeSpace: 900_000_000_000,
      referencedBy: [],
    }),
);

const push = vi.fn((items: readonly NewQueueItem[]) =>
  Promise.resolve({
    items: items.map((entry, index) => ({
      id: index + 1,
      instanceId: entry.instanceId ?? null,
      kind: (entry.instanceId === undefined || entry.instanceId === null ? 'fs' : 'arr') as 'fs' | 'arr',
      runId: null,
      dependsOnId: entry.dependsOnId ?? null,
      sortOrder: index + 1,
      status: 'pending' as const,
      op: entry.op,
      payload: entry.payload,
      targetKind: 'path' as const,
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

vi.mock('@/api/storage', () => ({
  storageApi: {
    roots: () => roots(),
    list: (target: string) => list(target),
    measure: vi.fn(),
    preflight: () => preflight(),
    reconcile: () => reconcile(),
  },
}));

vi.mock('@/api/instances', () => ({
  instancesApi: { list: () => Promise.resolve({ instances: INSTANCES }) },
}));

vi.mock('@/api/resources', () => ({
  resourcesApi: {
    snapshot: (instanceId: number) =>
      Promise.resolve({ instanceId, fetchedAt: '', tags: [], rootFolders: [], importLists: [] }),
    media: vi.fn(),
    allMediaIdsInRootFolder: vi.fn(() => Promise.resolve([10])),
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

const StorageExplorerView = (await import('./StorageExplorerView.vue')).default;

async function mountView() {
  const wrapper = mount(StorageExplorerView, {
    global: { plugins: [createPinia()], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  for (let tick = 0; tick < 8; tick += 1) await flushPromises();
  return wrapper;
}

beforeEach(() => {
  push.mockClear();
  preflight.mockClear();
});

describe('StorageExplorerView', () => {
  it('shows the fleet-wide storage health counters', async () => {
    const wrapper = await mountView();
    const text = wrapper.text();

    expect(text).toContain('Orphaned folders');
    expect(text).toContain('Missing on disk');
    expect(text).toContain('/data/movies');
  });

  it('badges what is tracked, what is orphaned and what is missing', async () => {
    const wrapper = await mountView();
    const rows = wrapper.findAll('tbody tr');

    // The missing path comes first, struck through: *Arr believes in it, the disk does not.
    expect(rows[0]?.text()).toContain('Gone Missing (2001)');
    expect(rows[0]?.text()).toContain('missing');
    expect(rows[0]?.find('td').classes().join(' ')).toContain('line-through');

    const arrival = rows.find((row) => row.text().includes('Arrival (2016)'));
    expect(arrival?.text()).toContain('tracked');
    expect(arrival?.text()).toContain('1 instance(s)');

    const orphan = rows.find((row) => row.text().includes('Orphan Film (1999)'));
    expect(orphan?.text()).toContain('orphan');
    expect(orphan?.text()).not.toContain('tracked');
  });

  it('offers reconcile only for folders an instance tracks', async () => {
    const wrapper = await mountView();
    const rows = wrapper.findAll('tbody tr');

    const arrival = rows.find((row) => row.text().includes('Arrival (2016)'));
    const orphan = rows.find((row) => row.text().includes('Orphan Film (1999)'));

    expect(arrival?.findAll('button').some((button) => button.text() === 'reconcile')).toBe(true);
    expect(orphan?.findAll('button').some((button) => button.text() === 'reconcile')).toBe(false);
  });

  it('pruning requires typing the folder name, then stages one fs.delete', async () => {
    const wrapper = await mountView();
    const orphan = wrapper.findAll('tbody tr').find((row) => row.text().includes('Orphan Film'));

    await orphan?.findAll('button').find((button) => button.text() === 'prune')?.trigger('click');
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    const dialog = document.body;
    expect(dialog.textContent).toContain('Delete from disk');
    expect(dialog.textContent).toContain('no recycle bin');
    // The measured impact is shown before anything is staged.
    expect(dialog.textContent).toContain('1.0 GB in 1 file(s)');

    const stageButton = [...dialog.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Stage delete'),
    );
    expect(stageButton?.hasAttribute('disabled')).toBe(true);

    const confirm = [...dialog.querySelectorAll('input[type="text"]')].at(-1) as HTMLInputElement;
    confirm.value = 'Orphan Film (1999)';
    confirm.dispatchEvent(new Event('input'));
    await flushPromises();

    const enabled = [...dialog.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Stage delete'),
    );
    expect(enabled?.hasAttribute('disabled')).toBe(false);

    enabled?.click();
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[0]).toEqual([
      {
        op: 'fs.delete',
        payload: { path: `${ROOT}/Orphan Film (1999)`, recursive: false, force: false },
      },
    ]);
    wrapper.unmount();
  });

  it('a rename is staged with no instance attached', async () => {
    const wrapper = await mountView();
    const arrival = wrapper.findAll('tbody tr').find((row) => row.text().includes('Arrival (2016)'));

    await arrival?.findAll('button').find((button) => button.text() === 'rename')?.trigger('click');
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    const input = document.body.querySelector<HTMLInputElement>('input[type="text"]');
    if (input) {
      input.value = 'Arrival (2016) [remux]';
      input.dispatchEvent(new Event('input'));
    }
    await flushPromises();

    const stage = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Stage rename'),
    );
    stage?.click();
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    expect(push.mock.calls[0]?.[0]).toEqual([
      {
        op: 'fs.rename',
        payload: { from: `${ROOT}/Arrival (2016)`, to: `${ROOT}/Arrival (2016) [remux]` },
      },
    ]);
    expect(push.mock.calls[0]?.[0][0]).not.toHaveProperty('instanceId');
    wrapper.unmount();
  });
});

describe('StorageExplorerView with the feature off', () => {
  it('explains exactly what to configure', async () => {
    roots.mockResolvedValueOnce({ enabled: false, roots: [] });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('Filesystem access is off');
    expect(wrapper.text()).toContain('FS_ROOTS: /data');
    expect(wrapper.text()).toContain('the same path Radarr/Sonarr see');
    expect(wrapper.findAll('tbody tr')).toHaveLength(0);
  });
});
