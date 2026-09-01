import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { FsError } from '../lib/errors.js';
import { describePath, isMountPoint, PathGuard } from './paths.js';

/**
 * The security boundary. Every case here is something a hostile or careless request could
 * try, so this file gets the widest coverage in the codebase.
 */
describe('PathGuard', () => {
  let root: string;
  let outside: string;
  let guard: PathGuard;

  before(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'arrranger-root-'));
    outside = mkdtempSync(path.join(tmpdir(), 'arrranger-outside-'));

    mkdirSync(path.join(root, 'movies', 'Arrival (2016)'), { recursive: true });
    writeFileSync(path.join(root, 'movies', 'Arrival (2016)', 'movie.mkv'), 'x');
    writeFileSync(path.join(outside, 'secret.txt'), 'do not touch');

    // A link inside the root pointing out of it: the classic escape hatch.
    symlinkSync(outside, path.join(root, 'escape-hatch'));

    guard = await PathGuard.create([root]);
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  test('resolves a path inside the root', async () => {
    const resolved = await guard.resolve(path.join(root, 'movies'));
    assert.equal(resolved, path.join(root, 'movies'));
  });

  test('resolves a path that does not exist yet, for mkdir and move destinations', async () => {
    const target = path.join(root, 'movies', 'New Film (2026)');
    assert.equal(await guard.resolve(target), target);
  });

  test('rejects traversal out of the root', async () => {
    await assert.rejects(
      () => guard.resolve(path.join(root, '..', '..', 'etc', 'passwd')),
      (error: unknown) => {
        assert.ok(error instanceof FsError);
        assert.equal(error.code, 'fs_forbidden_path');
        assert.equal(error.httpStatus, 403);
        return true;
      },
    );
  });

  test('rejects an absolute path outside every root', async () => {
    await assert.rejects(() => guard.resolve('/etc/passwd'), /outside the configured storage roots/);
    await assert.rejects(() => guard.resolve(outside), /outside the configured storage roots/);
  });

  test('rejects a path that reaches outside through a symlink', async () => {
    // The link itself lives inside the root, so a naive prefix check would allow this.
    await assert.rejects(
      () => guard.resolve(path.join(root, 'escape-hatch', 'secret.txt')),
      (error: unknown) => {
        assert.ok(error instanceof FsError);
        assert.equal(error.code, 'fs_forbidden_path');
        return true;
      },
    );
  });

  test('keeps a symlink leaf unresolved, so callers can refuse it', async () => {
    // Resolving the leaf would turn "move this link" into "move the library it points at".
    const link = path.join(root, 'movies-link');
    symlinkSync(path.join(root, 'movies'), link);
    try {
      assert.equal(await guard.resolve(link), link);
    } finally {
      rmSync(link, { force: true });
    }
  });

  test('rejects a null byte', async () => {
    await assert.rejects(() => guard.resolve(`${root}/movies\0.txt`), /null byte/);
  });

  test('refuses the root itself as a mutation target', () => {
    assert.throws(() => guard.assertMutable(root), /configured storage root/);
    assert.doesNotThrow(() => guard.assertMutable(path.join(root, 'movies')));
    assert.equal(guard.isRoot(root), true);
    assert.equal(guard.isRoot(path.join(root, 'movies')), false);
  });

  test('reports the containing root', () => {
    assert.equal(guard.rootFor(path.join(root, 'movies'))?.real, root);
    assert.equal(guard.rootFor('/var/log'), null);
  });

  test('is disabled when no roots are configured', async () => {
    const empty = await PathGuard.create([]);
    assert.equal(empty.enabled, false);
    await assert.rejects(() => empty.resolve('/anything'), (error: unknown) => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, 'fs_disabled');
      assert.equal(error.httpStatus, 503);
      return true;
    });
  });

  test('is disabled when the configured root does not exist', async () => {
    const missing = await PathGuard.create([path.join(tmpdir(), 'arrranger-does-not-exist')]);
    assert.equal(missing.enabled, true, 'configured but unusable');
    await assert.rejects(
      () => missing.resolve('/anything'),
      /None of the configured roots are reachable/,
    );
  });

  test('describes what a path is without following links', async () => {
    const file = await describePath(path.join(root, 'movies', 'Arrival (2016)', 'movie.mkv'));
    assert.equal(file.isFile, true);
    assert.equal(file.isDirectory, false);

    const link = await describePath(path.join(root, 'escape-hatch'));
    assert.equal(link.isSymlink, true);

    const gone = await describePath(path.join(root, 'nope'));
    assert.equal(gone.exists, false);
  });

  test('a plain directory is not a mount point', async () => {
    assert.equal(await isMountPoint(path.join(root, 'movies')), false);
  });
});
