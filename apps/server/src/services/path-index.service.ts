import type { ArrRootFolder, InstanceKind } from '@arrranger/shared';
import type { InstancesRepository } from '../repositories/instances.repo.js';
import type { ResourcesService } from './resources.service.js';

export interface PathIndexServiceDeps {
  readonly instances: InstancesRepository;
  readonly resources: ResourcesService;
}

/**
 * One instance's paths, indexed for O(1) answers at any depth.
 *
 * `mediaUnder` is the piece that matters: a nested layout - root folder `/data/media`
 * with films at `/data/media/movies/Dune (2021)` - has to report `movies` as a folder
 * in use, not an orphan. Only a closure over every media path's ancestors can say that,
 * which is why this lives on the server: the browser would need the whole library.
 */
export interface InstancePathIndex {
  readonly instanceId: number;
  readonly name: string;
  readonly kind: InstanceKind;
  /** False when the instance did not answer: all of its cells are 'unknown'. */
  readonly reachable: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  /** Normalised path -> the folder, so a cell can carry id, accessible and free space. */
  readonly rootFolders: ReadonlyMap<string, ArrRootFolder>;
  /** Normalised media path -> title. */
  readonly mediaAt: ReadonlyMap<string, string>;
  /**
   * The subset of `mediaAt` the instance says it actually holds files for.
   *
   * A monitored film nobody has downloaded yet has a path that is *meant* not to exist,
   * so only these paths can honestly be called missing from disk.
   */
  readonly mediaWithFiles: ReadonlySet<string>;
  /** Path -> media items at or under it. Every ancestor of every media path is a key. */
  readonly mediaUnder: ReadonlyMap<string, number>;
  /** Parent -> child paths this instance believes in - media paths and root folders. */
  readonly childrenByParent: ReadonlyMap<string, ReadonlySet<string>>;
  /** Sorted, for the inside/outside test. */
  readonly rootFolderPrefixes: readonly string[];
}

/** The answer a safety guard gets, including whether it could be trusted. */
export interface PathReferences {
  readonly instanceIds: readonly number[];
  /** False when at least one enabled instance had nothing cached to check against. */
  readonly complete: boolean;
}

const CACHE_MS = 30_000;

/**
 * A runaway guard, not a real limit: media paths are a handful of segments deep, so this
 * only ever trips on pathological input.
 */
const MAX_ANCESTOR_DEPTH = 64;

/** Trailing separators carry no meaning here and would break every path comparison. */
export function normalisePath(target: string): string {
  const trimmed = target.replace(/[/\\]+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
}

export function parentPath(target: string): string | null {
  const normalised = normalisePath(target);
  const index = normalised.lastIndexOf('/');
  if (index < 0) return null;
  if (index === 0) return normalised === '/' ? null : '/';
  return normalised.slice(0, index);
}

/**
 * True when `candidate` is `ancestor` or sits beneath it.
 *
 * Separator-aware on purpose. A bare `startsWith` makes `/data/movies` swallow
 * `/data/movies-4k`, which is the class of bug that moves the wrong media.
 */
export function isAtOrUnder(candidate: string, ancestor: string): boolean {
  const target = normalisePath(candidate);
  const root = normalisePath(ancestor);
  if (target === root) return true;
  return root === '/' ? target.startsWith('/') : target.startsWith(`${root}/`);
}

/**
 * Joins *Arr truth into indexes the matrix can query per directory level.
 *
 * Cached for 30 s over the snapshot cache underneath, so expanding a tree never fans
 * out into one *Arr request per level.
 */
export class PathIndexService {
  private cache: { indexes: readonly InstancePathIndex[]; at: number } | null = null;

  constructor(private readonly deps: PathIndexServiceDeps) {}

  async index(options: { refresh?: boolean } = {}): Promise<readonly InstancePathIndex[]> {
    if (options.refresh !== true && this.cache !== null && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.indexes;
    }

    const indexes = await this.build({ refresh: options.refresh === true });
    this.cache = { indexes, at: Date.now() };
    return indexes;
  }

  invalidate(): void {
    this.cache = null;
  }

  /**
   * Instances that still point at `target` or anything under it. Powers the delete and
   * relocation guards, so it reads cached snapshots *only*: a preflight that phoned an
   * *Arr instance could hang or fail for reasons that have nothing to do with the disk.
   *
   * `complete` is the price of that. An instance with nothing cached cannot be checked,
   * and "I could not tell" must never reach a destructive guard looking like "nothing
   * references it" - so the answer says which of the two it is.
   */
  referencedBy = async (
    target: string,
    options: { allowFetch?: boolean } = {},
  ): Promise<PathReferences> => {
    const enabled = this.deps.instances.list().filter((instance) => instance.enabled);
    const normalised = normalisePath(target);

    // `allowFetch` is chosen by how the answer is used, not by convenience. A delete
    // blocker needs the truth, so it may fetch and treats an unreachable instance as
    // unknown. A relocation only raises a hint, so it stays strictly cache-only and
    // never makes a staged rename wait on an *Arr instance.
    const indexes =
      options.allowFetch === true ? await this.index() : await this.build({ cacheOnly: true });

    const usable = indexes.filter((index) => index.reachable);

    return {
      instanceIds: usable
        .filter(
          (index) =>
            index.rootFolders.has(normalised) || (index.mediaUnder.get(normalised) ?? 0) > 0,
        )
        .map((index) => index.instanceId),
      complete: usable.length === enabled.length,
    };
  };

  private async build(
    options: { refresh?: boolean; cacheOnly?: boolean } = {},
  ): Promise<readonly InstancePathIndex[]> {
    const indexes: InstancePathIndex[] = [];

    for (const instance of this.deps.instances.list()) {
      if (!instance.enabled) continue;

      if (options.cacheOnly === true) {
        const media = this.deps.resources.peekMediaLibrary(instance.id);
        const rootFolders = this.deps.resources.peekRootFolders(instance.id);
        // A cache miss contributes nothing rather than becoming a request.
        if (media === null || rootFolders === null) continue;
        indexes.push(
          buildIndex(instance, rootFolders, media, { reachable: true, error: null, fetchedAt: null }),
        );
        continue;
      }

      try {
        const [library, rootFolders] = await Promise.all([
          this.deps.resources.mediaLibrary(instance.id, options.refresh === true),
          this.deps.resources.rootFolders(instance.id, options.refresh === true),
        ]);
        indexes.push(
          buildIndex(instance, rootFolders, library.items, {
            reachable: true,
            error: null,
            fetchedAt: library.fetchedAt,
          }),
        );
      } catch (caught) {
        // Unreachable is *unknown*, never "missing": the instance still gets a column,
        // and it contributes to no rollup, total or flag.
        indexes.push(
          buildIndex(instance, [], [], {
            reachable: false,
            error: caught instanceof Error ? caught.message : 'Instance did not answer',
            fetchedAt: null,
          }),
        );
      }
    }

    return indexes;
  }
}

function buildIndex(
  instance: { id: number; name: string; kind: InstanceKind },
  rootFolders: readonly ArrRootFolder[],
  media: readonly { path: string; title: string; hasFile?: boolean; sizeOnDisk?: number }[],
  status: { reachable: boolean; error: string | null; fetchedAt: string | null },
): InstancePathIndex {
  const rootFolderMap = new Map<string, ArrRootFolder>();
  const mediaAt = new Map<string, string>();
  const mediaWithFiles = new Set<string>();
  const mediaUnder = new Map<string, number>();
  const childrenByParent = new Map<string, Set<string>>();

  const remember = (child: string): void => {
    const parent = parentPath(child);
    if (parent === null) return;
    const known = childrenByParent.get(parent);
    if (known === undefined) childrenByParent.set(parent, new Set([child]));
    else known.add(child);
  };

  for (const folder of rootFolders) {
    if (folder.path.length === 0) continue;
    const normalised = normalisePath(folder.path);
    rootFolderMap.set(normalised, folder);
    remember(normalised);
  }

  for (const item of media) {
    if (item.path.length === 0) continue;
    const normalised = normalisePath(item.path);
    mediaAt.set(normalised, item.title);
    if (item.hasFile ?? (item.sizeOnDisk ?? 0) > 0) mediaWithFiles.add(normalised);
    remember(normalised);

    // The ancestor closure. One walk per media path credits the folder itself and every
    // directory above it, which is what makes rollups correct at any depth.
    let current: string | null = normalised;
    for (let depth = 0; current !== null && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
      mediaUnder.set(current, (mediaUnder.get(current) ?? 0) + 1);
      current = parentPath(current);
    }
  }

  return {
    instanceId: instance.id,
    name: instance.name,
    kind: instance.kind,
    reachable: status.reachable,
    error: status.error,
    fetchedAt: status.fetchedAt,
    rootFolders: rootFolderMap,
    mediaAt,
    mediaWithFiles,
    mediaUnder,
    childrenByParent,
    rootFolderPrefixes: [...rootFolderMap.keys()].sort(),
  };
}
