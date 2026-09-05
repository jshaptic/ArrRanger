import type { NewQueueItem } from '@arrranger/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The align half of this dialog used to be `ReconcileDialog`, a second row action beside
 * `rename`. These are its tests, re-pointed: the chain is unchanged, what changed is that
 * choosing it is a checkbox next to the new name rather than a different button.
 */

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
  },
}));

vi.mock('@/api/resources', () => ({
  resourcesApi: {
    snapshot: vi.fn(),
    media: vi.fn(),
    allMediaIdsInRootFolder: vi.fn((instanceId: number) =>
      Promise.resolve(instanceId === 1 ? [10, 11, 12] : []),
    ),
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

const DiskOperationModal = (await import('./DiskOperationModal.vue')).default;

const RADARR_4K = {
  instanceId: 1,
  name: 'Radarr-4K',
  kind: 'radarr' as const,
  rootFolderId: 5,
  mediaUnder: 3,
};

async function mountDialog(
  props: Record<string, unknown> = { alignTargets: [RADARR_4K] },
): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(DiskOperationModal, {
    props: { operation: 'rename', target: ROOT, ...props },
    global: { plugins: [createPinia()] },
  });
  for (let tick = 0; tick < 8; tick += 1) await flushPromises();
  return wrapper;
}

/** The dialog teleports into the body, so every query goes through the document. */
function type(value: string): void {
  const input = document.body.querySelector<HTMLInputElement>('[data-testid="disk-operation-name"]');
  if (input) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
}

function stageButton(): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Stage'),
  );
}

beforeEach(() => {
  push.mockClear();
  nextId = 1;
});

describe('DiskOperationModal', () => {
  it('offers the instances rooting at this path, with what each would realign', async () => {
    const wrapper = await mountDialog();
    const text = document.body.textContent ?? '';

    expect(text).toContain('Rename & align');
    expect(text).toContain('Radarr-4K');
    expect(text).toContain('3 item(s) to realign');
    wrapper.unmount();
  });

  it('is a plain disk rename when no instance roots here', async () => {
    const wrapper = await mountDialog({ alignTargets: [] });
    const text = document.body.textContent ?? '';

    expect(text).toContain('Rename on disk');
    expect(text).not.toContain('to realign');
    expect(document.body.querySelector('[data-testid="align-targets"]')).toBeNull();

    type('films');
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();
    stageButton()?.click();
    for (let tick = 0; tick < 6; tick += 1) await flushPromises();

    expect(push.mock.calls.map((call) => call[0])).toEqual([
      [{ op: 'fs.rename', payload: { from: ROOT, to: '/data/films' } }],
    ]);
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

    type('films');
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    stageButton()?.click();
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

    type('films');
    for (const box of document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      // The instance checkbox stays on; the two option toggles go off.
      if (box.checked && box !== document.body.querySelector('input[type="checkbox"]')) box.click();
    }
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    stageButton()?.click();
    for (let tick = 0; tick < 8; tick += 1) await flushPromises();

    expect(push.mock.calls.map((call) => call[0][0]?.op)).toEqual([
      'fs.rename',
      'rootFolder.create',
      'media.moveRootFolder',
    ]);
    wrapper.unmount();
  });

  it('unchecking every instance leaves the disk rename alone, and says what it strands', async () => {
    const wrapper = await mountDialog({
      alignTargets: [RADARR_4K],
      trackedBy: [{ instanceId: 1, name: 'Radarr-4K', mediaCount: 3 }],
    });

    document.body.querySelector<HTMLInputElement>('[data-testid="align-targets"] input')?.click();
    type('films');
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    expect(document.body.textContent).toContain('No instance is selected below');

    stageButton()?.click();
    for (let tick = 0; tick < 6; tick += 1) await flushPromises();

    expect(push.mock.calls.map((call) => call[0][0]?.op)).toEqual(['fs.rename']);
    wrapper.unmount();
  });

  it('re-points an instance that roots here but has downloaded nothing yet', async () => {
    // No media ids to bulk-edit, so no editor call and no rescan - but the root folder is
    // still created at the new path and the old one dropped, or the rename would strand a
    // freshly configured instance.
    const wrapper = await mountDialog({
      alignTargets: [{ ...RADARR_4K, instanceId: 2, name: 'Sonarr', kind: 'sonarr', mediaUnder: 0 }],
    });

    type('films');
    for (let tick = 0; tick < 4; tick += 1) await flushPromises();

    expect(document.body.textContent).toContain('0 item(s) to realign');

    stageButton()?.click();
    for (let tick = 0; tick < 8; tick += 1) await flushPromises();

    expect(push.mock.calls.map((call) => call[0][0]?.op)).toEqual([
      'fs.rename',
      'rootFolder.create',
      'rootFolder.delete',
    ]);
    expect(push.mock.calls[2]?.[0][0]).toMatchObject({ dependsOnId: 2 });
    wrapper.unmount();
  });
});
