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

// ------------------------------------------------------------------ reconcile

export type ReconcileEntryState = 'matched' | 'orphan' | 'empty';

/** A directory on disk under one of the *Arr root folders. */
export interface ReconcileEntry {
  readonly path: string;
  readonly name: string;
  readonly rootFolderPath: string;
  readonly state: ReconcileEntryState;
  readonly isSymlink: boolean;
  /** Instances whose library contains this exact path. */
  readonly instanceIds: readonly number[];
  readonly modifiedAt: string | null;
}

/** A path an instance believes in that is not on disk. */
export interface MissingPath {
  readonly path: string;
  readonly instanceId: number;
  readonly kind: 'media' | 'rootFolder';
  readonly title: string;
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

export interface ReconcileReport {
  readonly scannedAt: string;
  readonly roots: readonly string[];
  readonly entries: readonly ReconcileEntry[];
  readonly missing: readonly MissingPath[];
  readonly mismatches: readonly MappingMismatch[];
  readonly counts: {
    readonly matched: number;
    readonly orphan: number;
    readonly empty: number;
    readonly missing: number;
  };
}
