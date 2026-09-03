import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  ArrRootFolder,
  MappingMismatch,
  PathFlag,
  PathInstanceCell,
  PathMatrixColumn,
  PathMatrixLevel,
  PathMatrixResponse,
  PathMatrixTotals,
  PathNode,
  PathNodeKind,
  PathNodeOrigin,
  PathRole,
  PathRollup,
  PathSelector,
} from '@arrranger/shared';
import type { FilesystemService } from '../fs/filesystem.service.js';
import { ACCESS_READ, ACCESS_WRITE, canAccess, describePath } from '../fs/paths.js';
import {
  isAtOrUnder,
  normalisePath,
  parentPath,
  type InstancePathIndex,
  type PathIndexService,
} from './path-index.service.js';

export interface PathMatrixServiceDeps {
  readonly index: PathIndexService;
  readonly filesystem: FilesystemService;
}

export interface PathMatrixQuery {
  /** Directories to expand. Empty means "the spine": mounts down to each root folder. */
  readonly paths?: readonly string[];
  readonly only?: readonly PathSelector[];
  readonly filter?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly sort?: 'name' | 'interesting' | 'modified';
  readonly refresh?: boolean;
}

export const DEFAULT_LIMIT = 200;

/**
 * At or below this, a level is served whole with a readdir per child - which is what
 * today's explorer costs, and covers any hand-curated folder (movies, tv, downloads).
 * Above it, the level defaults to problems-only so a library is summarised, not listed.
 */
export const FULL_LEVEL_ENTRIES = 64;

/** What a level knows about one child before anything is stat'd. */
interface Candidate {
  readonly path: string;
  readonly name: string;
  readonly origin: PathNodeOrigin;
  readonly kind: PathNodeKind;
  readonly exists: boolean;
  readonly inScope: boolean;
  /** Media at or under it, summed across reachable instances. */
  readonly mediaUnder: number;
  /** Only known once a node has been probed; null before that. */
  readonly childCountHint: number | null;
  readonly isRootFolder: boolean;
  readonly insideRootFolder: boolean;
  readonly containsRootFolder: boolean;
}

/**
 * Joins disk truth to *Arr truth, one directory level at a time.
 *
 * The rule that makes this affordable: `only`, `filter` and `limit` are applied BEFORE
 * any per-child stat. Selecting from the dirent list plus the index costs one readdir,
 * so an 812-entry library is summarised for the price of one syscall and only the
 * handful of rows actually returned are ever probed.
 */
export class PathMatrixService {
  constructor(private readonly deps: PathMatrixServiceDeps) {}

  async matrix(query: PathMatrixQuery = {}): Promise<PathMatrixResponse> {
    const rootsResponse = this.deps.filesystem.roots();
    const indexes = await this.deps.index.index({ refresh: query.refresh === true });
    const scannedAt = new Date().toISOString();

    if (!rootsResponse.enabled) {
      return {
        enabled: false,
        scannedAt,
        roots: rootsResponse.roots,
        columns: this.columns(indexes),
        levels: [],
        totals: emptyTotals(),
        mismatches: [],
      };
    }

    const requested = (query.paths ?? []).map((entry) => normalisePath(entry));
    const targets = requested.length > 0 ? requested : this.spine(indexes);

    const levels = await Promise.all(
      targets.map((target) => this.level(target, indexes, query)),
    );

    // The synthetic top level carries the mounts and the paths this container cannot
    // see, so an unmapped root folder is a row rather than a footnote.
    const topLevel = requested.length > 0 ? null : await this.topLevel(indexes, query);

    return {
      enabled: true,
      scannedAt,
      roots: rootsResponse.roots,
      columns: this.columns(indexes),
      levels: topLevel === null ? levels : [topLevel, ...levels],
      totals: this.totals(indexes, [...(topLevel === null ? [] : [topLevel]), ...levels]),
      mismatches: this.mismatches(indexes),
    };
  }

  // ------------------------------------------------------------------ one level

  private async level(
    target: string,
    indexes: readonly InstancePathIndex[],
    query: PathMatrixQuery,
  ): Promise<PathMatrixLevel> {
    const resolved = await this.deps.filesystem.guard.resolve(target);
    let candidates: Candidate[];
    let error: string | null = null;

    if (isRootFolderPath(resolved, indexes)) {
      // Expansion stops at a root folder. Below it is the library - hundreds of media
      // folders this view does not manage - and reading them is the expensive part.
      candidates = [];
    } else {
      try {
        candidates = await this.candidatesOf(resolved, indexes);
      } catch (caught) {
        candidates = [];
        error = caught instanceof Error ? caught.message : 'Could not read this directory';
      }
    }

    return this.assemble(resolved, candidates, indexes, query, { error });
  }

  /** The mounts, plus every *Arr root folder this container cannot see. */
  private async topLevel(
    indexes: readonly InstancePathIndex[],
    query: PathMatrixQuery,
  ): Promise<PathMatrixLevel> {
    const mounts = this.deps.filesystem.roots().roots.map((root) => root.path);
    const unseen = this.unseenRootFolders(indexes);

    const candidates: Candidate[] = [
      ...mounts.map((mount) => this.classify(mount, indexes, {
        origin: 'disk',
        kind: 'directory',
        exists: true,
        inScope: true,
      })),
      ...unseen.map((folder) => this.classify(folder, indexes, {
        origin: 'arr',
        kind: 'directory',
        exists: false,
        inScope: false,
      })),
    ];

    return this.assemble(null, candidates, indexes, query, { error: null });
  }

  private async assemble(
    levelPath: string | null,
    candidates: readonly Candidate[],
    indexes: readonly InstancePathIndex[],
    query: PathMatrixQuery,
    context: { error: string | null },
  ): Promise<PathMatrixLevel> {
    // "Sits alongside a root folder" is a fact about the level, not the child, so it is
    // established once here and threaded through selection, flags and the rollup alike.
    const scope = { levelHasRootFolder: candidates.some((entry) => entry.isRootFolder) };
    const rollup = rollupOf(candidates, indexes, levelPath, scope);

    // Small levels behave exactly like the old explorer: everything, fully probed.
    const small = candidates.length <= FULL_LEVEL_ENTRIES;
    const selectors = query.only ?? (small ? ['all'] : ['problems']);
    const wantsProbe = small || selectors.some((s) => s === 'empty' || s === 'unreadable');

    const filter = query.filter?.trim().toLowerCase() ?? '';
    // do not reorder: selecting before probing is the whole performance story.
    const matched = candidates.filter((candidate) => {
      if (filter.length > 0 && !candidate.name.toLowerCase().includes(filter)) return false;
      return selectors.some((selector) => matchesSelector(candidate, selector, scope));
    });

    const sorted = sortCandidates(matched, query.sort ?? 'name');
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.min(1000, Math.max(1, query.limit ?? DEFAULT_LIMIT));
    const page = sorted.slice(offset, offset + limit);

    const nodes = await Promise.all(
      page.map((candidate) => this.enrich(candidate, indexes, { probe: wantsProbe, ...scope })),
    );

    return {
      path: levelPath,
      parent: levelPath === null ? null : this.parentInScope(levelPath),
      nodes,
      rollup,
      selection: selectors,
      matched: matched.length,
      offset,
      limit,
      truncated: matched.length > offset + nodes.length,
      childCountsResolved: wantsProbe,
      error: context.error,
    };
  }

  // -------------------------------------------------------------- candidates

  /** One readdir, plus the *Arr children the index already knows about. */
  private async candidatesOf(
    target: string,
    indexes: readonly InstancePathIndex[],
  ): Promise<Candidate[]> {
    const dirents = await readdir(target, { withFileTypes: true });
    const seen = new Set<string>();
    const candidates: Candidate[] = [];

    for (const dirent of dirents) {
      const child = path.join(target, dirent.name);
      seen.add(child);
      candidates.push(
        this.classify(child, indexes, {
          origin: 'disk',
          kind: kindOf(dirent),
          exists: true,
          inScope: true,
        }),
      );
    }

    // *Arr paths that should be here and are not - shown in tree position, at any depth.
    //
    // Only paths an instance holds *files* for count. A monitored film nobody has
    // downloaded yet has a path that is meant not to exist; surfacing those would bury
    // the real signal under every unreleased title in the library.
    for (const index of indexes) {
      if (!index.reachable) continue;
      for (const child of index.childrenByParent.get(normalisePath(target)) ?? []) {
        if (seen.has(child)) continue;
        if (index.mediaAt.has(child) && !index.mediaWithFiles.has(child)) continue;
        seen.add(child);
        candidates.push(
          this.classify(child, indexes, {
            origin: 'arr',
            kind: 'directory',
            exists: false,
            inScope: true,
          }),
        );
      }
    }

    return candidates;
  }

  /** Everything derivable from the index alone - no syscall. */
  private classify(
    target: string,
    indexes: readonly InstancePathIndex[],
    facts: { origin: PathNodeOrigin; kind: PathNodeKind; exists: boolean; inScope: boolean },
  ): Candidate {
    const normalised = normalisePath(target);
    const reachable = indexes.filter((index) => index.reachable);

    const rootFolderOn = reachable.filter((index) => index.rootFolders.has(normalised));
    const mediaUnder = reachable.reduce(
      (sum, index) => sum + (index.mediaUnder.get(normalised) ?? 0),
      0,
    );


    const knownToArr =
      rootFolderOn.length > 0 || reachable.some((index) => index.mediaAt.has(normalised));

    return {
      path: normalised,
      name: path.basename(normalised) || normalised,
      origin: facts.exists ? (knownToArr ? 'both' : 'disk') : 'arr',
      kind: facts.kind,
      exists: facts.exists,
      inScope: facts.inScope,
      mediaUnder,
      childCountHint: null,
      isRootFolder: rootFolderOn.length > 0,
      insideRootFolder: reachable.some((index) =>
        index.rootFolderPrefixes.some(
          (prefix) => prefix !== normalised && isAtOrUnder(normalised, prefix),
        ),
      ),
      containsRootFolder: reachable.some((index) =>
        index.rootFolderPrefixes.some(
          (prefix) => prefix !== normalised && isAtOrUnder(prefix, normalised),
        ),
      ),
    };
  }

  // ---------------------------------------------------------------- enrichment

  /** The only place a per-child syscall happens, and only for rows being returned. */
  private async enrich(
    candidate: Candidate,
    indexes: readonly InstancePathIndex[],
    options: { probe: boolean; levelHasRootFolder: boolean },
  ): Promise<PathNode> {
    const base = this.baseNode(candidate, indexes, options);
    if (!candidate.exists || !candidate.inScope || !options.probe) return base;

    // Counting a root folder's children means reading a directory with hundreds of media
    // folders in it, and the answer is now unusable: a root folder never expands. The
    // instances already report how many items they track under it, for free.
    const countable = candidate.kind === 'directory' && !candidate.isRootFolder;

    const [stats, readable, writable, childCount] = await Promise.all([
      describePath(candidate.path),
      canAccess(candidate.path, ACCESS_READ),
      canAccess(candidate.path, ACCESS_WRITE),
      countable ? countChildren(candidate.path) : Promise.resolve(null),
    ]);

    const measurement = this.deps.filesystem.cachedMeasurement(candidate.path);

    return {
      ...base,
      exists: stats.exists,
      modifiedAt: stats.modifiedAt,
      childCount,
      readable,
      writable,
      deviceId: stats.deviceId,
      sizeOnDisk: measurement?.sizeOnDisk ?? (candidate.kind === 'file' ? stats.size : null),
      flags: this.flagsFor(candidate, { childCount, readable, writable }, options),
      expandable: expandableOf(candidate, childCount),
    };
  }

  private baseNode(
    candidate: Candidate,
    indexes: readonly InstancePathIndex[],
    scope: { levelHasRootFolder: boolean },
  ): PathNode {
    const isMount = this.deps.filesystem.guard.isRoot(candidate.path);

    return {
      path: candidate.path,
      name: candidate.name,
      origin: candidate.origin,
      exists: candidate.exists,
      kind: candidate.kind,
      inScope: candidate.inScope,
      modifiedAt: null,
      childCount: null,
      readable: candidate.exists,
      writable: false,
      deviceId: null,
      freeSpace: isMount ? this.mountFacts(candidate.path)?.freeSpace ?? null : null,
      totalSpace: isMount ? this.mountFacts(candidate.path)?.totalSpace ?? null : null,
      sizeOnDisk: this.deps.filesystem.cachedMeasurement(candidate.path)?.sizeOnDisk ?? null,
      error: null,
      cells: this.cellsFor(candidate, indexes),
      flags: this.flagsFor(candidate, { childCount: null, readable: true, writable: true }, scope),
      rollup: null,
      expandable: expandableOf(candidate, candidate.childCountHint),
    };
  }

  private mountFacts(target: string): { freeSpace: number | null; totalSpace: number | null } | null {
    return this.deps.filesystem.roots().roots.find((root) => root.path === target) ?? null;
  }

  // --------------------------------------------------------------------- cells

  private cellsFor(
    candidate: Candidate,
    indexes: readonly InstancePathIndex[],
  ): readonly PathInstanceCell[] {
    return indexes.map((index): PathInstanceCell => {
      if (!index.reachable) {
        return {
          instanceId: index.instanceId,
          known: false,
          role: 'unknown',
          rootFolderId: null,
          accessible: null,
          freeSpace: null,
          totalSpace: null,
          mediaUnder: 0,
          title: null,
        };
      }

      const folder: ArrRootFolder | undefined = index.rootFolders.get(candidate.path);
      const mediaUnder = index.mediaUnder.get(candidate.path) ?? 0;
      const title = index.mediaAt.get(candidate.path) ?? null;

      return {
        instanceId: index.instanceId,
        known: true,
        role: roleFor(index, candidate.path, folder !== undefined, title !== null, mediaUnder),
        rootFolderId: folder?.id ?? null,
        accessible: folder?.accessible ?? null,
        freeSpace: folder?.freeSpace ?? null,
        totalSpace: folder?.totalSpace ?? null,
        mediaUnder,
        title,
      };
    });
  }

  // --------------------------------------------------------------------- flags

  private flagsFor(
    candidate: Candidate,
    probe: { childCount: number | null; readable: boolean; writable: boolean },
    scope: { levelHasRootFolder: boolean },
  ): readonly PathFlag[] {
    const flags: PathFlag[] = [];

    if (this.deps.filesystem.guard.isRoot(candidate.path)) flags.push('mount');
    if (candidate.isRootFolder) flags.push('rootFolder');

    if (!candidate.inScope) flags.push('unseen');
    else if (!candidate.exists) flags.push('missing');

    if (candidate.exists && candidate.inScope && candidate.kind !== 'file') {
      if (isCandidate(candidate, scope.levelHasRootFolder)) flags.push('candidate');
      if (!candidate.isRootFolder && candidate.insideRootFolder && candidate.mediaUnder === 0) {
        flags.push('untracked');
      }
      // Media under here is managed if any root folder sits at, above, or below this
      // path; only a folder unrelated to every root folder is genuinely unmanaged.
      if (
        candidate.mediaUnder > 0 &&
        !candidate.isRootFolder &&
        !candidate.insideRootFolder &&
        !candidate.containsRootFolder
      ) {
        flags.push('unmanaged');
      }
      if (probe.childCount === 0) flags.push('empty');
      if (!probe.readable) flags.push('unreadable');
      else if (!probe.writable) flags.push('readOnly');
    }

    if (candidate.kind === 'symlink') flags.push('symlink');

    return flags;
  }

  // ------------------------------------------------------------------ overview

  /** Mounts, plus the directory chain down to each root folder inside them. */
  private spine(indexes: readonly InstancePathIndex[]): string[] {
    const guard = this.deps.filesystem.guard;
    const mounts = this.deps.filesystem.rootPaths;
    const spine = new Set(mounts);
    const rootFolders = new Set(this.rootFolderPaths(indexes));

    for (const folder of rootFolders) {
      if (guard.rootFor(folder) === null) continue;
      // Every strict ancestor between the mount and the root folder, so the tree connects.
      let current = parentPath(folder);
      while (current !== null && guard.rootFor(current) !== null) {
        spine.add(current);
        current = parentPath(current);
      }
    }

    // A root folder is where expansion stops: below it lies the library.
    return [...spine].filter((entry) => !rootFolders.has(entry)).sort();
  }

  private rootFolderPaths(indexes: readonly InstancePathIndex[]): string[] {
    const paths = new Set<string>();
    for (const index of indexes) {
      if (!index.reachable) continue;
      for (const folder of index.rootFolders.keys()) paths.add(folder);
    }
    return [...paths];
  }

  private unseenRootFolders(indexes: readonly InstancePathIndex[]): string[] {
    return this.rootFolderPaths(indexes)
      .filter((folder) => this.deps.filesystem.guard.rootFor(folder) === null)
      .sort();
  }

  private parentInScope(target: string): string | null {
    if (this.deps.filesystem.guard.isRoot(target)) return null;
    const parent = parentPath(target);
    return parent !== null && this.deps.filesystem.guard.rootFor(parent) !== null ? parent : null;
  }

  private columns(indexes: readonly InstancePathIndex[]): readonly PathMatrixColumn[] {
    const guard = this.deps.filesystem.guard;
    return indexes.map((index) => ({
      instanceId: index.instanceId,
      name: index.name,
      kind: index.kind,
      reachable: index.reachable,
      error: index.error,
      fetchedAt: index.fetchedAt,
      rootFolderCount: index.rootFolders.size,
      mediaPathCount: index.mediaAt.size,
      unseenRootFolders: [...index.rootFolders.keys()]
        .filter((folder) => guard.enabled && guard.rootFor(folder) === null)
        .sort(),
    }));
  }

  /**
   * An instance none of whose paths exist here has a volume mapping difference, not
   * missing media. Reported as such, exactly as the reconcile report did.
   */
  private mismatches(indexes: readonly InstancePathIndex[]): readonly MappingMismatch[] {
    const guard = this.deps.filesystem.guard;
    const checkedRoots = this.deps.filesystem.rootPaths;

    return indexes
      .filter((index) => {
        if (!index.reachable || index.mediaAt.size === 0) return false;
        return [...index.rootFolders.keys()].every((folder) => guard.rootFor(folder) === null);
      })
      .map((index) => ({
        instanceId: index.instanceId,
        reportedPaths: [...index.rootFolders.keys()].sort(),
        checkedRoots,
        mediaPathCount: index.mediaAt.size,
      }));
  }

  private totals(
    indexes: readonly InstancePathIndex[],
    levels: readonly PathMatrixLevel[],
  ): PathMatrixTotals {
    const reachable = indexes.filter((index) => index.reachable);
    const rootFolders = this.rootFolderPaths(indexes);

    // Summed from the levels actually read: honest about being a view, not a full walk.
    const sum = (pick: (rollup: PathRollup) => number): number =>
      levels.reduce((total, level) => total + pick(level.rollup), 0);

    // Exact and free: a media path that sits under none of its own instance's root
    // folders is unmanaged whatever the disk looks like. Counted as distinct paths.
    const unmanaged = new Set<string>();
    for (const index of reachable) {
      for (const mediaPath of index.mediaAt.keys()) {
        const rooted = index.rootFolderPrefixes.some((prefix) => isAtOrUnder(mediaPath, prefix));
        if (!rooted) unmanaged.add(mediaPath);
      }
    }

    return {
      rootFolderPaths: rootFolders.length,
      unseenRootFolders: this.unseenRootFolders(indexes).length,
      untracked: sum((rollup) => rollup.untracked),
      missing: sum((rollup) => rollup.missing),
      unmanaged: unmanaged.size,
      candidates: sum((rollup) => rollup.candidates),
    };
  }
}

// ----------------------------------------------------------------- pure helpers

/**
 * A root folder is a leaf. Its children are media folders, which this view neither
 * manages nor wants to pay a readdir for.
 */
function expandableOf(candidate: Candidate, childCount: number | null): boolean {
  if (candidate.kind !== 'directory' || !candidate.exists || !candidate.inScope) return false;
  if (candidate.isRootFolder) return false;
  return childCount !== 0;
}

function isRootFolderPath(target: string, indexes: readonly InstancePathIndex[]): boolean {
  const normalised = normalisePath(target);
  return indexes.some((index) => index.reachable && index.rootFolders.has(normalised));
}

function kindOf(dirent: { isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }): PathNodeKind {
  if (dirent.isSymbolicLink()) return 'symlink';
  if (dirent.isDirectory()) return 'directory';
  if (dirent.isFile()) return 'file';
  return 'other';
}

async function countChildren(target: string): Promise<number | null> {
  try {
    return (await readdir(target)).length;
  } catch {
    return null;
  }
}

/** Role precedence: rootFolder > tracked > ancestor > inside > outside. */
function roleFor(
  index: InstancePathIndex,
  target: string,
  isRootFolder: boolean,
  isTracked: boolean,
  mediaUnder: number,
): PathRole {
  if (isRootFolder) return 'rootFolder';
  if (isTracked) return 'tracked';
  if (mediaUnder > 0) return 'ancestor';
  if (index.rootFolderPrefixes.some((prefix) => prefix !== target && isAtOrUnder(target, prefix))) {
    return 'inside';
  }
  return 'outside';
}

/** A directory sitting alongside root folders that is not one - the headline signal. */
function isCandidate(candidate: Candidate, levelHasRootFolder: boolean): boolean {
  return (
    candidate.exists &&
    candidate.inScope &&
    candidate.kind === 'directory' &&
    !candidate.isRootFolder &&
    !candidate.insideRootFolder &&
    levelHasRootFolder
  );
}

function rollupOf(
  candidates: readonly Candidate[],
  indexes: readonly InstancePathIndex[],
  levelPath: string | null,
  scope: { levelHasRootFolder: boolean },
): PathRollup {
  const folders = candidates.filter((candidate) => candidate.kind !== 'file');

  const mediaUnder =
    levelPath === null
      ? candidates.reduce((sum, candidate) => sum + candidate.mediaUnder, 0)
      : indexes
          .filter((index) => index.reachable)
          .reduce((sum, index) => sum + (index.mediaUnder.get(levelPath) ?? 0), 0);

  // tracked/untracked/neutral describe what is *on disk*; a path an instance believes in
  // that is not there is counted once, as missing, and never as tracked.
  const onDisk = folders.filter((candidate) => candidate.exists);

  return {
    entries: candidates.length,
    tracked: onDisk.filter((candidate) => candidate.mediaUnder > 0).length,
    untracked: onDisk.filter(
      (candidate) =>
        candidate.mediaUnder === 0 && candidate.insideRootFolder && !candidate.isRootFolder,
    ).length,
    neutral: onDisk.filter(
      (candidate) =>
        candidate.mediaUnder === 0 && !candidate.insideRootFolder && !candidate.isRootFolder,
    ).length,
    missing: candidates.filter((candidate) => !candidate.exists && candidate.inScope).length,
    rootFolders: candidates.filter((candidate) => candidate.isRootFolder).length,

    candidates: folders.filter((candidate) => isCandidate(candidate, scope.levelHasRootFolder))
      .length,
    symlinks: candidates.filter((candidate) => candidate.kind === 'symlink').length,
    empty: null,
    unreadable: null,
    mediaUnder,
  };
}

function matchesSelector(
  candidate: Candidate,
  selector: PathSelector,
  scope: { levelHasRootFolder: boolean },
): boolean {
  switch (selector) {
    case 'all':
      return true;
    case 'problems':
      return (
        (!candidate.exists && candidate.inScope) ||
        !candidate.inScope ||
        candidate.kind === 'symlink' ||
        (candidate.exists && candidate.insideRootFolder && candidate.mediaUnder === 0 && !candidate.isRootFolder)
      );
    case 'rootFolders':
      return candidate.isRootFolder;
    case 'candidates':
      return isCandidate(candidate, scope.levelHasRootFolder);
    case 'tracked':
      return candidate.mediaUnder > 0;
    case 'untracked':
      return candidate.exists && candidate.mediaUnder === 0 && candidate.insideRootFolder;
    case 'missing':
      return !candidate.exists;
    case 'symlinks':
      return candidate.kind === 'symlink';
    // Not free: these need a readdir/access per child, so the level probes first and
    // the caller is told through `childCountsResolved`.
    case 'empty':
    case 'unreadable':
      return true;
  }
}

/** Directories first, then the requested order - the explorer's habit, kept. */
function sortCandidates(
  candidates: readonly Candidate[],
  sort: 'name' | 'interesting' | 'modified',
): Candidate[] {
  const weight = (candidate: Candidate): number => {
    if (sort !== 'interesting') return 0;
    if (!candidate.exists) return 0;
    if (candidate.insideRootFolder && candidate.mediaUnder === 0) return 1;
    return 2;
  };

  return [...candidates].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    const byWeight = weight(a) - weight(b);
    if (byWeight !== 0) return byWeight;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });
}

function emptyTotals(): PathMatrixTotals {
  return {
    rootFolderPaths: 0,
    unseenRootFolders: 0,
    untracked: 0,
    missing: 0,
    unmanaged: 0,
    candidates: 0,
  };
}
