import type {
  PathFlag,
  PathInstanceCell,
  PathMatrixColumn,
  PathMatrixLevel,
  PathNode,
} from '@arrranger/shared';

/**
 * Turning the server's levels into table rows.
 *
 * Everything here is pure: levels in, rows out. The view never walks the tree itself,
 * which is what makes the "a library must never become 812 rows" rule testable.
 */

export type PathRowKind = 'node' | 'rollup';

export interface PathRow {
  readonly kind: PathRowKind;
  /** Stable across re-renders: `:v-for` keys on it. */
  readonly key: string;
  readonly depth: number;
  /** The directory this row belongs to. */
  readonly levelPath: string;
  /** Set for a node row. */
  readonly node: PathNode | null;
  /** Set for a rollup row - the level it summarises. */
  readonly level: PathMatrixLevel | null;
  readonly expanded: boolean;
  /** True when a level for this node has been fetched. */
  readonly hasLevel: boolean;
}

export interface FlattenInput {
  readonly levels: Readonly<Record<string, PathMatrixLevel>>;
  readonly expanded: readonly string[];
  readonly focus: string | null;
}

/** The synthetic top level - mounts and paths this container cannot see - is keyed ''. */
export const TOP_LEVEL = '';

export function levelKey(path: string | null): string {
  return path ?? TOP_LEVEL;
}

/**
 * Depth-first walk of the fetched levels.
 *
 * A rollup row is appended under an expanded level whenever its rows are a subset of
 * what is actually there - which is the normal case for a library folder.
 */
export function flattenLevels(input: FlattenInput): PathRow[] {
  const expanded = new Set(input.expanded);
  const rows: PathRow[] = [];
  const guard = new Set<string>();

  const walk = (key: string, depth: number): void => {
    // A cycle would need a symlink loop the server followed; it never does, but a
    // malformed response must not hang the browser.
    if (guard.has(key)) return;
    guard.add(key);

    const level = input.levels[key];
    if (level === undefined) return;

    for (const node of level.nodes) {
      const childKey = node.path;
      const hasLevel = input.levels[childKey] !== undefined;
      const isExpanded = expanded.has(childKey) && hasLevel;

      rows.push({
        kind: 'node',
        key: `node:${childKey}`,
        depth,
        levelPath: key,
        node,
        level: null,
        expanded: isExpanded,
        hasLevel,
      });

      if (isExpanded) walk(childKey, depth + 1);
    }

    // The summary goes last, so it reads as a footer for the rows above it.
    const child = input.levels[key];
    if (child !== undefined && needsRollupRow(child)) {
      rows.push({
        kind: 'rollup',
        key: `rollup:${key}`,
        depth,
        levelPath: key,
        node: null,
        level: child,
        expanded: false,
        hasLevel: true,
      });
    }
  };

  const root = input.focus === null ? TOP_LEVEL : input.focus;
  walk(root, 0);
  return rows;
}

/**
 * A level needs its counts spelled out when the rows on screen are not the whole story:
 * either more matched than were returned, or a selector hid some entirely.
 */
export function needsRollupRow(level: PathMatrixLevel): boolean {
  if (level.truncated) return true;
  return level.matched < level.rollup.entries;
}

export interface RollupChip {
  readonly label: string;
  readonly count: number;
  readonly tone: string;
  readonly title: string;
}

/**
 * The counts worth showing, in the order they matter. `empty` and `unreadable` are
 * omitted when the server did not evaluate them - a null there means "not checked",
 * and rendering it as 0 would be a lie.
 */
export function rollupChips(level: PathMatrixLevel): RollupChip[] {
  const { rollup } = level;
  const chips: RollupChip[] = [
    {
      label: 'tracked',
      count: rollup.tracked,
      tone: 'text-sync',
      title: 'At least one instance has media at or under these folders',
    },
    {
      label: 'untracked',
      count: rollup.untracked,
      tone: 'text-drift',
      title: 'Inside a root folder, but no instance tracks anything here',
    },
    {
      label: 'missing',
      count: rollup.missing,
      tone: 'text-danger',
      title: 'An instance points at these paths and the disk does not have them',
    },
    {
      label: 'not a root folder',
      count: rollup.candidates,
      tone: 'text-drift',
      title: 'Sits alongside a root folder without being one',
    },
  ];

  if (rollup.empty !== null) {
    chips.push({ label: 'empty', count: rollup.empty, tone: 'text-muted', title: 'No entries on disk' });
  }
  if (rollup.unreadable !== null) {
    chips.push({
      label: 'no access',
      count: rollup.unreadable,
      tone: 'text-danger',
      title: 'The container cannot read these - check PUID/PGID',
    });
  }

  return chips.filter((chip) => chip.count > 0);
}

/**
 * An `unknown` cell for an instance the response did not mention - a column added since
 * the last fetch. The invariant holds client-side too: never render a gap when unsure.
 */
export function cellFor(node: PathNode, instanceId: number): PathInstanceCell {
  return (
    node.cells.find((cell) => cell.instanceId === instanceId) ?? {
      instanceId,
      known: false,
      role: 'unknown',
      rootFolderId: null,
      accessible: null,
      freeSpace: null,
      totalSpace: null,
      mediaUnder: 0,
      title: null,
    }
  );
}


export function rootFolderCount(node: PathNode): number {
  return node.cells.filter((cell) => cell.known && cell.role === 'rootFolder').length;
}

/** Instances that could take this path as a root folder but do not have it. */
export function missingRootFolderOn(
  node: PathNode,
  targetInstanceIds: readonly number[],
): number[] {
  return node.cells
    .filter(
      (cell) =>
        cell.known && cell.role !== 'rootFolder' && targetInstanceIds.includes(cell.instanceId),
    )
    .map((cell) => cell.instanceId);
}

export interface RootFolderCellTarget {
  readonly instanceId: number;
  readonly rootFolderId: number;
  readonly path: string;
}

export function rootFolderTargets(
  node: PathNode,
  targetInstanceIds: readonly number[],
): RootFolderCellTarget[] {
  return node.cells
    .filter(
      (cell) =>
        cell.known && cell.role === 'rootFolder' && targetInstanceIds.includes(cell.instanceId),
    )
    .map((cell) => ({
      instanceId: cell.instanceId,
      rootFolderId: cell.rootFolderId ?? 0,
      path: node.path,
    }));
}

/** Instances tracking media at or under a path, for the relocation warning. */
export function trackedBy(
  node: PathNode,
  columns: readonly PathMatrixColumn[],
): Array<{ instanceId: number; name: string; mediaCount: number }> {
  return node.cells
    .filter((cell) => cell.known && cell.mediaUnder > 0)
    .map((cell) => ({
      instanceId: cell.instanceId,
      name:
        columns.find((column) => column.instanceId === cell.instanceId)?.name ??
        `instance ${String(cell.instanceId)}`,
      mediaCount: cell.mediaUnder,
    }));
}

export type PathAction =
  | 'propagate'
  | 'remove'
  | 'remap'
  | 'reconcile'
  | 'mkdir'
  | 'rename'
  | 'move'
  | 'prune'
  | 'focus';

/**
 * A row offers exactly what its roles allow.
 *
 * Note what is deliberately absent: renaming an individual *media* folder is offered as
 * a plain disk rename, never as an align chain. `media.moveRootFolder` only sets
 * `rootFolderPath` and `media.refresh` re-reads each item's stored path, so nothing in
 * the current operation set can make *Arr adopt a renamed media folder - it would report
 * the item missing instead. Offering one would be a lie dressed as a feature.
 */
export function actionsFor(
  node: PathNode,
  targetInstanceIds: readonly number[],
): PathAction[] {
  const flags = new Set<PathFlag>(node.flags);
  const actions: PathAction[] = [];

  // Nothing on disk to act on, and no path to browse into.
  if (flags.has('unseen')) {
    return rootFolderTargets(node, targetInstanceIds).length > 0 ? ['remove'] : [];
  }

  if (missingRootFolderOn(node, targetInstanceIds).length > 0) actions.push('propagate');
  if (rootFolderTargets(node, targetInstanceIds).length > 0) actions.push('remove');

  if (flags.has('rootFolder')) {
    if (node.cells.some((cell) => cell.role === 'rootFolder' && cell.mediaUnder > 0)) {
      actions.push('remap');
    }
    actions.push('reconcile');
  } else if (node.cells.some((cell) => cell.known && cell.role === 'tracked')) {
    actions.push('reconcile');
  }

  if (flags.has('missing')) return actions.concat('mkdir');

  if (node.exists && node.kind === 'directory') {
    actions.push('mkdir');
    if (!flags.has('mount')) {
      actions.push('rename', 'move');
      // Pruning is only offered when nothing anywhere would lose media by it.
      if (node.cells.every((cell) => !cell.known || cell.mediaUnder === 0)) actions.push('prune');
    }
    if (node.expandable) actions.push('focus');
  }

  return actions;
}

/** Badge vocabulary. Same tokens the storage explorer used, re-keyed to server flags. */
export const FLAG_STYLES: Record<PathFlag, { label: string; classes: string; title: string }> = {
  mount: {
    label: 'mount',
    classes: 'border-accent/50 bg-accent/10 text-accent',
    title: 'A configured FS_ROOTS mount - it can never be renamed, moved or deleted',
  },
  rootFolder: {
    label: 'root folder',
    classes: 'border-sync/50 bg-sync/10 text-sync',
    title: 'A root folder on at least one instance',
  },
  candidate: {
    label: 'not a root folder',
    classes: 'border-drift/50 bg-drift/10 text-drift',
    title: 'Sits alongside a root folder without being one on any instance',
  },
  untracked: {
    label: 'untracked',
    classes: 'border-drift/50 bg-drift/10 text-drift',
    title: 'Inside a root folder, but no instance tracks anything at or under it',
  },
  unmanaged: {
    label: 'unmanaged',
    classes: 'border-drift/50 bg-drift/10 text-drift',
    title: 'Holds media, but sits under no root folder on any instance',
  },
  missing: {
    label: 'missing',
    classes: 'border-danger/50 bg-danger/10 text-danger',
    title: 'An instance points at this path, but it does not exist on disk',
  },
  unseen: {
    label: 'not mounted here',
    classes: 'border-danger/50 bg-danger/10 text-danger',
    title:
      'A root folder outside FS_ROOTS - a volume mapping difference, not missing media',
  },
  empty: {
    label: 'empty',
    classes: 'border-line-strong bg-raised text-muted',
    title: 'Directory has no entries',
  },
  symlink: {
    label: 'symlink',
    classes: 'border-accent/50 bg-accent/10 text-accent',
    title: 'ArrRanger never follows or mutates symlinks',
  },
  unreadable: {
    label: 'no access',
    classes: 'border-danger/50 bg-danger/10 text-danger',
    title: 'The container cannot read this path - check PUID/PGID and permissions',
  },
  readOnly: {
    label: 'read-only',
    classes: 'border-drift/50 bg-drift/10 text-drift',
    title: 'Readable but not writable - a staged rename or move here would fail',
  },
};
