/**
 * What makes the same title on two instances one row.
 *
 * The `/media` view groups a Radarr-HD copy and a Radarr-4K copy of the same film into a
 * single row with two chips, which needs an identity that survives crossing instances -
 * every id *inside* an *Arr instance is local to it. External metadata ids are that
 * identity, with a ladder underneath for the items that have none: Radarr writes
 * `tmdbId: 0` for a film someone added by hand, and such an item still has to be one row
 * rather than one row per instance.
 *
 * The media kind always prefixes the key, so a film and a series can never merge even
 * when they share a title, a slug, or (as Sonarr and Radarr both carry `tmdbId`) an id.
 */

import type { MediaKind } from './instance.js';
import type { ArrMedia } from './arr.js';

/**
 * Which rung of the ladder answered.
 *
 * `title` is the weak one, and it is reported rather than hidden: the view caveats rows
 * merged on a normalised title and a year, because that is a guess where the other two
 * are facts.
 */
export type MediaIdentityBasis = 'external' | 'slug' | 'title';

export interface MediaIdentity {
  readonly key: string;
  readonly basis: MediaIdentityBasis;
}

/**
 * Fold a title down to what two instances would agree on.
 *
 * Leading articles are deliberately kept: `sortTitle` already strips them, and dropping
 * them here would widen the weakest rung's blast radius - "The Thing" and "Thing" are not
 * obviously the same film.
 */
export function normaliseMediaTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Radarr writes 0 rather than omitting the field, so the two have to mean the same. */
function externalId(value: number | undefined): number | null {
  return value === undefined || value <= 0 ? null : value;
}

/**
 * The grouping key for one item.
 *
 * `movie`  : tmdb -> slug -> title+year
 * `series` : tvdb -> tmdb -> slug -> title+year
 *
 * Sonarr carries a `tmdbId` too, which is why the kind prefix is not decoration: without
 * it a series and a film sharing a TMDB id would collapse into one row.
 */
export function mediaIdentity(media: ArrMedia, kind: MediaKind): MediaIdentity {
  if (kind === 'movie') {
    const tmdb = externalId(media.tmdbId);
    if (tmdb !== null) return { key: `movie:tmdb:${String(tmdb)}`, basis: 'external' };
  } else {
    const tvdb = externalId(media.tvdbId);
    if (tvdb !== null) return { key: `series:tvdb:${String(tvdb)}`, basis: 'external' };
    const tmdb = externalId(media.tmdbId);
    if (tmdb !== null) return { key: `series:tmdb:${String(tmdb)}`, basis: 'external' };
  }

  const slug = media.titleSlug?.trim();
  if (slug !== undefined && slug.length > 0) {
    return { key: `${kind}:slug:${slug.toLowerCase()}`, basis: 'slug' };
  }

  const normalised = normaliseMediaTitle(media.title);
  const year = media.year === undefined ? '' : String(media.year);
  return { key: `${kind}:title:${normalised}:${year}`, basis: 'title' };
}

/**
 * A key that cannot collide with anything.
 *
 * The row builder calls this when a `title`-basis key is already claimed *by the same
 * instance*: two different films on one Radarr must never become one row, however alike
 * their names, so the loser keeps its own row keyed by where it actually lives.
 */
export function disambiguateMediaKey(key: string, instanceId: number, mediaId: number): string {
  return `${key}#${String(instanceId)}:${String(mediaId)}`;
}
