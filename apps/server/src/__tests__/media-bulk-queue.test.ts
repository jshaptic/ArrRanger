import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  InstanceResponse,
  NewQueueItem,
  QueueListResponse,
  RunResponse,
} from '@fleetarr/shared';
import { serverApiKey, startFakeArr, type FakeArrServer } from './fake-arr.js';
import { api, makeTempDir, readSse, removeTempDir, startTestApp, type TestApp } from './helpers.js';

describe('media bulk operations', () => {
  let arr: FakeArrServer;
  let server: TestApp;
  let configDir: string;
  let instanceId = 0;

  before(async () => {
    arr = await startFakeArr({ kind: 'radarr' });
    configDir = makeTempDir();
    server = await startTestApp(configDir);

    const created = await api<InstanceResponse>(server.url, '/instances', {
      method: 'POST',
      body: { name: 'Radarr-HD', kind: 'radarr', baseUrl: arr.url, apiKey: serverApiKey() },
    });
    assert.equal(created.status, 201);
    instanceId = created.body.instance.id;
  });

  after(async () => {
    await server.close();
    await arr.close();
    removeTempDir(configDir);
  });

  /** Stage one item, apply it, and hand back the stored row. */
  async function run(item: Omit<NewQueueItem, 'instanceId'>): Promise<QueueListResponse['items'][number]> {
    const staged = await api<{ items: Array<{ id: number }> }>(server.url, '/queue', {
      method: 'POST',
      body: { items: [{ instanceId, ...item }] },
    });
    assert.equal(staged.status, 201, JSON.stringify(staged.body));
    const itemId = staged.body.items[0]?.id ?? 0;

    const started = await api<RunResponse>(server.url, '/queue/runs', { method: 'POST', body: {} });
    assert.equal(started.status, 202);
    await readSse(
      `${server.url}/api/queue/runs/${String(started.body.run.id)}/stream`,
      (event) => event.type === 'run.finished',
    );

    const finished = await api<RunResponse>(
      server.url,
      `/queue/runs/${String(started.body.run.id)}`,
    );
    assert.equal(finished.body.run.status, 'completed', JSON.stringify(finished.body.run));

    const stored = finished.body.items.find((entry) => entry.id === itemId);
    assert.ok(stored, 'the run should carry the item it applied');
    assert.equal(stored.status, 'succeeded');
    return stored;
  }

  test('mediaTags.set replaces the whole list rather than merging into it', async () => {
    const target = arr.state.media[1];
    assert.ok(target);
    target.tags = [1, 2];

    const stored = await run({
      op: 'mediaTags.set',
      payload: { mediaIds: [target.id], tagIds: [3] },
    });

    assert.deepEqual(arr.state.media.find((m) => m.id === target.id)?.tags, [3]);
    assert.match(stored.summary, /Replace tags on 1 item\(s\) with 1 tag\(s\)/);
  });

  test('mediaTags.set with no tags clears them - the case add and remove refuse', async () => {
    const target = arr.state.media[0];
    assert.ok(target);
    target.tags = [1];

    const stored = await run({ op: 'mediaTags.set', payload: { mediaIds: [target.id], tagIds: [] } });

    assert.deepEqual(arr.state.media.find((m) => m.id === target.id)?.tags, []);
    assert.match(stored.summary, /Clear all tags on 1 item\(s\)/);
  });

  test('an empty tag list is still refused for add, which has no such meaning', async () => {
    const rejected = await api<{ error: { code: string } }>(server.url, '/queue', {
      method: 'POST',
      body: { items: [{ instanceId, op: 'mediaTags.add', payload: { mediaIds: [10], tagIds: [] } }] },
    });
    assert.equal(rejected.status, 400);
  });

  test('media.setMonitored flips the flag', async () => {
    const ids = arr.state.media.map((m) => m.id);
    const stored = await run({
      op: 'media.setMonitored',
      payload: { mediaIds: ids, monitored: false },
    });

    assert.equal(
      arr.state.media.every((m) => !m.monitored),
      true,
    );
    assert.match(stored.summary, /Unmonitor \d+ item\(s\)/);
  });

  test('media.setQualityProfile records the name, because the id does not travel', async () => {
    const target = arr.state.media[0];
    assert.ok(target);

    const stored = await run({
      op: 'media.setQualityProfile',
      payload: { mediaIds: [target.id], qualityProfileId: 4, profileName: 'Ultra-HD' },
    });

    assert.equal(arr.state.media.find((m) => m.id === target.id)?.qualityProfileId, 4);
    assert.match(stored.summary, /Set quality profile "Ultra-HD" on 1 item\(s\)/);
  });

  test('media.delete honours both flags and says which in the summary', async () => {
    const target = arr.state.media.at(-1);
    assert.ok(target);
    const before = arr.state.media.length;

    const stored = await run({
      op: 'media.delete',
      payload: { mediaIds: [target.id], deleteFiles: true, addImportExclusion: true },
    });

    assert.equal(arr.state.media.length, before - 1);
    assert.equal(
      arr.state.media.some((m) => m.id === target.id),
      false,
    );
    // Radarr spells the exclusion flag `addImportExclusion`; Sonarr does not. The fake
    // reads only its own spelling, so this passing is the proof the right key was sent.
    assert.deepEqual(arr.deleted.at(-1), {
      mediaIds: [target.id],
      deleteFiles: true,
      addImportExclusion: true,
    });
    assert.match(stored.summary, /and their files from disk, adding an import exclusion/);
    assert.deepEqual(stored.result, {
      deleted: 1,
      deleteFiles: true,
      addImportExclusion: true,
    });
  });

  test('media.delete leaves the files alone unless told otherwise', async () => {
    const target = arr.state.media.at(-1);
    assert.ok(target);

    const stored = await run({
      op: 'media.delete',
      payload: { mediaIds: [target.id], deleteFiles: false, addImportExclusion: false },
    });

    assert.deepEqual(arr.deleted.at(-1)?.deleteFiles, false);
    assert.match(stored.summary, /leaving the files on disk/);
    assert.doesNotMatch(stored.summary, /import exclusion/);
  });

  test('the affected count is the number of items, never 1', async () => {
    // The regression this exists for: affectedCountForOp used to fall through to 1, so a
    // 3000-item delete reviewed as "1 affected" in the one column that exists to show it.
    const ids = arr.state.media.map((m) => m.id);
    assert.ok(ids.length > 1, 'need several items for this to mean anything');

    const staged = await api<{ items: Array<{ op: string; affectedCount: number }> }>(
      server.url,
      '/queue',
      {
        method: 'POST',
        body: {
          items: [
            { instanceId, op: 'mediaTags.set', payload: { mediaIds: ids, tagIds: [1] } },
            { instanceId, op: 'media.setMonitored', payload: { mediaIds: ids, monitored: true } },
            {
              instanceId,
              op: 'media.setQualityProfile',
              payload: { mediaIds: ids, qualityProfileId: 1, profileName: 'HD-1080p' },
            },
            {
              instanceId,
              op: 'media.delete',
              payload: { mediaIds: ids, deleteFiles: false, addImportExclusion: false },
            },
          ],
        },
      },
    );
    assert.equal(staged.status, 201);

    for (const item of staged.body.items) {
      assert.equal(item.affectedCount, ids.length, item.op);
    }

    await api(server.url, '/queue?statuses=pending', { method: 'DELETE' });
  });
});
