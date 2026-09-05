/**
 * What `mkdir` would create, worked out before anything is staged.
 *
 * The Paths view used to offer `new folder` on every row, which made the one thing people
 * actually do here - laying out a shape, `{movies,series}/{russian,western}/4k` - a dozen
 * trips through the same dialog. One button and one box instead, speaking the syntax the
 * filter box already speaks: {@link expandBraces} is the very same expansion, so a pattern
 * that *finds* six folders is a pattern that *creates* them.
 *
 * Nothing here touches the disk. It turns a parent and a source string into the absolute
 * paths a batch of `fs.mkdir` items would target; whether each one is possible is the
 * server's preflight to answer.
 */
import { expandBraces } from '@arrranger/shared';

/**
 * A folder name, written the way this box has to read it back.
 *
 * A space separates two folders here, exactly as it does for `mkdir`, so "Gone (2001)"
 * pre-filled raw would plan two of them. Backslashes are the one escape that works
 * everywhere in the expansion - inside braces, inside quotes, and on their own.
 */
export function quoteFolderName(name: string): string {
  return name.replace(/[\\"'{}\s]/g, String.raw`\$&`);
}

export interface NewFolderPlan {
  /** Absolute, normalised, deduplicated, in expansion order. Empty when there is nothing to do. */
  readonly targets: readonly string[];
  /** Why the source could not be read, or null. An unreadable plan creates nothing. */
  readonly error: string | null;
  /**
   * True when a pattern names more than one level, which is the only reason the recursive
   * flag has to be on - `mkdir -p`, said by the input itself.
   */
  readonly nested: boolean;
}

const EMPTY: NewFolderPlan = { targets: [], error: null, nested: false };

/** Trailing and doubled slashes are typing, not intent; `.` and `..` are neither. */
function segmentsOf(target: string): string[] {
  const segments = target.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`"${target}" walks the tree with . or .. - name the folder outright`);
  }
  return segments;
}

/**
 * The folders a source string names, under `parent`.
 *
 * A pattern that starts with `/` is taken at its word and ignores the parent, the same way
 * an absolute argument to `mkdir` ignores the working directory. Everything else hangs off
 * the parent, which therefore has to be an absolute path before anything can be planned.
 */
export function planNewFolders(parent: string, source: string): NewFolderPlan {
  const trimmed = source.trim();
  if (trimmed.length === 0) return EMPTY;

  const base = parent.trim();

  try {
    const targets = new Set<string>();
    let nested = false;

    for (const literal of expandBraces(trimmed)) {
      const segments = segmentsOf(literal);
      if (segments.length === 0) throw new Error(`"${literal}" names no folder`);

      if (literal.startsWith('/')) {
        targets.add(`/${segments.join('/')}`);
        continue;
      }

      if (!base.startsWith('/')) {
        return {
          targets: [],
          error: 'name the folder to create these in first, as an absolute path',
          nested: false,
        };
      }
      if (segments.length > 1) nested = true;
      targets.add(`/${[...segmentsOf(base), ...segments].join('/')}`);
    }

    return { targets: [...targets], error: null, nested };
  } catch (caught) {
    return {
      targets: [],
      error: caught instanceof Error ? caught.message : 'could not be read',
      nested: false,
    };
  }
}
