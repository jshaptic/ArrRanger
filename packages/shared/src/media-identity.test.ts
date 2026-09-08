import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ArrMedia } from './arr.js';
import {
  disambiguateMediaKey,
  mediaIdentity,
  normaliseMediaTitle,
  type MediaIdentityBasis,
} from './media-identity.js';

function media(overrides: Partial<ArrMedia> = {}): ArrMedia {
  return {
    id: 1,
    title: 'Dune',
    path: '/data/movies/Dune (2021)',
    qualityProfileId: 1,
    monitored: true,
    tags: [],
    ...overrides,
  };
}

const key = (overrides: Partial<ArrMedia>, kind: 'movie' | 'series' = 'movie'): string =>
  mediaIdentity(media(overrides), kind).key;

const basis = (
  overrides: Partial<ArrMedia>,
  kind: 'movie' | 'series' = 'movie',
): MediaIdentityBasis => mediaIdentity(media(overrides), kind).basis;

describe('the ladder', () => {
  test('a movie is its TMDB id', () => {
    assert.equal(key({ tmdbId: 438631 }), 'movie:tmdb:438631');
    assert.equal(basis({ tmdbId: 438631 }), 'external');
  });

  test('a series prefers TVDB, then TMDB', () => {
    assert.equal(key({ tvdbId: 121361, tmdbId: 1399 }, 'series'), 'series:tvdb:121361');
    assert.equal(key({ tmdbId: 1399 }, 'series'), 'series:tmdb:1399');
    assert.equal(basis({ tmdbId: 1399 }, 'series'), 'external');
  });

  test('an id of 0 falls through, because that is what Radarr writes for a manual add', () => {
    assert.equal(key({ tmdbId: 0, titleSlug: 'dune-438631' }), 'movie:slug:dune-438631');
    assert.equal(basis({ tmdbId: 0, titleSlug: 'dune-438631' }), 'slug');
    // and with nothing at all, down to the weakest rung
    assert.equal(key({ tmdbId: 0, year: 2021 }), 'movie:title:dune:2021');
    assert.equal(basis({ tmdbId: 0, year: 2021 }), 'title');
  });

  test('the weakest rung folds punctuation, case and accents but keeps the article', () => {
    assert.equal(key({ title: 'The Matrix: Reloaded!', year: 2003 }), 'movie:title:thematrixreloaded:2003');
    assert.equal(key({ title: 'Amélie', year: 2001 }), 'movie:title:amelie:2001');
    assert.equal(normaliseMediaTitle('WALL·E'), 'walle');
    // dropping "The" is sortTitle's job, not ours
    assert.notEqual(normaliseMediaTitle('The Thing'), normaliseMediaTitle('Thing'));
  });

  test('a missing year is not the same title as a known one', () => {
    assert.equal(key({ title: 'Dune' }), 'movie:title:dune:');
    assert.notEqual(key({ title: 'Dune' }), key({ title: 'Dune', year: 2021 }));
    assert.notEqual(key({ title: 'Dune', year: 1984 }), key({ title: 'Dune', year: 2021 }));
  });
});

describe('grouping across instances', () => {
  test('two instances holding the same film produce one key', () => {
    const hd = mediaIdentity(media({ id: 12, tmdbId: 438631, path: '/data/movies/Dune' }), 'movie');
    const uhd = mediaIdentity(media({ id: 98, tmdbId: 438631, path: '/data/4k/Dune' }), 'movie');
    assert.equal(hd.key, uhd.key);
  });

  test('a movie and a series never merge, whatever they share', () => {
    // both apps carry tmdbId, so the kind prefix is load-bearing rather than decorative
    assert.notEqual(key({ tmdbId: 1399 }, 'movie'), key({ tmdbId: 1399 }, 'series'));
    assert.notEqual(key({ titleSlug: 'shogun' }, 'movie'), key({ titleSlug: 'shogun' }, 'series'));
    assert.notEqual(
      key({ title: 'Shogun', year: 2024 }, 'movie'),
      key({ title: 'Shogun', year: 2024 }, 'series'),
    );
  });

  test('a slug is matched case-insensitively', () => {
    assert.equal(key({ titleSlug: 'Dune-438631' }), key({ titleSlug: 'dune-438631' }));
  });
});

describe('disambiguation', () => {
  test('two rung-4 collisions on one instance stay separate rows', () => {
    // Same normalised title and year, two different films on the same Radarr. Merging them
    // would let one bulk delete take out both.
    const first = mediaIdentity(media({ id: 4, title: 'The Thing', year: 2011 }), 'movie');
    const second = mediaIdentity(media({ id: 9, title: 'The  Thing', year: 2011 }), 'movie');
    assert.equal(first.key, second.key);
    assert.equal(first.basis, 'title');

    assert.notEqual(disambiguateMediaKey(second.key, 3, 9), first.key);
    assert.equal(disambiguateMediaKey(second.key, 3, 9), 'movie:title:thething:2011#3:9');
  });
});
