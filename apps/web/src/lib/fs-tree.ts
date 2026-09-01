import type { FsEntry, ReconcileEntry, ReconcileReport } from '@arrranger/shared';

/**
 * Pure helpers for the storage explorer.
 *
 * Paths are always POSIX here: they describe what the *container* sees, which is also what
 * the *Arr instances must see.
 */

export function joinPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`;
}

export function parentOf(target: string): string | null {
  const trimmed = target.replace(/\/+$/, '');
  const index = trimmed.lastIndexOf('/');
  if (index <= 0) return trimmed === '' ? null : '/';
  return trimmed.slice(0, index);
}

export function basename(target: string): string {
  const segments = target.split('/').filter((segment) => segment.length > 0);
  return segments.at(-1) ?? target;
}

export interface Breadcrumb {
  readonly label: string;
  readonly path: string;
}

/** Crumbs from the containing root down to `target`, never above the root. */
export function breadcrumbs(target: string, roots: readonly string[]): Breadcrumb[] {
  const root = roots.find((entry) => target === entry || target.startsWith(`${entry}/`));
  if (root === undefined) return [{ label: target, path: target }];

  const crumbs: Breadcrumb[] = [{ label: root, path: root }];
  const rest = target.slice(root.length).split('/').filter((segment) => segment.length > 0);

  let current = root;
  for (const segment of rest) {
    current = joinPath(current, segment);
    crumbs.push({ label: segment, path: current });
  }

  return crumbs;
}

export type EntryBadge = 'orphan' | 'missing' | 'empty' | 'tracked' | 'symlink' | 'unreadable';

export interface ClassifiedEntry {
  readonly entry: FsEntry;
  readonly badges: readonly EntryBadge[];
  /** Instances whose library contains this exact path. */
  readonly instanceIds: readonly number[];
}

export interface ReconcileIndex {
  readonly byPath: ReadonlyMap<string, ReconcileEntry>;
  readonly missingPaths: ReadonlySet<string>;
}

export function indexReconcile(report: ReconcileReport | null): ReconcileIndex {
  return {
    byPath: new Map((report?.entries ?? []).map((entry) => [entry.path, entry])),
    missingPaths: new Set((report?.missing ?? []).map((entry) => entry.path)),
  };
}

/**
 * Turns one directory listing into rows the explorer can render, folding in what the
 * reconcile report knows about each path.
 */
export function classifyEntries(
  entries: readonly FsEntry[],
  index: ReconcileIndex,
): ClassifiedEntry[] {
  return entries.map((entry) => {
    const badges: EntryBadge[] = [];
    const known = index.byPath.get(entry.path);

    if (entry.kind === 'symlink') badges.push('symlink');
    if (!entry.readable) badges.push('unreadable');

    if (known?.state === 'orphan') badges.push('orphan');
    if (known?.state === 'matched') badges.push('tracked');
    if (entry.kind === 'directory' && entry.childCount === 0) badges.push('empty');

    return { entry, badges, instanceIds: known?.instanceIds ?? [] };
  });
}

/** Rows for *Arr paths that should be here but are not - shown alongside the real entries. */
export function missingUnder(report: ReconcileReport | null, directory: string): string[] {
  if (report === null) return [];
  const prefix = `${directory.replace(/\/+$/, '')}/`;

  return report.missing
    .filter((entry) => entry.path.startsWith(prefix) && !entry.path.slice(prefix.length).includes('/'))
    .map((entry) => entry.path);
}

export const BADGE_STYLES: Record<EntryBadge, { label: string; classes: string; title: string }> = {
  orphan: {
    label: 'orphan',
    classes: 'border-drift/50 bg-drift/10 text-drift',
    title: 'On disk, but no connected instance has media at this path',
  },
  missing: {
    label: 'missing',
    classes: 'border-danger/50 bg-danger/10 text-danger',
    title: 'An instance points at this path, but it does not exist on disk',
  },
  empty: {
    label: 'empty',
    classes: 'border-line-strong bg-raised text-muted',
    title: 'Directory has no entries',
  },
  tracked: {
    label: 'tracked',
    classes: 'border-sync/50 bg-sync/10 text-sync',
    title: 'Matched to media in at least one instance',
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
};
