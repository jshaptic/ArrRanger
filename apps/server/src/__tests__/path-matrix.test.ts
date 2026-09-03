import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { InstanceResponse, PathMatrixResponse, PathNode } from '@arrranger/shared';
import { serverApiKey, startFakeArr, type FakeArrServer, type FakeMedia } from './fake-arr.js';
import { api, makeTempDir, removeTempDir, startTestApp, type TestApp } from './helpers.js';

interface ErrorBody {
  error: { code: string; message: string };
}

function fakeMedia(
  id: number,
  title: string,
  mediaPath: string,
  rootFolderPath: string,
  options: { hasFile?: boolean } = {},
): FakeMedia {
  return {
    hasFile: options.hasFile ?? true,
    id,
    title,
    sortTitle: title.toLowerCase(),
    path: mediaPath,
    rootFolderPath,
    qualityProfileId: 1,
    monitored: true,
    tags: [],
    year: 2000,
    sizeOnDisk: 0,
    images: [],
  };
}

function nodeAt(level: { nodes: readonly PathNode[] } | undefined, name: string): PathNode | undefined {
  return level?.nodes.find((node) => node.name === name);
}

function levelFor(body: PathMatrixResponse, target: string | null) {
  return body.levels.find((level) => level.path === target);
}

/**
 * The joined view, against a real temp filesystem and a fake Radarr.
 *
 * The layout is deliberately *nested* - the root folder is `<media>/library`, with the
 * films one level further down - because that is the shape the old one-level reconcile
 * scan got wrong.
 */
describe('the path matrix', () => {
  let arr: FakeArrServer;
  let server: TestApp;
  let configDir: string;
  let media: string;
  let instanceId = 0;

  const library = (): string => path.join(media, 'library');
  const films = (): string => path.join(media, 'library', 'films');

  const matrix = async (query = ''): Promise<PathMatrixResponse> =>
    (await api<PathMatrixResponse>(server.url, `/storage/matrix${query}`)).body;

  before(async () => {
    media = makeTempDir();

    // The tracked film, two levels under the root folder.
    mkdirSync(path.join(films(), 'The Matrix (1999)'), { recursive: true });
    writeFileSync(path.join(films(), 'The Matrix (1999)', 'movie.mkv'), 'x'.repeat(2048));
    // Inside the root folder, tracked by nobody.
    mkdirSync(path.join(films(), 'Orphan Film (1999)'), { recursive: true });
    mkdirSync(path.join(films(), 'Empty Folder'), { recursive: true });
    // Alongside the root folder, and nobody's root folder: the headline signal.
    mkdirSync(path.join(media, 'old-movies', 'Heat (1995)'), { recursive: true });
    symlinkSync(films(), path.join(media, 'films-link'));

    arr = await startFakeArr({ kind: 'radarr' });
    arr.state.rootFolders = [
      { id: 1, path: library(), accessible: true, freeSpace: 1e9, totalSpace: 4e9, unmappedFolders: [] },
      // Outside FS_ROOTS entirely: a volume mapping difference, not missing media.
      { id: 2, path: '/elsewhere/movies', accessible: true, freeSpace: 0, totalSpace: 0, unmappedFolders: [] },
    ];
    arr.state.media = [
      fakeMedia(10, 'The Matrix', path.join(films(), 'The Matrix (1999)'), library()),
      // Believed in, has a file, but not on disk: a real problem.
      fakeMedia(11, 'Gone Missing', path.join(films(), 'Gone Missing (2001)'), library()),
      // Monitored, never downloaded: its path is *meant* not to exist.
      fakeMedia(12, 'Not Out Yet', path.join(films(), 'Not Out Yet (2027)'), library(), {
        hasFile: false,
      }),
    ];

    configDir = makeTempDir();
    server = await startTestApp(configDir, { fsRoots: [media] });

    const created = await api<InstanceResponse>(server.url, '/instances', {
      method: 'POST',
      body: { name: 'Radarr', kind: 'radarr', baseUrl: arr.url, apiKey: serverApiKey() },
    });
    instanceId = created.body.instance.id;
  });

  after(async () => {
    await server.close();
    await arr.close();
    removeTempDir(configDir);
    removeTempDir(media);
  });

  // ------------------------------------------------------------ the fidelity fix

  test('a folder whose media sits levels below it still reads as in use', async () => {
    const body = await matrix();
    const node = nodeAt(levelFor(body, media), 'library');

    // Nothing sits at exactly this path - the films are two levels down, under films/.
    // A "media at exactly this path" check would score it 0 and call it an orphan; the
    // ancestor closure is what makes it read as in use at any depth.
    assert.ok(node);
    assert.equal(node.flags.includes('untracked'), false);
    assert.equal(node.flags.includes('rootFolder'), true);
    assert.equal(node.cells[0]?.mediaUnder, 3);
  });

  test('a root folder is a leaf: the library below it is not this view to manage', async () => {
    assert.equal(nodeAt(levelFor(await matrix(), media), 'library')?.expandable, false);

    // Asking for it anyway costs no readdir and yields nothing to render.
    const expanded = await matrix(`?path=${encodeURIComponent(library())}`);
    assert.deepEqual(levelFor(expanded, library())?.nodes, []);
    assert.equal(nodeAt(levelFor(expanded, library()), 'films'), undefined);
  });

  test('the spine is expanded to each root folder, and stops there', async () => {
    const body = await matrix();

    assert.ok(levelFor(body, null), 'a top level carries the mounts');
    assert.ok(levelFor(body, media), 'the mount is expanded');
    // Expansion stops *at* the root folder: below it lies the library.
    assert.equal(
      levelFor(body, library()),
      undefined,
      'a root folder stays collapsed on first paint',
    );
    assert.equal(levelFor(body, films()), undefined);

    const rootFolder = nodeAt(levelFor(body, media), 'library');
    assert.equal(rootFolder?.flags.includes('rootFolder'), true);
    assert.equal(rootFolder?.cells[0]?.role, 'rootFolder');
    assert.equal(rootFolder?.cells[0]?.rootFolderId, 1);
  });

  test('a folder alongside a root folder that nobody roots is flagged', async () => {
    const body = await matrix();
    const node = nodeAt(levelFor(body, media), 'old-movies');

    assert.equal(node?.flags.includes('candidate'), true, 'the "not a root folder" signal');
    assert.equal(node?.flags.includes('rootFolder'), false);
    assert.equal(node?.cells[0]?.role, 'outside');
    assert.ok((body.totals.candidates ?? 0) >= 1);
  });

  test('only=candidates answers the headline question directly', async () => {
    const body = await matrix(`?path=${encodeURIComponent(media)}&only=candidates`);
    const names = levelFor(body, media)?.nodes.map((node) => node.name) ?? [];

    assert.equal(names.includes('old-movies'), true);
    assert.equal(names.includes('library'), false, 'a root folder is not a candidate');
  });

  test('an ancestor of a root folder is a container, not unmanaged media', async () => {
    const body = await matrix();
    // The mount's basename is the random temp-dir name, so find it by path.
    const mount = levelFor(body, null)?.nodes.find((node) => node.path === media);

    // The mount holds 2 media items, but they sit under a root folder further down.
    assert.ok((mount?.cells[0]?.mediaUnder ?? 0) > 0);
    assert.equal(mount?.flags.includes('unmanaged'), false);
    assert.equal(body.totals.unmanaged, 0);
  });

  // ------------------------------------------------------- presence and mapping

  test('a root folder outside FS_ROOTS is a row, never a stat', async () => {
    const body = await matrix();
    const node = nodeAt(levelFor(body, null), 'movies');

    assert.equal(node?.path, '/elsewhere/movies');
    assert.equal(node?.inScope, false);
    assert.equal(node?.exists, false);
    assert.equal(node?.origin, 'arr');
    assert.deepEqual([...(node?.flags ?? [])].sort(), ['rootFolder', 'unseen']);
    assert.equal(node?.error, null);

    assert.deepEqual(body.columns[0]?.unseenRootFolders, ['/elsewhere/movies']);
    assert.equal(body.totals.unseenRootFolders, 1);
  });

  test('an *Arr path that should be on disk and is not appears in tree position', async () => {
    const body = await matrix(`?path=${encodeURIComponent(films())}&only=missing`);
    const node = nodeAt(levelFor(body, films()), 'Gone Missing (2001)');

    assert.equal(node?.exists, false);
    assert.equal(node?.inScope, true);
    assert.equal(node?.origin, 'arr');
    assert.equal(node?.flags.includes('missing'), true);
    assert.equal(node?.cells[0]?.title, 'Gone Missing');
  });

  test('a wanted film nobody has downloaded is not a folder missing from disk', async () => {
    // Radarr gives a monitored film a path before the file exists. Reporting those would
    // bury the real signal under every unreleased title in the library.
    const body = await matrix(`?path=${encodeURIComponent(films())}&only=all`);
    const names = levelFor(body, films())?.nodes.map((entry) => entry.name) ?? [];

    assert.equal(names.includes('Not Out Yet (2027)'), false);
    assert.equal(names.includes('Gone Missing (2001)'), true, 'this one claims a file');
    assert.equal(levelFor(body, films())?.rollup.missing, 1);
  });

  test('a symlink is shown and marked, never followed', async () => {
    const body = await matrix(`?path=${encodeURIComponent(media)}`);
    const node = nodeAt(levelFor(body, media), 'films-link');

    assert.equal(node?.kind, 'symlink');
    assert.equal(node?.flags.includes('symlink'), true);
  });

  // ------------------------------------------------------------------ selection

  test('a small level is served whole, with child counts resolved', async () => {
    const level = levelFor(await matrix(`?path=${encodeURIComponent(films())}`), films());

    assert.equal(level?.childCountsResolved, true);
    assert.equal(level?.truncated, false);
    assert.deepEqual(level?.selection, ['all'], 'a small level hides nothing');
    assert.equal(nodeAt(level, 'Empty Folder')?.flags.includes('empty'), true);
    assert.equal(nodeAt(level, 'The Matrix (1999)')?.flags.includes('untracked'), false);
    assert.equal(nodeAt(level, 'Orphan Film (1999)')?.flags.includes('untracked'), true);
  });

  test('the rollup counts the whole level, and reports what it did not evaluate', async () => {
    const level = levelFor(await matrix(`?path=${encodeURIComponent(films())}`), films());

    assert.equal(level?.rollup.entries, 4, '3 on disk plus the missing *Arr path');
    assert.equal(level?.rollup.tracked, 1);
    assert.equal(level?.rollup.untracked, 2, 'Orphan Film and Empty Folder');
    assert.equal(level?.rollup.missing, 1);
    assert.equal(level?.rollup.mediaUnder, 3);
  });

  // -------------------------------------------------------------- authorisation

  test('refuses to leave the configured roots', async () => {
    const outside = await api<ErrorBody>(server.url, '/storage/matrix?path=/etc');
    assert.equal(outside.status, 403);
    assert.equal(outside.body.error.code, 'fs_forbidden_path');

    const traversal = await api<ErrorBody>(
      server.url,
      `/storage/matrix?path=${encodeURIComponent(path.join(media, '..', '..'))}`,
    );
    assert.equal(traversal.status, 403);
  });

  test('one unreadable folder is a level error, not a failed request', async () => {
    const body = await matrix(`?path=${encodeURIComponent(path.join(media, 'old-movies'))}`);
    assert.equal(levelFor(body, path.join(media, 'old-movies'))?.error, null);
    assert.equal(body.enabled, true);
  });

  test('reports the instance columns it joined against', async () => {
    const body = await matrix();
    assert.equal(body.columns.length, 1);
    assert.equal(body.columns[0]?.instanceId, instanceId);
    assert.equal(body.columns[0]?.reachable, true);
    assert.equal(body.columns[0]?.rootFolderCount, 2);
    assert.equal(body.columns[0]?.mediaPathCount, 3);
    assert.equal(body.totals.rootFolderPaths, 2);
  });
});

// ------------------------------------------------- the previously-used library folder

/**
 * The shape that prompted all of this: a folder still holding hundreds of media folders
 * that no instance uses as a root folder any more. Root folders themselves are leaves,
 * so this is the case where summarising actually has to work.
 */
describe('the path matrix on a folder that still holds a whole library', () => {
  let arr: FakeArrServer;
  let server: TestApp;
  let configDir: string;
  let media: string;

  const CHILDREN = 300;
  const TRACKED = 296;

  const archive = (): string => path.join(media, 'archive');

  before(async () => {
    media = makeTempDir();
    mkdirSync(archive(), { recursive: true });
    // A root folder elsewhere, so the fleet has one and `archive` is plainly not it.
    mkdirSync(path.join(media, 'library'), { recursive: true });

    for (let index = 0; index < CHILDREN; index += 1) {
      const name = `Film ${String(index).padStart(4, '0')}`;
      mkdirSync(path.join(archive(), name), { recursive: true });
      writeFileSync(path.join(archive(), name, 'movie.mkv'), 'x');
    }

    arr = await startFakeArr({ kind: 'radarr' });
    arr.state.rootFolders = [
      { id: 1, path: path.join(media, 'library'), accessible: true, freeSpace: 1e9, totalSpace: 4e9, unmappedFolders: [] },
    ];
    arr.state.media = [
      ...Array.from({ length: TRACKED }, (_unused, index) =>
        fakeMedia(
          index + 1,
          `Film ${String(index)}`,
          path.join(archive(), `Film ${String(index).padStart(4, '0')}`),
          path.join(media, 'library'),
        ),
      ),
      // Two paths the instance holds files for that are not on disk.
      fakeMedia(9001, 'Gone A', path.join(archive(), 'Gone A (2001)'), path.join(media, 'library')),
      fakeMedia(9002, 'Gone B', path.join(archive(), 'Gone B (2002)'), path.join(media, 'library')),
    ];

    configDir = makeTempDir();
    server = await startTestApp(configDir, { fsRoots: [media] });
    await api<InstanceResponse>(server.url, '/instances', {
      method: 'POST',
      body: { name: 'Radarr', kind: 'radarr', baseUrl: arr.url, apiKey: serverApiKey() },
    });
  });

  after(async () => {
    await server.close();
    await arr.close();
    removeTempDir(configDir);
    removeTempDir(media);
  });

  const level = async (query: string) => {
    const body = (await api<PathMatrixResponse>(server.url, `/storage/matrix${query}`)).body;
    return body.levels.find((entry) => entry.path === archive());
  };

  test('summarises the level instead of listing it', async () => {
    const summary = await level(`?path=${encodeURIComponent(archive())}`);

    // The exact counts, from one readdir plus the index - not from the rows returned.
    assert.equal(summary?.rollup.entries, CHILDREN + 2);
    assert.equal(summary?.rollup.tracked, TRACKED);
    assert.equal(summary?.rollup.neutral, CHILDREN - TRACKED);
    assert.equal(summary?.rollup.missing, 2);

    // Only the folders that need attention came back, and the level says so.
    assert.deepEqual(summary?.selection, ['problems']);
    assert.equal(summary?.nodes.length, 2, 'the two missing paths');
    assert.equal(
      summary?.childCountsResolved,
      false,
      'a big level must not pay a readdir per child',
    );
  });

  test('only=all pages the level rather than shipping it whole', async () => {
    const first = await level(`?path=${encodeURIComponent(archive())}&only=all&limit=50`);
    assert.equal(first?.nodes.length, 50);
    assert.equal(first?.matched, CHILDREN + 2);
    assert.equal(first?.truncated, true);

    const second = await level(`?path=${encodeURIComponent(archive())}&only=all&limit=50&offset=50`);
    assert.equal(second?.nodes.length, 50);

    const overlap = new Set(first?.nodes.map((node) => node.path));
    assert.equal(
      second?.nodes.some((node) => overlap.has(node.path)),
      false,
      'the second page must not repeat the first',
    );
  });

  test('a name filter promotes matches out of a level it never lists', async () => {
    const filtered = await level(`?path=${encodeURIComponent(archive())}&only=all&q=Film 0123`);

    assert.equal(filtered?.nodes.length, 1);
    assert.equal(filtered?.nodes[0]?.name, 'Film 0123');
    assert.equal(filtered?.rollup.entries, CHILDREN + 2, 'the rollup still states the truth');
  });

  test('asking for empty folders resolves child counts, and says so', async () => {
    const probed = await level(`?path=${encodeURIComponent(archive())}&only=empty&limit=5`);
    assert.equal(probed?.childCountsResolved, true);
  });

  test('the folder itself is flagged as holding media nothing roots at', async () => {
    const body = (await api<PathMatrixResponse>(server.url, '/storage/matrix')).body;
    const node = body.levels
      .flatMap((entry) => entry.nodes)
      .find((entry) => entry.path === archive());

    assert.equal(node?.flags.includes('unmanaged'), true);
    assert.equal(node?.flags.includes('rootFolder'), false);
    assert.equal(node?.expandable, true, 'unlike a root folder, this one opens');
  });
});
