import type { FsOp, QueuePayloadFor } from './queue.js';

/**
 * Contracts for storage inspection and staged disk work.
 *
 * ArrRanger only ever reports paths as the *container* sees them, which is the same path
 * the *Arr instances must see - see the Storage access section of the README.
 */

export interface FsRoot {
  /** Absolute path inside the container, e.g. /data. */
  readonly path: string;
  readonly exists: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
  /** Filesystem id; a move between two different devices cannot be a rename. */
  readonly deviceId: string | null;
  readonly freeSpace: number | null;
  readonly totalSpace: number | null;
  readonly error: string | null;
}

export interface FsRootsResponse {
  /** False when FS_ROOTS is unset: the whole filesystem feature is off. */
  readonly enabled: boolean;
  readonly roots: readonly FsRoot[];
}

export type FsEntryKind = 'directory' | 'file' | 'symlink' | 'other';

export interface FsEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: FsEntryKind;
  readonly modifiedAt: string | null;
  /** Immediate children; null when it could not be read. */
  readonly childCount: number | null;
  readonly sizeOnDisk: number | null;
  readonly fileCount: number | null;
  readonly readable: boolean;
  readonly writable: boolean;
}

export interface FsListResponse {
  readonly path: string;
  readonly parent: string | null;
  readonly entries: readonly FsEntry[];
}

export interface FsMeasurement {
  readonly path: string;
  readonly sizeOnDisk: number;
  readonly fileCount: number;
  readonly directoryCount: number;
  /** True when the walk hit its entry cap - the numbers are a lower bound. */
  readonly truncated: boolean;
}

export type FsCheckStatus = 'ok' | 'warning' | 'blocker';

export interface FsCheck {
  readonly id: string;
  readonly status: FsCheckStatus;
  readonly message: string;
}

/**
 * The answer to "what would happen if I ran this". Returned to the UI before staging and
 * re-run by the executor immediately before the operation, because the disk can change
 * between review and Apply All.
 */
export interface FsPreflight {
  readonly op: FsOp;
  readonly ok: boolean;
  readonly checks: readonly FsCheck[];
  readonly measurement: FsMeasurement | null;
  readonly freeSpace: number | null;
  /** Instances whose database references this path - deleting needs `force`. */
  readonly referencedBy: readonly number[];
}

export interface FsPreflightRequest<K extends FsOp = FsOp> {
  readonly op: K;
  readonly payload: QueuePayloadFor<K>;
}

/**
 * An instance whose paths do not exist in this container at all - almost always a volume
 * mapping difference rather than missing media.
 */
export interface MappingMismatch {
  readonly instanceId: number;
  readonly reportedPaths: readonly string[];
  readonly checkedRoots: readonly string[];
  readonly mediaPathCount: number;
}


// ------------------------------------------------------------- path matrix

/**
 * The joined view of storage: one row per folder, managed and monitored in its own right.
 *
 * A folder is essentially never reused by two instances - each roots at its own subtree -
 * so the instances that use one are a column (`owners`), not the axis.
 *
 * The join still happens on the server because only it holds every instance's whole media
 * path set - the web app could never answer "how many media items live under this
 * folder, on which instances" without downloading the fleet's entire library.
 */

/** How one instance uses one path, lowest precedence first. */
export const PATH_USES = [
  /** It has media strictly *under* this path - the folder's reason to exist. */
  'ancestor',
  /** It has a media item at exactly this path. */
  'tracked',
  /** It has a root folder at exactly this path. */
  'rootFolder',
] as const;
export type PathUse = (typeof PATH_USES)[number];

/**
 * One instance's claim on one path. Usually there is exactly one per row.
 *
 * An instance that uses a path in none of those ways is simply absent from `owners`. So is
 * one that did not answer - which is why `PathMatrixColumn.reachable` is load-bearing: the
 * view must say "1 instance did not answer" rather than let an empty Used-by cell read as
 * "nobody uses this". That is the same `unknown` is never `missing` invariant the fleet
 * matrices enforce with `cell.known`, moved from per cell to once per response.
 */
export interface PathOwner {
  readonly instanceId: number;
  /** Denormalised so a chip renders without joining against `columns`. */
  readonly name: string;
  readonly kind: 'radarr' | 'sonarr';
  readonly use: PathUse;
  /** Set when use === 'rootFolder' - needed to stage a delete or a re-map. */
  readonly rootFolderId: number | null;
  /** *Arr's own verdict on the mount. Null unless it reports a root folder here. */
  readonly accessible: boolean | null;
  /** Media items this instance tracks at or under this path. */
  readonly mediaUnder: number;
  /** Title of the media item at this exact path, when there is one. */
  readonly title: string | null;
}

/**
 * The worst thing known about a path, so a collapsed tree can show a glyph at a glance.
 *
 * Derived server-side from the same flags the badges come from, for the same reason: one
 * vocabulary, one place.
 */
export const PATH_SEVERITIES = ['ok', 'info', 'warn', 'error'] as const;
export type PathSeverity = (typeof PATH_SEVERITIES)[number];

export type PathNodeKind = 'directory' | 'file' | 'symlink' | 'other';

/** Found on disk, in an *Arr database, or both. */
export type PathNodeOrigin = 'disk' | 'arr' | 'both';

/** Row conclusions, computed server-side so the badge vocabulary cannot drift. */
export const PATH_FLAGS = [
  /** A configured FS_ROOTS mount: never renameable, moveable or deletable. */
  'mount',
  /** A root folder on at least one reachable instance. */
  'rootFolder',
  /**
   * A library-shaped folder - a sibling of a root folder, or one holding media - that
   * no instance uses as a root folder. The direct answer to "which folders are not
   * used as root folders".
   */
  'candidate',
  /** Inside someone's root folder, and nothing is tracked at or under it. */
  'untracked',
  /** Holds media, but sits under no root folder anywhere. */
  'unmanaged',
  /** An instance points here and the disk does not have it. */
  'missing',
  /** A root folder outside FS_ROOTS - a volume mapping difference, not missing media. */
  'unseen',
  /** No entries on disk. A null childCount means "not evaluated", not "empty". */
  'empty',
  /** Shown, never followed, never mutated. */
  'symlink',
  /** The container cannot read it - check PUID/PGID. */
  'unreadable',
  /** Readable but not writable: a staged move or rename here would fail. */
  'readOnly',
] as const;
export type PathFlag = (typeof PATH_FLAGS)[number];

/**
 * What is in a directory, one level down, without shipping its children. Exact even
 * when `nodes` is a subset, because it comes from the dirent list plus the index.
 *
 * `empty` and `unreadable` are null when the level was served without a readdir per
 * child. A null means "not evaluated" - the UI must say so, never render a zero.
 */
export interface PathRollup {
  /** Immediate entries: disk children plus *Arr children that are not on disk. */
  readonly entries: number;
  readonly tracked: number;
  readonly untracked: number;
  /** Children outside every instance's root folders - no instance has an opinion. */
  readonly neutral: number;
  /** Children an instance holds files for that are not on disk. A monitored-but-not-yet
   *  downloaded item is not counted: its path is meant not to exist. */
  readonly missing: number;
  readonly rootFolders: number;
  readonly candidates: number;
  readonly symlinks: number;
  readonly empty: number | null;
  readonly unreadable: number | null;
  /** Media items at or under this path, summed across reachable instances. */
  readonly mediaUnder: number;
  /**
   * The worst severity among this directory's entries, so a collapsed row can warn that
   * something inside needs attention.
   *
   * Derived from the dirent list plus the index only, exactly like the counts above, so
   * the problems that need a readdir or access check per child (`empty`, `unreadable`,
   * `readOnly`) are reflected only when the level reports `childCountsResolved`.
   */
  readonly severity: PathSeverity;
}

export interface PathNode {
  readonly path: string;
  readonly name: string;
  readonly origin: PathNodeOrigin;
  // ------------------------------------------------------------------ disk facts
  readonly exists: boolean;
  readonly kind: PathNodeKind;
  /** Inside FS_ROOTS at all. False for an *Arr path this container cannot see. */
  readonly inScope: boolean;
  readonly modifiedAt: string | null;
  /** Immediate children on disk. Null when not evaluated, unreadable, or not a dir. */
  readonly childCount: number | null;
  readonly readable: boolean;
  readonly writable: boolean;
  /** Filesystem id: a move between two different devices cannot be a rename. */
  readonly deviceId: string | null;
  /**
   * Free/total space of the filesystem this path is on.
   *
   * Resolved by device id, one statfs per distinct filesystem per request and seeded from
   * the FS_ROOTS mounts - so the common single-`/data`-volume layout costs no extra
   * syscalls at all. A row that was not probed inherits its containing mount's numbers.
   */
  readonly freeSpace: number | null;
  readonly totalSpace: number | null;
  /**
   * This path's filesystem is below the configured low-space threshold.
   *
   * Only ever set on a mount or a root folder: every row under one shares its filesystem,
   * so flagging them all would paint a whole library amber and say nothing actionable.
   */
  readonly lowSpace: boolean;
  /** File size, or a *previously measured* directory size. Never triggers a walk. */
  readonly sizeOnDisk: number | null;
  readonly error: string | null;
  // ---------------------------------------------------------------------- the join
  /** Instances that use this exact path, highest precedence first. Usually one. */
  readonly owners: readonly PathOwner[];
  readonly flags: readonly PathFlag[];
  readonly severity: PathSeverity;
  /**
   * At least one reachable instance has no root folder here, and this path could hold one.
   * Gates the "add root folder" action - the dialog then decides *which* instances.
   */
  readonly canAddRootFolder: boolean;
  /** Null for files and for nodes that are not on disk. */
  readonly rollup: PathRollup | null;
  /** True when this node has, or may have, children worth expanding. */
  readonly expandable: boolean;
}

/**
 * What `only=` may select. Everything is free to evaluate from one readdir plus the
 * index, except `empty` and `unreadable`, which need a readdir per child.
 */
export const PATH_SELECTORS = [
  'all',
  'problems',
  'rootFolders',
  'candidates',
  'tracked',
  'untracked',
  'missing',
  'symlinks',
  'empty',
  'unreadable',
] as const;
export type PathSelector = (typeof PATH_SELECTORS)[number];

export interface PathMatrixLevel {
  /** The directory these nodes are children of. Null for the synthetic top level. */
  readonly path: string | null;
  /** Where "up" goes, or null at a mount and at the top level. */
  readonly parent: string | null;
  readonly nodes: readonly PathNode[];
  /** Everything in this directory *before* only/q/limit - the "812 entries" line. */
  readonly rollup: PathRollup;
  /**
   * The selectors actually applied. A big level defaults to `['problems']`, so the UI
   * knows the rows are a deliberate subset rather than everything there is.
   */
  readonly selection: readonly PathSelector[];
  /** How many entries matched only+q, before limit. */
  readonly matched: number;
  readonly offset: number;
  readonly limit: number;
  /** matched > offset + nodes.length. */
  readonly truncated: boolean;
  /** False when this level was served without a readdir per child. */
  readonly childCountsResolved: boolean;
  /** Per level, so one unreadable folder is not a failed request. */
  readonly error: string | null;
}

export interface PathMatrixColumn {
  readonly instanceId: number;
  readonly name: string;
  readonly kind: 'radarr' | 'sonarr';
  /**
   * False when the instance did not answer.
   *
   * Load-bearing: an unreachable instance is absent from every row's `owners`, so without
   * this the view could not tell "nobody uses this folder" from "we could not ask".
   */
  readonly reachable: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  readonly rootFolderCount: number;
  readonly mediaPathCount: number;
  /** Its root folders this container cannot see - the mismatch diagnosis, per column. */
  readonly unseenRootFolders: readonly string[];
}

/**
 * Fleet counters.
 *
 * `rootFolderPaths`, `unseenRootFolders` and `unmanaged` are exact: they come from the
 * *Arr index and need no disk access. The other three describe the
 * levels in *this* response, because counting them fleet-wide would mean walking every
 * library - the one thing this design exists to avoid. The overview always reads the
 * whole spine, so on a first load they cover every mount and root folder.
 */
export interface PathMatrixTotals {
  readonly rootFolderPaths: number;
  readonly unseenRootFolders: number;
  /** Media paths that sit under none of their own instance's root folders. Exact. */
  readonly unmanaged: number;
  /** Directories inside a root folder that no instance tracks - the old orphan count. */
  readonly untracked: number;
  /** *Arr paths that are not on disk. */
  readonly missing: number;
  /** Directories sitting alongside root folders that are not root folders themselves. */
  readonly candidates: number;
}

export interface PathMatrixResponse {
  /** False when FS_ROOTS is unset: the whole filesystem feature is off. */
  readonly enabled: boolean;
  readonly scannedAt: string;
  /** Saves a second request; also feeds the disabled-state panel and move datalists. */
  readonly roots: readonly FsRoot[];
  readonly columns: readonly PathMatrixColumn[];
  readonly levels: readonly PathMatrixLevel[];
  readonly totals: PathMatrixTotals;
  /** Instances none of whose paths exist here. Now also rendered inline as rows. */
  readonly mismatches: readonly MappingMismatch[];
}
