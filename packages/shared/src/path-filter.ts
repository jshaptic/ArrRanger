/**
 * The Paths filter language.
 *
 * One text box that has to answer two very different questions - "where is that folder
 * called doramas?" and "show me exactly these 231 feed folders and nothing else" - so it
 * borrows the notation a shell already uses for the second one:
 *
 *   movies/{russian,western}/{0k,main,4k}
 *
 * Brace expansion, the same rules `mkdir -p` follows, plus per-segment `*` / `?` globs.
 * Nothing here touches the disk: a filter is expanded once into literal patterns, and a
 * path is judged against those patterns by name, segment by segment.
 *
 * Deliberately shared rather than server-only: the server filters the levels it returns,
 * and the browser needs the very same verdict to tell a folder that *matched* from one
 * kept only because a pattern might continue below it (see {@link PathFilterVerdict}).
 */

export const PATH_FILTER_MODES = ['include', 'exclude'] as const;

/** `include` keeps what matches; `exclude` hides it. The negation toggle, in one word. */
export type PathFilterMode = (typeof PATH_FILTER_MODES)[number];

/**
 * How a path stands against a filter.
 *
 * `partial` is the one that makes a tree usable: `animation` does not match
 * `animation/movies/anime`, but the folder it names is the only way to reach one that
 * does, so it is kept - visibly *on the way to* a match rather than being one.
 */
export type PathFilterVerdict = 'full' | 'partial' | 'none';

/** One expanded pattern, compiled to a matcher per path segment. */
export interface PathFilterTerm {
  /** The literal this expanded to, for the preview list. */
  readonly pattern: string;
  readonly segments: readonly PathSegmentMatcher[];
}

export interface PathSegmentMatcher {
  readonly source: string;
  matches(name: string): boolean;
}

export interface PathFilter {
  readonly source: string;
  readonly mode: PathFilterMode;
  /** Every literal the source expands to, deduplicated, in expansion order. */
  readonly patterns: readonly string[];
  readonly terms: readonly PathFilterTerm[];
  /** Why the source could not be expanded, or null. An invalid filter never filters. */
  readonly error: string | null;
  /** True when there is something to apply: parsed, and not blank. */
  readonly active: boolean;
}

/**
 * The ceiling on one expansion.
 *
 * `{a,b}` nests multiplicatively, so a dozen keystrokes can ask for millions of strings.
 * The real-world ask - one line naming every feed folder in a library - is a few hundred.
 */
export const MAX_PATTERNS = 5000;

class PathFilterParseError extends Error {}

// --------------------------------------------------------------------- expansion

/** `\x` keeps x, quotes keep everything: this is how a folder name with a space is said. */
function isSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function cross(prefixes: readonly string[], items: readonly string[]): string[] {
  if (prefixes.length * items.length > MAX_PATTERNS) {
    throw new PathFilterParseError(`that expands to more than ${String(MAX_PATTERNS)} patterns`);
  }
  return prefixes.flatMap((prefix) => items.map((item) => prefix + item));
}

const NUMERIC_RANGE = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/;
const ALPHA_RANGE = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$/;

/**
 * `{1..10}`, `{01..10..2}`, `{a..f}` - bash's sequence braces.
 *
 * Zero padding is kept when either end is padded, because `season{01..12}` is the whole
 * reason anyone types this.
 */
function expandRange(raw: string): string[] | null {
  const numeric = NUMERIC_RANGE.exec(raw);
  if (numeric !== null) {
    const [, fromText = '', toText = '', stepText] = numeric;
    const from = Number.parseInt(fromText, 10);
    const to = Number.parseInt(toText, 10);
    const step = Math.abs(stepText === undefined ? 1 : Number.parseInt(stepText, 10));
    if (step === 0 || !Number.isFinite(from) || !Number.isFinite(to)) return null;

    const padded = [fromText, toText].some(
      (text) => /^-?0\d/.test(text) && text.replace('-', '').length > 1,
    );
    const width = Math.max(fromText.replace('-', '').length, toText.replace('-', '').length);
    const count = Math.floor(Math.abs(to - from) / step) + 1;
    if (count > MAX_PATTERNS) {
      throw new PathFilterParseError(`that range is longer than ${String(MAX_PATTERNS)} patterns`);
    }

    const out: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const value = from + index * step * (to < from ? -1 : 1);
      const digits = Math.abs(value).toString();
      out.push(
        `${value < 0 ? '-' : ''}${padded ? digits.padStart(width, '0') : digits}`,
      );
    }
    return out;
  }

  const alpha = ALPHA_RANGE.exec(raw);
  if (alpha === null) return null;
  const [, fromChar = '', toChar = '', stepText] = alpha;
  const step = Math.abs(stepText === undefined ? 1 : Number.parseInt(stepText, 10));
  if (step === 0) return null;

  const from = fromChar.codePointAt(0) ?? 0;
  const to = toChar.codePointAt(0) ?? 0;
  const direction = to < from ? -1 : 1;
  const out: string[] = [];
  for (let code = from; direction > 0 ? code <= to : code >= to; code += step * direction) {
    out.push(String.fromCodePoint(code));
  }
  return out;
}

interface Sequence {
  readonly items: string[];
  readonly next: number;
}

/**
 * One run of text and braces, expanded into every string it stands for.
 *
 * Stops at `,` or `}` inside a brace, and at whitespace outside one - which is what makes
 * a space a pattern separator at the top level and an ordinary character inside `{…}`.
 * Bash would refuse `{Movies,TV Shows}`; a folder called "TV Shows" is far too common for
 * that to be the useful answer here.
 */
function parseSequence(source: string, start: number, inBrace: boolean): Sequence {
  let items = [''];
  let literal = '';
  let index = start;

  const flush = (): void => {
    if (literal.length === 0) return;
    items = items.map((item) => item + literal);
    literal = '';
  };

  while (index < source.length) {
    const char = source[index] ?? '';

    if (inBrace && (char === ',' || char === '}')) break;
    if (!inBrace && isSpace(char)) break;

    if (char === '\\') {
      literal += source[index + 1] ?? '\\';
      index += 2;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\' && index + 1 < source.length) {
          literal += source[index + 1] ?? '';
          index += 2;
          continue;
        }
        literal += source[index] ?? '';
        index += 1;
      }
      if (index >= source.length) {
        throw new PathFilterParseError(`unclosed ${quote === '"' ? 'double' : 'single'} quote`);
      }
      index += 1;
      continue;
    }

    if (char === '{') {
      flush();
      const brace = parseBrace(source, index);
      items = cross(items, brace.items);
      index = brace.next;
      continue;
    }

    literal += char;
    index += 1;
  }

  flush();
  return { items, next: index };
}

/** `{a,b}`, `{a,{b,c}}`, `{1..9}` - and, exactly like bash, `{a}` is the literal `{a}`. */
function parseBrace(source: string, start: number): Sequence {
  let index = start + 1;
  const alternatives: string[][] = [];
  let sawComma = false;

  for (;;) {
    const sequence = parseSequence(source, index, true);
    alternatives.push(sequence.items);
    index = sequence.next;

    const char = source[index];
    if (char === undefined) {
      throw new PathFilterParseError(`unclosed “{” at position ${String(start + 1)}`);
    }
    index += 1;
    if (char === ',') {
      sawComma = true;
      continue;
    }
    break;
  }

  if (sawComma) return { items: alternatives.flat(), next: index };

  const raw = source.slice(start + 1, index - 1);
  const range = expandRange(raw);
  if (range !== null) return { items: range, next: index };

  // No comma and no range: braces are not a grouping operator, so they are just text.
  return { items: (alternatives[0] ?? ['']).map((item) => `{${item}}`), next: index };
}

/**
 * Every literal a filter expands to.
 *
 * Whitespace separates patterns, so the two-line ask in one box - a big brace tree, then
 * a second one - is a single valid filter.
 *
 * @throws PathFilterParseError on unbalanced braces, unclosed quotes, or an explosion.
 */
export function expandBraces(source: string): string[] {
  const out: string[] = [];
  let index = 0;

  while (index < source.length) {
    if (isSpace(source[index] ?? '')) {
      index += 1;
      continue;
    }
    const sequence = parseSequence(source, index, false);
    // A zero-width word cannot happen while the loop advances, but a defensive break beats
    // a hung tab if it ever does.
    if (sequence.next === index) break;
    index = sequence.next;
    for (const item of sequence.items) {
      if (item.length > 0) out.push(item);
    }
    if (out.length > MAX_PATTERNS) {
      throw new PathFilterParseError(`that expands to more than ${String(MAX_PATTERNS)} patterns`);
    }
  }

  return [...new Set(out)];
}

// --------------------------------------------------------------------- matching

const GLOB_META = /[*?]/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A segment matcher.
 *
 * Two rules, and the second one exists only to keep the plain search box plain: a
 * single-segment pattern with no glob in it matches anywhere in the name, so typing
 * `matrix` still finds "The Matrix (1999)". Anything with a `/` or a `*` in it is a
 * deliberate pattern and is matched against the whole segment.
 */
function segmentMatcher(source: string, substring: boolean): PathSegmentMatcher {
  const lower = source.toLowerCase();

  if (substring && !GLOB_META.test(source)) {
    return { source, matches: (name) => name.toLowerCase().includes(lower) };
  }

  const expression = new RegExp(
    `^${lower.split('').map((char) => (char === '*' ? '[^/]*' : char === '?' ? '[^/]' : escapeRegExp(char))).join('')}$`,
  );
  return { source, matches: (name) => expression.test(name.toLowerCase()) };
}

function compile(pattern: string): PathFilterTerm | null {
  const parts = pattern.split('/').filter((segment) => segment.length > 0);
  if (parts.length === 0) return null;
  const substring = parts.length === 1;
  return { pattern, segments: parts.map((part) => segmentMatcher(part, substring)) };
}

/** Blank, unparseable or expanding to nothing - all three mean "do not filter". */
export function parsePathFilter(source: string, mode: PathFilterMode = 'include'): PathFilter {
  const trimmed = source.trim();
  const base = { source: trimmed, mode };

  if (trimmed.length === 0) {
    return { ...base, patterns: [], terms: [], error: null, active: false };
  }

  try {
    const patterns = expandBraces(trimmed);
    const terms = patterns.map(compile).filter((term): term is PathFilterTerm => term !== null);
    return { ...base, patterns, terms, error: null, active: terms.length > 0 };
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : 'could not be read';
    return { ...base, patterns: [], terms: [], error, active: false };
  }
}

export function pathSegments(target: string): string[] {
  return target.split('/').filter((segment) => segment.length > 0);
}

/** The first `count` of a term's segments, tried against the path from `offset`. */
function runAt(
  segments: readonly string[],
  term: PathFilterTerm,
  offset: number,
  count: number,
): boolean {
  for (let index = 0; index < count; index += 1) {
    const name = segments[offset + index];
    if (name === undefined) return false;
    if (!(term.segments[index]?.matches(name) ?? false)) return false;
  }
  return true;
}

/**
 * Where one pattern stands against one path.
 *
 * `full` when the pattern's segments appear as a run anywhere in the path - which is what
 * makes a pattern relative rather than absolute (`movies/4k` finds `/data/movies/4k`) and
 * what makes everything *under* a match a match too.
 *
 * `partial` when the run has begun but the path ends first: the path is an ancestor of
 * something the pattern could still name.
 */
export function matchTerm(term: PathFilterTerm, segments: readonly string[]): PathFilterVerdict {
  const width = term.segments.length;

  for (let offset = 0; offset + width <= segments.length; offset += 1) {
    if (runAt(segments, term, offset, width)) return 'full';
  }

  // The run has to be *unfinished at the end of the path*, or it says nothing about what
  // is below: `/data/media/movies` is on the way to `movies/4k`, `/data/movies/other` is not.
  for (let taken = Math.min(width - 1, segments.length); taken > 0; taken -= 1) {
    if (runAt(segments, term, segments.length - taken, taken)) return 'partial';
  }

  return 'none';
}

/** The best verdict any pattern reaches. An inactive filter matches everything fully. */
export function matchPathFilter(filter: PathFilter, target: string): PathFilterVerdict {
  if (!filter.active) return 'full';

  const segments = pathSegments(target);
  let best: PathFilterVerdict = 'none';
  for (const term of filter.terms) {
    const verdict = matchTerm(term, segments);
    if (verdict === 'full') return 'full';
    if (verdict === 'partial') best = 'partial';
  }
  return best;
}

/**
 * The rule the tree is filtered by, in one place so the browser and the server cannot
 * disagree about it.
 *
 * `navigable` is for the folders a filter must never remove: a mount, and anything with a
 * root folder below it. Their whole job is to be the way down to the folders a pattern
 * names, and a pattern that starts deeper (`animation/movies`) says nothing about them.
 * In `exclude` mode there is no such protection - hiding what was named is the point.
 */
export function passesPathFilter(
  filter: PathFilter,
  target: string,
  options: { navigable?: boolean } = {},
): boolean {
  if (!filter.active) return true;
  const verdict = matchPathFilter(filter, target);
  if (filter.mode === 'exclude') return verdict !== 'full';
  return verdict !== 'none' || options.navigable === true;
}
