import {
  PATH_SEVERITIES,
  type PathFlag,
  type PathMatrixColumn,
  type PathMatrixLevel,
  type PathNode,
  type PathOwner,
  type PathSeverity,
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
  /**
   * The worst severity *inside* this node, when its level has been fetched; null when it
   * has not, because "nothing fetched" is not "nothing wrong".
   *
   * A node cannot carry this itself - its children are a separate request - but a level
   * is exactly "what is in this directory", and the store already indexes levels by path.
   */
  readonly childSeverity: PathSeverity | null;
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
      // This view manages folders, not media files: a plain file sitting in an otherwise
      // ordinary directory is never a row here, in either the tree or the flat list.
      if (node.kind === 'file') continue;

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
        childSeverity: hasLevel ? input.levels[childKey]?.rollup.severity ?? null : null,
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
        childSeverity: null,
      });
    }
  };

  const root = input.focus === null ? TOP_LEVEL : input.focus;
  walk(root, 0);
  return rows;
}

/**
 * The flat alternative to {@link flattenLevels}: every leaf *folder* under the root, in
 * one list, with no nesting - depth is always 0, which is also what makes a node's own
 * label logic (`depth === 0` ⇒ full path) show the whole path for free.
 *
 * A leaf is a folder with no *sub*folders - which is not the same thing as a folder with
 * no children. A folder holding 172 episode files and nothing else is the deepest folder
 * on that branch, and is exactly what this list is for; the server calls it `expandable`
 * (it has entries), so leaf-ness is decided from its fetched level - does it contain a
 * directory? - and never from `expandable` alone. A folder whose level was never fetched
 * is treated as a leaf too: the caller is expected to have crawled everything first (see
 * `loadFlatView`), so that is a defensive fallback, not the normal path.
 *
 * Anything that is not a directory - a file, a symlink - is dropped outright: this is a
 * folder list, and a level legitimately mixes directory and file candidates together.
 * Rollup rows are dropped for the same reason: a flat list is only meaningful once
 * nothing is left summarised.
 */
export function flattenLeaves(input: FlattenInput): PathRow[] {
  const rows: PathRow[] = [];
  const guard = new Set<string>();

  const walk = (key: string): void => {
    if (guard.has(key)) return;
    guard.add(key);

    const level = input.levels[key];
    if (level === undefined) return;

    for (const node of level.nodes) {
      if (node.kind !== 'directory') continue;

      const childKey = node.path;
      const childLevel = input.levels[childKey];
      const hasLevel = childLevel !== undefined;

      if (childLevel?.nodes.some((child) => child.kind === 'directory') === true) {
        walk(childKey);
        continue;
      }

      rows.push({
        kind: 'node',
        key: `leaf:${childKey}`,
        depth: 0,
        levelPath: key,
        node,
        level: null,
        expanded: false,
        hasLevel,
        childSeverity: null,
      });
    }
  };

  const root = input.focus === null ? TOP_LEVEL : input.focus;
  walk(root);
  return rows.sort((a, b) => (a.node?.path ?? '').localeCompare(b.node?.path ?? ''));
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

/** How a severity is rendered. `ok` and `info` are silent - a glyph on every row is noise. */
export const SEVERITY_STYLES: Record<PathSeverity, { glyph: string; classes: string } | null> = {
  ok: null,
  info: null,
  warn: { glyph: '\u26a0', classes: 'text-drift' },
  error: { glyph: '\u2715', classes: 'text-danger' },
};

/** The worst of a set - `PATH_SEVERITIES` is ordered, so this is a max. */
export function worstSeverity(severities: readonly PathSeverity[]): PathSeverity {
  return severities.reduce<PathSeverity>(
    (worst, entry) =>
      PATH_SEVERITIES.indexOf(entry) > PATH_SEVERITIES.indexOf(worst) ? entry : worst,
    'ok',
  );
}

/**
 * The instances that did not answer.
 *
 * This is where the `unknown` cell went. An instance that could not be read is absent
 * from every row's `owners`, so without saying so once, an empty Used-by cell would read
 * as "nobody uses this folder" - exactly the gap-versus-unknown confusion the fleet
 * matrices refuse to make.
 */
export function unknownColumns(
  columns: readonly PathMatrixColumn[],
): readonly PathMatrixColumn[] {
  return columns.filter((column) => !column.reachable);
}

export function rootFolderOwners(node: PathNode): readonly PathOwner[] {
  return node.owners.filter((owner) => owner.use === 'rootFolder');
}

export interface RootFolderCellTarget {
  readonly instanceId: number;
  readonly rootFolderId: number;
  readonly path: string;
}

/**
 * The root folders to remove for a path - one per owning instance.
 *
 * No target-selection argument any more: a folder's owners *are* the answer to "which
 * instance", and the dialog names each one before anything is staged.
 */
export function rootFolderTargets(node: PathNode): RootFolderCellTarget[] {
  return rootFolderOwners(node).map((owner) => ({
    instanceId: owner.instanceId,
    rootFolderId: owner.rootFolderId ?? 0,
    path: node.path,
  }));
}

/** Instances tracking media at or under a path, for the relocation warning. */
export function trackedBy(
  node: PathNode,
): Array<{ instanceId: number; name: string; mediaCount: number }> {
  return node.owners
    .filter((owner) => owner.mediaUnder > 0)
    .map((owner) => ({
      instanceId: owner.instanceId,
      name: owner.name,
      mediaCount: owner.mediaUnder,
    }));
}

/**
 * What the Media column says: the title when exactly one instance tracks an item here,
 * otherwise how many items the owners hold at or under it.
 *
 * Summed rather than maxed, and broken down in the tooltip, because a 4K/HD split has two
 * instances counting the same films and neither number alone is the truth.
 */
export function mediaSummary(node: PathNode): { label: string; detail: string } | null {
  if (node.owners.length === 0) return null;

  const tracked = node.owners.filter((owner) => owner.use === 'tracked');
  const detail = node.owners
    .map((owner) => `${owner.name}: ${String(owner.mediaUnder)} item(s)`)
    .join('\n');

  if (tracked.length === 1 && tracked[0]?.title !== null) {
    return { label: tracked[0]?.title ?? '', detail };
  }

  const total = node.owners.reduce((sum, owner) => sum + owner.mediaUnder, 0);
  return total === 0 ? null : { label: String(total), detail };
}

export type PathAction =
  | 'addRoot'
  | 'remove'
  | 'remap'
  | 'reconcile'
  | 'mkdir'
  | 'rename'
  | 'move'
  | 'prune'
  | 'focus';

/**
 * A row offers exactly what the folder itself allows.
 *
 * There is no target-instance argument: the folder's own `owners` answer "which instance"
 * for everything that removes or realigns, and the dialogs ask for everything that adds.
 * That is what lets the fleet bar be a filter rather than a hidden action target.
 *
 * Note what is deliberately absent: renaming an individual *media* folder is offered as
 * a plain disk rename, never as an align chain. `media.moveRootFolder` only sets
 * `rootFolderPath` and `media.refresh` re-reads each item's stored path, so nothing in
 * the current operation set can make *Arr adopt a renamed media folder - it would report
 * the item missing instead. Offering one would be a lie dressed as a feature.
 */
export function actionsFor(node: PathNode): PathAction[] {
  const flags = new Set<PathFlag>(node.flags);
  const rootFolders = rootFolderOwners(node);
  const actions: PathAction[] = [];

  // Nothing on disk to act on, and no path to browse into.
  if (flags.has('unseen')) return rootFolders.length > 0 ? ['remove'] : [];

  if (node.canAddRootFolder) actions.push('addRoot');
  if (rootFolders.length > 0) actions.push('remove');

  if (flags.has('rootFolder')) {
    if (rootFolders.some((owner) => owner.mediaUnder > 0)) actions.push('remap');
    actions.push('reconcile');
  } else if (node.owners.some((owner) => owner.use === 'tracked')) {
    actions.push('reconcile');
  }

  if (flags.has('missing')) return actions.concat('mkdir');

  if (node.exists && node.kind === 'directory') {
    actions.push('mkdir');
    if (!flags.has('mount')) {
      actions.push('rename', 'move');
      // Pruning is only offered when nothing anywhere would lose media by it. An instance
      // that did not answer is not an owner, so it contributes no media - the same
      // conclusion the old `!cell.known || cell.mediaUnder === 0` check reached.
      if (!node.owners.some((owner) => owner.mediaUnder > 0)) actions.push('prune');
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
