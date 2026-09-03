/**
 * Pure path helpers.
 *
 * Paths are always POSIX here: they describe what the *container* sees, which is also what
 * the *Arr instances must see. Classifying a path against *Arr is the server's job now -
 * see `lib/path-matrix.ts` for the row model built from its answer.
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
