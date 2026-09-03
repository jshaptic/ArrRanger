import { access, lstat, realpath, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { FsError } from '../lib/errors.js';

/**
 * The security boundary for every filesystem operation.
 *
 * Nothing else in the server is allowed to turn user input into a path. `resolve()` is the
 * only entry point, and it rejects anything that lands outside the configured roots -
 * traversal, absolute escapes, and symlinks pointing out of a root alike.
 */

export interface ResolvedRoot {
  /** As configured in FS_ROOTS. */
  readonly configured: string;
  /** After realpath - what comparisons are made against. */
  readonly real: string;
  readonly exists: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly deviceId: string | null;
  readonly freeSpace: number | null;
  readonly totalSpace: number | null;
  readonly error: string | null;
}

export interface PathStats {
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymlink: boolean;
  readonly deviceId: string | null;
  readonly size: number;
  readonly modifiedAt: string | null;
}

async function canAccess(target: string, mode: number): Promise<boolean> {
  try {
    await access(target, mode);
    return true;
  } catch {
    return false;
  }
}

async function describeRoot(configured: string): Promise<ResolvedRoot> {
  const absolute = path.resolve(configured);
  const base: Omit<ResolvedRoot, 'error'> = {
    configured,
    real: absolute,
    exists: false,
    readable: false,
    writable: false,
    deviceId: null,
    freeSpace: null,
    totalSpace: null,
  };

  try {
    const real = await realpath(absolute);
    const stats = await stat(real);
    if (!stats.isDirectory()) {
      return { ...base, real, error: 'not a directory' };
    }

    const [readable, writable] = await Promise.all([
      canAccess(real, 4 /* R_OK */),
      canAccess(real, 2 /* W_OK */),
    ]);

    let freeSpace: number | null = null;
    let totalSpace: number | null = null;
    try {
      const fsStats = await statfs(real);
      freeSpace = Number(fsStats.bsize) * Number(fsStats.bavail);
      totalSpace = Number(fsStats.bsize) * Number(fsStats.blocks);
    } catch {
      // statfs is unavailable on some mounts; free space is informational.
    }

    return {
      ...base,
      real,
      exists: true,
      readable,
      writable,
      deviceId: String(stats.dev),
      freeSpace,
      totalSpace,
      error: null,
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : 'unreachable' };
  }
}

export class PathGuard {
  private constructor(readonly roots: readonly ResolvedRoot[]) {}

  /** FS_ROOTS is a colon-separated list, like PATH. Empty means the feature is off. */
  static async create(configured: readonly string[]): Promise<PathGuard> {
    return new PathGuard(await Promise.all(configured.map(describeRoot)));
  }

  get enabled(): boolean {
    return this.roots.length > 0;
  }

  private get usableRoots(): ResolvedRoot[] {
    return this.roots.filter((root) => root.exists);
  }

  assertEnabled(): void {
    if (!this.enabled) {
      throw new FsError({
        code: 'fs_disabled',
        message:
          'Filesystem operations are disabled: set FS_ROOTS and mount your media at the same path the *Arr containers use',
        httpStatus: 503,
      });
    }
    if (this.usableRoots.length === 0) {
      throw new FsError({
        code: 'fs_disabled',
        message: `None of the configured roots are reachable: ${this.roots
          .map((root) => `${root.configured} (${root.error ?? 'missing'})`)
          .join(', ')}`,
        httpStatus: 503,
      });
    }
  }

  /**
   * Resolves user input to a real absolute path inside an allowed root.
   *
   * The *parent chain* is resolved through realpath, so a symlink pointing out of a root
   * cannot be used as a door. The final component is deliberately left alone: if the user
   * names a symlink, callers must see a symlink - resolving it would mean a staged "move
   * this link" quietly moving the library it points at.
   */
  async resolve(input: string): Promise<string> {
    this.assertEnabled();

    const absolute = path.resolve(input);
    if (absolute.includes('\0')) {
      throw new FsError({ code: 'fs_forbidden_path', message: 'Path contains a null byte' });
    }

    const parent = path.dirname(absolute);
    const leaf = path.basename(absolute);
    const resolved =
      leaf.length === 0 || parent === absolute
        ? await this.realpathOf(absolute, input)
        : path.join(await this.realpathOf(parent, input), leaf);

    if (this.rootFor(resolved) === null) {
      throw new FsError({
        code: 'fs_forbidden_path',
        message: `${input} is outside the configured storage roots (${this.usableRoots
          .map((root) => root.real)
          .join(', ')})`,
        path: input,
        httpStatus: 403,
      });
    }

    return resolved;
  }

  /** realpath of the deepest existing part, with any missing tail re-appended. */
  private async realpathOf(target: string, original: string): Promise<string> {
    const { existing, tail } = await splitAtExisting(target);
    try {
      const real = await realpath(existing);
      return tail.length === 0 ? real : path.join(real, ...tail);
    } catch {
      throw new FsError({
        code: 'fs_forbidden_path',
        message: `Cannot resolve ${original}`,
        path: original,
      });
    }
  }

  /** The root containing `target`, or null when it is outside all of them. */
  rootFor(target: string): ResolvedRoot | null {
    return (
      this.usableRoots.find(
        (root) => target === root.real || target.startsWith(`${root.real}${path.sep}`),
      ) ?? null
    );
  }

  isRoot(target: string): boolean {
    return this.usableRoots.some((root) => root.real === target);
  }

  /** Refuses the root itself: emptying a whole mount is never a staged "folder" operation. */
  assertMutable(target: string): void {
    if (this.isRoot(target)) {
      throw new FsError({
        code: 'fs_forbidden_path',
        message: `${target} is a configured storage root and cannot be renamed, moved or deleted`,
        path: target,
        httpStatus: 403,
      });
    }
  }
}

/** Walks up until something exists, returning that prefix plus the missing tail. */
async function splitAtExisting(absolute: string): Promise<{ existing: string; tail: string[] }> {
  const tail: string[] = [];
  let current = absolute;

  for (;;) {
    try {
      await lstat(current);
      return { existing: current, tail: tail.reverse() };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return { existing: current, tail: tail.reverse() };
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

export async function describePath(target: string): Promise<PathStats> {
  try {
    const stats = await lstat(target);
    return {
      exists: true,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      isSymlink: stats.isSymbolicLink(),
      deviceId: String(stats.dev),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    };
  } catch {
    return {
      exists: false,
      isDirectory: false,
      isFile: false,
      isSymlink: false,
      deviceId: null,
      size: 0,
      modifiedAt: null,
    };
  }
}

/** True when `target` sits on a different filesystem than its parent. */
export async function isMountPoint(target: string): Promise<boolean> {
  const [here, parent] = await Promise.all([describePath(target), describePath(path.dirname(target))]);
  if (!here.exists || !parent.exists) return false;
  return here.deviceId !== parent.deviceId;
}

export interface FilesystemSpace {
  readonly freeSpace: number | null;
  readonly totalSpace: number | null;
}

/** Free and total space of the filesystem holding `target`. One statfs, both numbers. */
export async function statfsAt(target: string): Promise<FilesystemSpace> {
  try {
    const stats = await statfs(target);
    const blockSize = Number(stats.bsize);
    return {
      freeSpace: blockSize * Number(stats.bavail),
      totalSpace: blockSize * Number(stats.blocks),
    };
  } catch {
    return { freeSpace: null, totalSpace: null };
  }
}

export async function freeSpaceAt(target: string): Promise<number | null> {
  return (await statfsAt(target)).freeSpace;
}

export const ACCESS_READ = 4;
export const ACCESS_WRITE = 2;
export { canAccess };
