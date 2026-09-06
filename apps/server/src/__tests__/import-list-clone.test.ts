import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { InstanceResponse, QueueListResponse, RunResponse } from '@arrranger/shared';
import { startFakeArr, serverApiKey, type FakeArrServer } from './fake-arr.js';
import { api, makeTempDir, readSse, removeTempDir, startTestApp, type TestApp } from './helpers.js';

describe('copying an import list onto another instance', () => {
  let sourceArr: FakeArrServer;
  let destArr: FakeArrServer;
  let server: TestApp;
  let configDir: string;
  let sourceId = 0;
  let destId = 0;

  before(async () => {
    sourceArr = await startFakeArr({ kind: 'radarr' });
    destArr = await startFakeArr({ kind: 'radarr' });
    destArr.state.importLists = [];
    const source = sourceArr.state.importLists[0];
    if (source !== undefined) source.tags = [1, 2];

    configDir = makeTempDir();
    server = await startTestApp(configDir);

    const sourceInstance = await api<InstanceResponse>(server.url, '/instances', {
      method: 'POST',
      body: {
        name: 'Radarr-4K',
        kind: 'radarr',
        baseUrl: sourceArr.url,
        apiKey: serverApiKey(),
      },
    });
    const destInstance = await api<InstanceResponse>(server.url, '/instances', {
      method: 'POST',
      body: {
        name: 'Radarr-HD',
        kind: 'radarr',
        baseUrl: destArr.url,
        apiKey: serverApiKey(),
      },
    });
    assert.equal(sourceInstance.status, 201);
    assert.equal(destInstance.status, 201);
    sourceId = sourceInstance.body.instance.id;
    destId = destInstance.body.instance.id;
  });

  after(async () => {
    await server.close();
    await sourceArr.close();
    await destArr.close();
    removeTempDir(configDir);
  });

  test('clones the source raw body and does not copy tag ids', async () => {
    const staged = await api<{ items: Array<{ op: string }> }>(server.url, '/queue', {
      method: 'POST',
      body: {
        items: [
          {
            instanceId: destId,
            op: 'importList.create',
            payload: { name: 'Trakt watchlist', sourceInstanceId: sourceId, sourceImportListId: 1 },
          },
        ],
      },
    });
    assert.equal(staged.status, 201);

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
    assert.equal(finished.body.run.status, 'completed');
    assert.equal(finished.body.run.failedItems, 0);

    assert.equal(destArr.state.importLists.length, 1);
    const copied = destArr.state.importLists[0];
    assert.equal(copied?.name, 'Trakt watchlist');
    assert.deepEqual(copied?.tags, []);
    assert.equal(copied?.secretServerField, 'must-survive-put');
    assert.equal(copied?.rootFolderPath, '/data/media');
    // Dest was empty, so *Arr assigns id 1 independently. The source must be untouched.
    assert.deepEqual(sourceArr.state.importLists[0]?.tags, [1, 2]);
    assert.equal(sourceArr.state.importLists.length, 1);

    const queue = await api<QueueListResponse>(server.url, '/queue');
    assert.equal(queue.body.items[0]?.result?.['importListId'], copied?.id);
  });
});
