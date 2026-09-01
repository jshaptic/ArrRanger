import type { Instance, NewQueueItem } from '@arrranger/shared';
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
  {
    id: 2,
    name: 'Radarr-HD',
    kind: 'radarr',
    baseUrl: 'http://host:7879',
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
let nextId = 1;

const push = vi.fn((items: readonly NewQueueItem[]) =>
  Promise.resolve({
    items: items.map((entry) => ({
      id: nextId++,
      instanceId: entry.instanceId ?? null,
      kind: (entry.instanceId === undefined || entry.instanceId === null ? 'fs' : 'arr') as 'fs' | 'arr',
      runId: null,
      dependsOnId: entry.dependsOnId ?? null,
      sortOrder: nextId,
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
    roots: () => Promise.resolve({ enabled: true, roots: [] }),
    list: vi.fn(),
    measure: vi.fn(),
    preflight: () =>
      Promise.resolve({
        op: 'fs.rename',
        ok: true,
        checks: [{ id: 'same_device', status: 'ok', message: 'Same filesystem - atomic rename' }],
        measurement: null,
        freeSpace: null,
        referencedBy: [],
      }),
    reconcile: vi.fn(),
  },
}));

vi.mock('@/api/instances', () => ({
  instancesApi: { list: () => Promise.resolve({ instances: INSTANCES }) },
}));

// Only Radarr-4K has this path as a root folder, so only it should be realigned.
vi.mock('@/api/resources', () => ({
  resourcesApi: {
    snapshot: (instanceId: number) =>
      Promise.resolve({
        instanceId,
        fetchedAt: '2026-09-01T00:00:00.000Z',
        tags: [],
        rootFolders:
          instanceId === 1
            ? [{ id: 5, path: ROOT, accessible: true, freeSpace: 1, totalSpace: 2 }]
            : [{ id: 9, path: '/media/movies', accessible: true, freeSpace: 1, totalSpace: 2 }],
        importLists: [],
      }),
    media: vi.fn(),
    allMediaIdsInRootFolder: vi.fn(() => Promise.resolve([10, 11, 12])),
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

const ReconcileDialog = (await import('./ReconcileDialog.vue')).default;
const { useMatrixStore } = await import('@/stores/matrix');
const { useInstancesStore } = await import('@/stores/instances');

async function mountDialog() {
  const pinia = createPinia();
  const wrapper = mount(ReconcileDialog, {
    props: { path: ROOT },
    global: { plugins: [pinia] },
  });

  await useInstancesStore().load();
  await useMatrixStore().load();
  for (let tick = 0; tick < 8; tick += 1) await flushPromises();
  return wrapper;
}

beforeEach(() => {
  push.mockClear();
  nextId = 1;
});

describe('ReconcileDialog', () => {
  it('offers only the instances that use this path as a root folder', async () => {
    const wrapper = await mountDialog();
    const text = document.body.textContent ?? '';

    expect(text).toContain('Radarr-4K');
    expect(text).not.toContain('Radarr-HD');
    expect(text).toContain('3 item(s) to realign');
    wrapper.unmount();
  });

  it('spells out the chain, including that no files will be copied', async () => {
    const wrapper = await mountDialog();
    const text = document.body.textContent ?? '';

    expect(text).toContain('rename /data/movies');
    expect(text).toContain('moveFiles: false');
    expect(text).toContain('Every *Arr step waits for the disk step');
    wrapper.unmount();
  });

  it('stages the disk rename first, with every *Arr step depending on it', async () => {
    const wrapper = await mountDialog();

    const nameInput = document.body.querySelector<HTMLInputElement>('input[type="text"]');
    if (nameInput) {
      nameInput.value = 'films';
      nameInput.dispatchEvent(new Event('input'));
    }
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    const stage = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Stage'),
    );
    stage?.click();
    for (let tick = 0; tick < 8; tick += 1) await flushPromises();

    const batches = push.mock.calls.map((call) => call[0][0]);

    // 1. the disk, with no instance attached
    expect(batches[0]).toEqual({ op: 'fs.rename', payload: { from: ROOT, to: '/data/films' } });

    // 2. the destination root folder, gated on the rename
    expect(batches[1]).toMatchObject({
      instanceId: 1,
      op: 'rootFolder.create',
      payload: { path: '/data/films' },
      dependsOnId: 1,
    });

    // 3. realignment - and this is the whole point of the phase
    expect(batches[2]).toMatchObject({
      instanceId: 1,
      op: 'media.moveRootFolder',
      payload: { mediaIds: [10, 11, 12], toRootFolderPath: '/data/films', moveFiles: false },
      dependsOnId: 2,
    });

    // 4. rescan, then 5. drop the old root folder - both gated on the realignment
    expect(batches[3]).toMatchObject({ instanceId: 1, op: 'media.refresh', dependsOnId: 3 });
    expect(batches[4]).toMatchObject({
      instanceId: 1,
      op: 'rootFolder.delete',
      payload: { rootFolderId: 5, path: ROOT },
      dependsOnId: 3,
    });
    wrapper.unmount();
  });

  it('skips the optional steps when they are turned off', async () => {
    const wrapper = await mountDialog();

    const nameInput = document.body.querySelector<HTMLInputElement>('input[type="text"]');
    if (nameInput) {
      nameInput.value = 'films';
      nameInput.dispatchEvent(new Event('input'));
    }
    for (const box of document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      // Instance checkbox stays on; the two option toggles go off.
      if (box.checked && box !== document.body.querySelector('input[type="checkbox"]')) box.click();
    }
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    const stage = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Stage'),
    );
    stage?.click();
    for (let tick = 0; tick < 8; tick += 1) await flushPromises();

    const ops = push.mock.calls.map((call) => call[0][0]?.op);
    expect(ops).toEqual(['fs.rename', 'rootFolder.create', 'media.moveRootFolder']);
    wrapper.unmount();
  });
});
