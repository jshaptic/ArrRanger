import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ArrMedia, ArrRootFolder, Instance } from '@arrranger/shared';
import type { InstancesRepository } from '../repositories/instances.repo.js';
import {
  isAtOrUnder,
  normalisePath,
  parentPath,
  PathIndexService,
} from './path-index.service.js';
import type { ResourcesService } from './resources.service.js';

function instance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: 1,
    name: 'Radarr',
    kind: 'radarr',
    baseUrl: 'http://radarr.test',
    verifySsl: true,
    enabled: true,
    timeoutMs: 5000,
    appVersion: null,
    lastConnectedAt: null,
    lastError: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function rootFolder(path: string, id = 1): ArrRootFolder {
  return { id, path, accessible: true, freeSpace: 1024, totalSpace: 2048 };
}

function media(id: number, path: string, title = `Title ${String(id)}`): ArrMedia {
  return { id, title, path, qualityProfileId: 0, monitored: true, tags: [] };
}

/** A stand-in for the two services the index reads through. */
function serviceFor(
  fleet: ReadonlyArray<{
    instance: Instance;
    rootFolders?: readonly ArrRootFolder[];
    media?: readonly ArrMedia[];
    fails?: boolean;
    cached?: boolean;
  }>,
): { service: PathIndexService; fetches: () => number } {
  let fetches = 0;

  const find = (id: number) => fleet.find((entry) => entry.instance.id === id);

  const instances = {
    list: () => fleet.map((entry) => entry.instance),
  } as unknown as InstancesRepository;

  const resources = {
    mediaLibrary: async (id: number) => {
      const entry = find(id);
      if (entry?.fails === true) throw new Error('instance did not answer');
      fetches += 1;
      return { items: entry?.media ?? [], fetchedAt: '2026-01-01T00:00:00.000Z' };
    },
    rootFolders: async (id: number) => {
      const entry = find(id);
      if (entry?.fails === true) throw new Error('instance did not answer');
      fetches += 1;
      return entry?.rootFolders ?? [];
    },
    peekMediaLibrary: (id: number) => {
      const entry = find(id);
      return entry?.cached === false ? null : (entry?.media ?? []);
    },
    peekRootFolders: (id: number) => {
      const entry = find(id);
      return entry?.cached === false ? null : (entry?.rootFolders ?? []);
    },
  } as unknown as ResourcesService;

  return { service: new PathIndexService({ instances, resources }), fetches: () => fetches };
}

describe('path helpers', () => {
  test('normalises trailing separators without eating the root', () => {
    assert.equal(normalisePath('/data/media/'), '/data/media');
    assert.equal(normalisePath('/data/media'), '/data/media');
    assert.equal(normalisePath('/'), '/');
  });

  test('walks up to the root and then stops', () => {
    assert.equal(parentPath('/data/media/movies'), '/data/media');
    assert.equal(parentPath('/data'), '/');
    assert.equal(parentPath('/'), null);
  });

  test('a shared prefix is not containment - the bug that moves the wrong media', () => {
    assert.equal(isAtOrUnder('/data/movies-4k/Arrival (2016)', '/data/movies'), false);
    assert.equal(isAtOrUnder('/data/movies/Dune (2021)', '/data/movies'), true);
    assert.equal(isAtOrUnder('/data/movies', '/data/movies'), true);
    assert.equal(isAtOrUnder('/data/movies', '/'), true);
  });
});

describe('PathIndexService', () => {
  test('credits every ancestor, so a nested library is never an orphan', async () => {
    const { service } = serviceFor([
      {
        instance: instance(),
        rootFolders: [rootFolder('/data/media')],
        media: [media(10, '/data/media/movies/The Matrix (1999)')],
      },
    ]);

    const [index] = await service.index();
    assert.ok(index);

    // The whole point: `movies` is an intermediate folder that holds media. The old
    // one-level reconcile scan called it an orphan.
    assert.equal(index.mediaUnder.get('/data/media/movies'), 1);
    assert.equal(index.mediaUnder.get('/data/media'), 1);
    assert.equal(index.mediaUnder.get('/data'), 1);
    assert.equal(index.mediaUnder.get('/'), 1);
    assert.equal(index.mediaUnder.get('/data/media/movies/The Matrix (1999)'), 1);
    assert.equal(index.mediaUnder.get('/data/media/tv'), undefined);
  });

  test('counts accumulate at every shared ancestor, at depth', async () => {
    const { service } = serviceFor([
      {
        instance: instance(),
        rootFolders: [rootFolder('/data')],
        media: [
          media(1, '/data/a/b/c/d/One'),
          media(2, '/data/a/b/c/d/Two'),
          media(3, '/data/a/b/other/Three'),
        ],
      },
    ]);

    const [index] = await service.index();
    assert.equal(index?.mediaUnder.get('/data/a/b/c/d'), 2);
    assert.equal(index?.mediaUnder.get('/data/a/b'), 3);
    assert.equal(index?.mediaUnder.get('/data'), 3);
  });

  test('indexes children by parent, from media paths and root folders alike', async () => {
    const { service } = serviceFor([
      {
        instance: instance(),
        rootFolders: [rootFolder('/data/media/movies'), rootFolder('/data/media/tv', 2)],
        media: [media(1, '/data/media/movies/Dune (2021)')],
      },
    ]);

    const [index] = await service.index();
    assert.deepEqual(
      [...(index?.childrenByParent.get('/data/media') ?? [])].sort(),
      ['/data/media/movies', '/data/media/tv'],
    );
    assert.deepEqual([...(index?.childrenByParent.get('/data/media/movies') ?? [])], [
      '/data/media/movies/Dune (2021)',
    ]);
  });

  test('an unreachable instance still gets a column, but contributes nothing', async () => {
    const { service } = serviceFor([
      { instance: instance(), rootFolders: [rootFolder('/data/media')], media: [media(1, '/data/media/A')] },
      { instance: instance({ id: 2, name: 'Sonarr', kind: 'sonarr' }), fails: true },
    ]);

    const indexes = await service.index();
    assert.equal(indexes.length, 2);

    const failed = indexes.find((entry) => entry.instanceId === 2);
    assert.equal(failed?.reachable, false);
    assert.match(failed?.error ?? '', /did not answer/);
    assert.equal(failed?.rootFolders.size, 0);
    assert.equal(failed?.mediaUnder.size, 0);
  });

  test('skips instances that are disabled', async () => {
    const { service } = serviceFor([
      { instance: instance({ enabled: false }), rootFolders: [rootFolder('/data/media')] },
    ]);
    assert.deepEqual(await service.index(), []);
  });

  test('serves a second read from cache, and refetches on refresh', async () => {
    const { service, fetches } = serviceFor([
      { instance: instance(), rootFolders: [rootFolder('/data/media')], media: [] },
    ]);

    await service.index();
    const afterFirst = fetches();
    await service.index();
    assert.equal(fetches(), afterFirst, 'a cached read must not touch the instance');

    await service.index({ refresh: true });
    assert.ok(fetches() > afterFirst);
  });

  test('invalidate makes the next read see a change immediately', async () => {
    const folders: ArrRootFolder[] = [rootFolder('/data/media')];
    const { service } = serviceFor([{ instance: instance(), rootFolders: folders, media: [] }]);

    await service.index();
    folders.push(rootFolder('/data/media/audiobooks', 2));

    assert.equal((await service.index())[0]?.rootFolders.has('/data/media/audiobooks'), false);
    service.invalidate();
    assert.equal((await service.index())[0]?.rootFolders.has('/data/media/audiobooks'), true);
  });

  describe('referencedBy', () => {
    test('reports the instances pointing at a path or anything beneath it', async () => {
      const { service } = serviceFor([
        {
          instance: instance(),
          rootFolders: [rootFolder('/data/media/movies')],
          media: [media(1, '/data/media/movies/Dune (2021)')],
        },
        {
          instance: instance({ id: 2, name: 'Sonarr', kind: 'sonarr' }),
          rootFolders: [rootFolder('/data/media/tv', 5)],
          media: [],
        },
      ]);

      const ids = async (target: string): Promise<readonly number[]> =>
        (await service.referencedBy(target)).instanceIds;

      assert.deepEqual(await ids('/data/media/movies'), [1]);
      assert.deepEqual(await ids('/data/media/movies/Dune (2021)'), [1]);
      assert.deepEqual(await ids('/data/media/tv'), [2]);
      assert.deepEqual(await ids('/data/media'), [1]);
    });

    test('a shared prefix is not a reference', async () => {
      const { service } = serviceFor([
        {
          instance: instance(),
          rootFolders: [rootFolder('/data/movies')],
          media: [media(1, '/data/movies/Heat (1995)')],
        },
      ]);

      assert.deepEqual((await service.referencedBy('/data/movies-4k')).instanceIds, []);
      assert.deepEqual((await service.referencedBy('/data/mov')).instanceIds, []);
    });

    test('never turns a cache miss into a request', async () => {
      const { service, fetches } = serviceFor([
        {
          instance: instance(),
          rootFolders: [rootFolder('/data/media')],
          media: [media(1, '/data/media/A')],
          cached: false,
        },
      ]);

      // Nothing cached and no fetch allowed: the guard says so rather than contacting
      // *Arr, and "incomplete" is what stops a caller reading it as "nothing owns this".
      const answer = await service.referencedBy('/data/media');
      assert.deepEqual(answer.instanceIds, []);
      assert.equal(answer.complete, false);
      assert.equal(fetches(), 0);

      // A blocker may pay for the truth.
      const fetched = await service.referencedBy('/data/media', { allowFetch: true });
      assert.deepEqual(fetched.instanceIds, [1]);
      assert.equal(fetched.complete, true);
      assert.ok(fetches() > 0);
    });
  });
});
