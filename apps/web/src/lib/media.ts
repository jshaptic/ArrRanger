import type { Component } from 'vue';
import type { Instance, MediaFlag, MediaRow } from '@fleetarr/shared';
import IconError from '@/components/base/icons/IconError.vue';
import IconWarning from '@/components/base/icons/IconWarning.vue';

/**
 * Where a title can be looked up outside Fleetarr.
 *
 * Site names rather than one generic arrow glyph: which system it is *is* the information,
 * and an icon would hide exactly that. An id we do not have produces no link at all - never
 * a guessed search URL, because the view does not make claims it cannot back.
 */
export interface ExternalLink {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly title: string;
}

export function externalLinks(row: MediaRow): ExternalLink[] {
  const links: ExternalLink[] = [];

  if (row.tmdbId !== null) {
    const path = row.kind === 'movie' ? 'movie' : 'tv';
    links.push({
      key: 'tmdb',
      label: 'TMDb',
      href: `https://www.themoviedb.org/${path}/${String(row.tmdbId)}`,
      title: `Open ${row.title} on TMDb`,
    });
  }
  if (row.imdbId !== null) {
    links.push({
      key: 'imdb',
      label: 'IMDb',
      href: `https://www.imdb.com/title/${row.imdbId}/`,
      title: `Open ${row.title} on IMDb`,
    });
  }
  if (row.tvdbId !== null) {
    links.push({
      key: 'tvdb',
      label: 'TVDb',
      href: `https://www.thetvdb.com/dereferrer/series/${String(row.tvdbId)}`,
      title: `Open ${row.title} on TVDb`,
    });
  }
  // MDBList title pages are IMDb-keyed; a TMDb or TVDb number in that path 404s.
  if (row.imdbId !== null) {
    const mdblistKind = row.kind === 'movie' ? 'movie' : 'show';
    links.push({
      key: 'mdblist',
      label: 'MDBList',
      href: `https://mdblist.com/${mdblistKind}/${row.imdbId}`,
      title: `Open ${row.title} on MDBList`,
    });
  }

  return links;
}

/**
 * A copy's own page on the instance that holds it.
 *
 * Belongs on the chip card rather than the row: it is per instance, and four of them beside
 * a title would drown the title. Falls back to the instance root when *Arr gave us no slug.
 */
export function instanceLink(row: MediaRow, instance: Instance | undefined): string | null {
  if (instance === undefined) return null;
  const base = instance.baseUrl.replace(/\/+$/, '');
  const section = instance.kind === 'radarr' ? 'movie' : 'series';
  // No slug means no item page to link to, so the instance's own root is the honest target.
  return row.titleSlug === null ? base : `${base}/${section}/${row.titleSlug}`;
}

/**
 * What the Size column has to say, which is three things and not two.
 *
 * `none` is a known absence - every copy reported no file. `unknown` is what Sonarr gives
 * when it reported neither `hasFile` nor a `statistics` rollup, and it must not render as a
 * zero: "nothing on disk" and "nobody told us" are different answers.
 */
export type MediaSizeReading =
  | { readonly kind: 'size'; readonly bytes: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'unknown' };

export function rowSize(row: MediaRow): MediaSizeReading {
  if (row.sizeOnDisk !== null && row.sizeOnDisk > 0) {
    return { kind: 'size', bytes: row.sizeOnDisk };
  }
  // A copy that says `hasFile: false` is telling us something; one that says null is not.
  return row.facets.some((facet) => facet.hasFile === false) ? { kind: 'none' } : { kind: 'unknown' };
}

export type MediaSeverity = 'ok' | 'info' | 'warn' | 'error';

export interface MediaFlagStyle {
  readonly label: string;
  readonly classes: string;
  readonly title: string;
  readonly severity: MediaSeverity;
}

/**
 * This view's own badge vocabulary.
 *
 * Deliberately not the tag matrix's five cell cues - those belong to the matrix - and
 * deliberately not `PathFlagBadge`'s union either, which is about folders. The idiom is
 * shared; the words are not.
 *
 * Whether anything is on disk is **not** in here: it is a size, and the Size column says it.
 * A monitored item nobody has downloaded is an ordinary state, and a badge for it sitting
 * beside two real faults would read like a third one.
 */
export const MEDIA_FLAG_STYLES: Record<MediaFlag, MediaFlagStyle> = {
  unmonitored: {
    label: 'unmonitored',
    classes: 'border-line bg-transparent text-muted',
    title: '*Arr is not watching for releases of this on that instance',
    severity: 'info',
  },
  'no-quality-profile': {
    label: 'no profile',
    classes: 'border-drift/40 bg-drift/10 text-drift',
    title: 'That instance has no quality profile for the id this item carries',
    severity: 'warn',
  },
  'outside-root-folders': {
    label: 'outside its root folders',
    classes: 'border-drift/40 bg-drift/10 text-drift',
    title: 'This copy sits under none of that instance’s own root folders',
    severity: 'warn',
  },
};

/**
 * The filter a Status-column click applies, matching the field you would type.
 *
 * `outside-root-folders` has no field of its own, so a click there does nothing - the
 * badge still names the fact, it just is not a filter control.
 */
export const MEDIA_FLAG_FILTER: Partial<Record<MediaFlag, string>> = {
  unmonitored: 'monitored:false',
  'no-quality-profile': 'profile:none',
};

/** Only `warn` and above draw a glyph: `untracked`-style noise earns no icon. */
export const MEDIA_SEVERITY_ICONS: Record<MediaSeverity, Component | null> = {
  ok: null,
  info: null,
  warn: IconWarning,
  error: IconError,
};

const SEVERITY_ORDER: Record<MediaSeverity, number> = { ok: 0, info: 1, warn: 2, error: 3 };

/** The distinct flags across a row's copies, worst first. */
export function rowFlags(row: MediaRow): readonly MediaFlag[] {
  const flags = new Set(row.facets.flatMap((facet) => facet.flags));
  return [...flags].sort(
    (left, right) =>
      SEVERITY_ORDER[MEDIA_FLAG_STYLES[right].severity] -
      SEVERITY_ORDER[MEDIA_FLAG_STYLES[left].severity],
  );
}

/** Which instances carry a given flag - the detail a badge's title carries. */
export function instancesWithFlag(row: MediaRow, flag: MediaFlag): readonly string[] {
  return row.facets.filter((facet) => facet.flags.includes(flag)).map((facet) => facet.name);
}

/**
 * The distinct root folders a title sits in, with who puts it there.
 *
 * Several is normal, not drift: each instance rooting at its own subfolder is a layout
 * choice, and comparing them is the tag matrix's job rather than this view's.
 */
export interface MediaRootFolderGroup {
  readonly path: string;
  readonly instances: readonly string[];
}

export function rootFolderGroups(row: MediaRow): MediaRootFolderGroup[] {
  const groups = new Map<string, string[]>();
  for (const facet of row.facets) {
    const path = facet.rootFolderPath ?? '—';
    groups.set(path, [...(groups.get(path) ?? []), facet.name]);
  }
  return [...groups].map(([path, instances]) => ({ path, instances }));
}

/** Chip tone: a copy that satisfied the filter is lit, the rest stay quiet but present. */
export const MEDIA_CHIP_CLASSES = {
  matched: 'border-accent/50 bg-accent/10 text-ink hover:border-accent/80',
  other: 'border-line bg-transparent text-muted hover:border-line-strong',
} as const;
