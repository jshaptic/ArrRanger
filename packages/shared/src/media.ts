/**
 * The `/media` wire contract.
 *
 * The row lives here rather than in the browser because the **server** builds it: grouping
 * a title across instances, joining per-instance tag labels and profile names, judging the
 * filter and paging the result all happen once, server-side, so the summary can never
 * describe rows it had already removed. That is the same division `filesystem.ts` draws for
 * `/paths`, and the opposite of the browser-local view models `/import-lists` uses.
 *
 * `MediaFacet` and `MediaRow` *extend* the shapes the filter evaluates, so the service hands
 * its rows straight to `matchMediaFilter` with no adapter and the compiler is what keeps the
 * two in step.
 */

import type { ArrQualityProfile, ArrTag } from './arr.js';
import type { InstanceKind } from './instance.js';
import type { MediaIdentityBasis } from './media-identity.js';
import type { MediaFilterFacet, MediaFilterRow, MediaFilterVocabulary } from './media-filter.js';

export const MEDIA_SORTS = ['title', 'year', 'added', 'size', 'instances'] as const;
export type MediaSort = (typeof MEDIA_SORTS)[number];

export const MEDIA_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type MediaSortDirection = (typeof MEDIA_SORT_DIRECTIONS)[number];

/** Whether undecided rows are counted and set aside, or listed instead of the matches. */
export const MEDIA_UNDECIDED_MODES = ['hide', 'show'] as const;
export type MediaUndecidedMode = (typeof MEDIA_UNDECIDED_MODES)[number];

/**
 * Row badges, computed server-side so the vocabulary cannot drift - the `/paths` rule.
 *
 * Note what is *not* here. **Whether anything is on disk is not a flag** - it is a size, and
 * the Size column answers it: a number, `no file`, or `unknown` where the instance could not
 * say. A monitored item nobody has downloaded yet is an ordinary state, not a fault, and a
 * badge beside three other badges reads like one. Nor is there an `unknown` flag: an instance
 * that did not answer is a fact about the column, stated once above the table.
 */
export const MEDIA_FLAGS = ['unmonitored', 'no-quality-profile', 'outside-root-folders'] as const;
export type MediaFlag = (typeof MEDIA_FLAGS)[number];

/**
 * How one instance holds one title.
 *
 * Absence is not a facet: an instance that does not have the title simply is not here, the
 * way `/import-lists` and `/paths` treat their owners. Every per-instance id lives at this
 * level, where it is meaningful and where the bulk dialogs read it - a tag id means nothing
 * one instance over, so the row above carries labels only.
 */
export interface MediaFacet extends MediaFilterFacet {
  /** The id a bulk operation stages against this instance. */
  readonly mediaId: number;
  readonly tagIds: readonly number[];
  readonly qualityProfileId: number;
  /** Ids behind `lists`. Null wherever `lists` is null - unknown, not empty. */
  readonly listIds: readonly number[] | null;
  readonly episodes: { readonly have: number; readonly total: number } | null;
  readonly flags: readonly MediaFlag[];
  /**
   * Whether this copy satisfied the filter.
   *
   * Every facet still renders - hiding the others would make `tags:4k` read as though the
   * title existed on one instance only. This is what a bulk operation acts on.
   */
  readonly matched: boolean;
}

export interface MediaRow extends MediaFilterRow {
  readonly identityBasis: MediaIdentityBasis;
  readonly facets: readonly MediaFacet[];
  /** Union of the labels across the copies - the only cross-instance tag identity there is. */
  readonly tags: readonly string[];
  readonly instanceCount: number;
  readonly monitoredCount: number;
  readonly fileCount: number;
  /**
   * Summed across copies, because HD and 4K hold different files - so this is the honest
   * answer to "how much would deleting this free". Null when no copy could say.
   */
  readonly sizeOnDisk: number | null;
  readonly addedFirst: string | null;
  readonly matchedInstanceIds: readonly number[];
  /** Why it could not be judged. Present only on an undecided row. */
  readonly reasons?: readonly string[];
}

export interface MediaFleetColumn {
  readonly instanceId: number;
  readonly name: string;
  readonly kind: InstanceKind;
  /**
   * False when the instance did not answer.
   *
   * Load-bearing, and narrower than it looks: it is what excludes the instance from every
   * bulk fan-out. Its facets still render, from the last snapshot, because the alternative
   * is a row that reads as though nobody held the title.
   */
  readonly reachable: boolean;
  readonly error: string | null;
  readonly errorCode: string | null;
  readonly fetchedAt: string | null;
  readonly itemCount: number;
  /** False for every Sonarr instance: it exposes no import-list contents endpoint. */
  readonly importListsKnown: boolean;
  readonly importListsUnknownReason: 'unsupported' | 'error' | null;
  /** This instance's own vocabulary, so a bulk dialog needs no second fan-out. */
  readonly tags: readonly ArrTag[];
  readonly qualityProfiles: readonly ArrQualityProfile[];
  readonly rootFolders: readonly string[];
  readonly importLists: readonly { readonly id: number; readonly name: string }[];
}

export interface MediaFleetTotals {
  readonly rows: number;
  readonly movies: number;
  readonly series: number;
  readonly facets: number;
  readonly onOneInstance: number;
  readonly onMultipleInstances: number;
  readonly monitored: number;
  readonly withFiles: number;
  readonly sizeOnDisk: number | null;
  readonly unreachableInstances: number;
  readonly importListsUnknownInstances: number;
  /** Rows grouped on a normalised title and a year rather than an external id. */
  readonly weakIdentityRows: number;
}

/** Grouped so the sentence can name why, not just how many. */
export interface MediaUndecidedReason {
  readonly reason: string;
  readonly rows: number;
}

export interface MediaFleetResponse {
  readonly scannedAt: string;
  /** The oldest column - the honest "as of" for the whole view. */
  readonly oldestFetchedAt: string | null;
  readonly columns: readonly MediaFleetColumn[];
  /**
   * The page the query asked for: the matches, or - when `undecided` is `show` - the rows
   * the filter could not judge, each carrying its own `reasons`. One list and one paging
   * path, because two arrays of the same rows only ever disagree.
   */
  readonly rows: readonly MediaRow[];
  /** Which of the two `rows` is. */
  readonly listing: MediaUndecidedMode;
  /** The scoped fleet before the filter - the `PathRollup` split. */
  readonly totals: MediaFleetTotals;
  /** All three describe the whole filtered set, BEFORE paging. */
  readonly counts: {
    readonly matched: number;
    readonly undecided: number;
    readonly total: number;
  };
  readonly undecidedReasons: readonly MediaUndecidedReason[];
  readonly page: number;
  readonly pageSize: number;
  readonly truncated: boolean;
  readonly sort: MediaSort;
  readonly direction: MediaSortDirection;
  readonly filter: { readonly source: string; readonly error: string | null };
  readonly vocabulary: MediaFilterVocabulary;
}

/**
 * Ids only, so "apply to all 1 240 matched" needs no walk through thirteen pages.
 *
 * The honest source of bulk-operation targets: a fan-out must never be derived from the
 * rows that happen to be loaded, or it would act on a page and say it acted on a filter.
 */
export interface MediaIdsResponse {
  readonly matched: number;
  readonly truncated: boolean;
  readonly groups: readonly {
    readonly instanceId: number;
    readonly kind: InstanceKind;
    readonly mediaIds: readonly number[];
  }[];
}
