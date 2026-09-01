import type { Instance, NewQueueItem } from '@arrranger/shared';
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

const INSTANCES = [instance(1, 'Radarr-4K'), instance(2, 'Radarr-HD'), instance(3, 'Sonarr', 'sonarr')];

/** Radarr-4K and Radarr-HD disagree about where "movies" is mounted. */
const ROOT_FOLDERS: Record<number, Array<{ id: number; path: string; accessible: boolean }>> = {
  1: [{ id: 1, path: '/data/media/movies', accessible: true }],
  2: [{ id: 5, path: '/media/movies', accessible: true }],
  3: [{ id: 8, path: '/data/media/tv', accessible: false }],
};

const push = vi.fn((items: readonly NewQueueItem[]) =>
  Promise.resolve({
    items: items.map((entry, index) => ({
      id: index + 1,
      instanceId: entry.instanceId,
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

const RootFolderTopologyView = (await import('./RootFolderTopologyView.vue')).default;

async function mountView() {
  const wrapper = mount(RootFolderTopologyView, {
    global: { plugins: [createPinia()], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  for (let tick = 0; tick < 6; tick += 1) await flushPromises();
  return wrapper;
}

beforeEach(() => {
  push.mockClear();
});

describe('RootFolderTopologyView', () => {
  it('reports the mount-point conflict between sibling instances', async () => {
    const wrapper = await mountView();
    const text = wrapper.text();

    expect(text).toContain('Sibling instances disagree on 1 mount point(s)');
    expect(text).toContain('/data/media/movies');
    expect(text).toContain('/media/movies');
    expect(text).toContain('Radarr-4K');
    expect(text).toContain('Radarr-HD');
  });

  it('flags an inaccessible root folder', async () => {
    const wrapper = await mountView();
    const tvRow = wrapper
      .findAll('tbody tr')
      .find((row) => row.text().includes('/data/media/tv'));
    expect(tvRow?.text()).toContain('⚠');
  });

  it('shows free space per instance and a fleet total', async () => {
    const wrapper = await mountView();
    expect(wrapper.find('tfoot').text()).toContain('free space');
    expect(wrapper.findAll('[data-cell="root"]').length).toBe(9); // 3 paths x 3 instances
  });

  it('clicking a gap stages the path on that instance only', async () => {
    const wrapper = await mountView();
    const moviesRow = wrapper
      .findAll('tbody tr')
      .find((row) => row.text().includes('/data/media/movies'));
    const cells = moviesRow?.findAll('[data-cell="root"]') ?? [];

    await cells[1]?.trigger('click');
    await flushPromises();

    expect(push.mock.calls[0]?.[0]).toEqual([
      { instanceId: 2, op: 'rootFolder.create', payload: { path: '/data/media/movies' } },
    ]);
  });

  it('re-mapping stages create -> move -> delete with the moveFiles choice', async () => {
    const wrapper = await mountView();

    const remap = wrapper
      .findAll('button')
      .find((button) => button.text() === 're-map');
    await remap?.trigger('click');
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    const dialog = document.body;
    expect(dialog.textContent).toContain('Re-map a root folder across instances');
    // media ids were counted for the instance holding the source path
    expect(dialog.textContent).toContain('3 item(s)');

    const pathInput = dialog.querySelector<HTMLInputElement>('input[list="known-paths"]');
    if (pathInput) {
      pathInput.value = '/media/movies';
      pathInput.dispatchEvent(new Event('input'));
    }
    const moveFilesBox = dialog.querySelector<HTMLInputElement>('[data-testid="move-files"]');
    moveFilesBox?.click();
    await flushPromises();

    const confirm = [...dialog.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Stage re-map'),
    );
    confirm?.click();
    for (let tick = 0; tick < 6; tick += 1) await flushPromises();

    // destination exists on Radarr-HD but not on Radarr-4K, so a create comes first
    expect(push.mock.calls[0]?.[0]).toEqual([
      { instanceId: 1, op: 'rootFolder.create', payload: { path: '/media/movies' } },
    ]);
    expect(push.mock.calls[1]?.[0]).toEqual([
      {
        instanceId: 1,
        op: 'media.moveRootFolder',
        payload: { mediaIds: [10, 11, 12], toRootFolderPath: '/media/movies', moveFiles: true },
        dependsOnId: 1,
      },
    ]);
    wrapper.unmount();
  });
});
