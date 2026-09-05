import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  expandBraces,
  matchPathFilter,
  parsePathFilter,
  passesPathFilter,
  MAX_PATTERNS,
} from './path-filter.js';

describe('brace expansion', () => {
  test('expands a flat alternation in order', () => {
    assert.deepEqual(expandBraces('movies/{russian,western}'), [
      'movies/russian',
      'movies/western',
    ]);
  });

  test('expands nested braces the way mkdir -p does', () => {
    assert.deepEqual(expandBraces('{animation/{movies,series},shows}/4k'), [
      'animation/movies/4k',
      'animation/series/4k',
      'shows/4k',
    ]);
  });

  test('multiplies adjacent groups', () => {
    assert.deepEqual(expandBraces('{a,b}{1,2}'), ['a1', 'a2', 'b1', 'b2']);
  });

  test('whitespace separates patterns, so one box takes two trees', () => {
    assert.deepEqual(expandBraces('movies/{a,b} series/{c,d}'), [
      'movies/a',
      'movies/b',
      'series/c',
      'series/d',
    ]);
  });

  test('a space inside braces or quotes is part of the folder name', () => {
    assert.deepEqual(expandBraces('{Movies,TV Shows}/4k'), ['Movies/4k', 'TV Shows/4k']);
    assert.deepEqual(expandBraces('"The Matrix (1999)"'), ['The Matrix (1999)']);
    assert.deepEqual(expandBraces('The\\ Matrix'), ['The Matrix']);
  });

  test('a brace with no comma is literal text, exactly like bash', () => {
    assert.deepEqual(expandBraces('{a}'), ['{a}']);
    assert.deepEqual(expandBraces('{a{b,c}}'), ['{ab}', '{ac}']);
  });

  test('expands numeric and alphabetic ranges, padding when asked', () => {
    assert.deepEqual(expandBraces('s{1..3}'), ['s1', 's2', 's3']);
    assert.deepEqual(expandBraces('season{01..03}'), ['season01', 'season02', 'season03']);
    assert.deepEqual(expandBraces('{1..7..3}'), ['1', '4', '7']);
    assert.deepEqual(expandBraces('{3..1}'), ['3', '2', '1']);
    assert.deepEqual(expandBraces('{a..d}'), ['a', 'b', 'c', 'd']);
  });

  test('duplicates collapse: the same folder listed twice is one pattern', () => {
    assert.deepEqual(expandBraces('{a,a}/x'), ['a/x']);
  });

  test('the real ask expands to every leaf it names', () => {
    const source =
      '{animation/{movies/{anime,russian,western,eastern,europe},series/{anime,russian,western,europe}},' +
      'movies/{russian,western,europe,eastern},series/{russian,western,europe,doramas},shows/russian}' +
      '/{{auto-feed,curated-feed}/{0k,main,4k},custom-grabs}';
    const patterns = expandBraces(source);

    // 9 animation + 4 movies + 4 series + 1 shows = 18 libraries, 7 feed folders each.
    assert.equal(patterns.length, 18 * 7);
    assert.ok(patterns.includes('animation/movies/anime/auto-feed/4k'));
    assert.ok(patterns.includes('shows/russian/custom-grabs'));
  });

  test('refuses to explode', () => {
    const source = `{${Array.from({ length: 40 }, (_, i) => String(i)).join(',')}}`.repeat(4);
    assert.throws(() => expandBraces(source), /more than 5000 patterns/);
    assert.equal(MAX_PATTERNS, 5000);
  });

  test('an unbalanced brace and an unclosed quote are errors, not guesses', () => {
    assert.equal(parsePathFilter('movies/{a,b').error, 'unclosed “{” at position 8');
    assert.equal(parsePathFilter('"movies').error, 'unclosed double quote');
    assert.equal(parsePathFilter('movies/{a,b').active, false);
  });
});

describe('matching', () => {
  const verdict = (source: string, path: string): string =>
    matchPathFilter(parsePathFilter(source), path);

  test('a bare word still matches part of a folder name', () => {
    assert.equal(verdict('matrix', '/data/films/The Matrix (1999)'), 'full');
    assert.equal(verdict('matrix', '/data/films/Heat (1995)'), 'none');
  });

  test('a path pattern matches a run of whole segments, anywhere', () => {
    assert.equal(verdict('movies/4k', '/data/media/movies/4k'), 'full');
    assert.equal(verdict('movies/4k', '/data/media/movies/4k/Dune (2021)'), 'full');
    assert.equal(verdict('movies/4k', '/data/media/movies/main'), 'none');
    // whole segments, so a partial word no longer matches once there is a slash
    assert.equal(verdict('movies/4', '/data/media/movies/4k'), 'none');
  });

  test('an ancestor of a possible match is partial, a sibling is not', () => {
    assert.equal(verdict('animation/movies/anime', '/data/media/animation'), 'partial');
    assert.equal(verdict('animation/movies/anime', '/data/media/animation/movies'), 'partial');
    assert.equal(verdict('animation/movies/anime', '/data/media/animation/movies/anime'), 'full');
    assert.equal(verdict('animation/movies/anime', '/data/media/movies'), 'none');
    assert.equal(verdict('animation/movies/anime', '/data/media'), 'none');
  });

  test('a run that ended before the path did says nothing about the path', () => {
    // `animation` is not on the way to anything here - it is already behind us.
    assert.equal(verdict('animation/movies', '/data/animation/other'), 'none');
  });

  test('globs match inside one segment only', () => {
    assert.equal(verdict('movies/*-feed', '/data/movies/auto-feed'), 'full');
    assert.equal(verdict('movies/*-feed', '/data/movies/auto-feed/4k'), 'full');
    assert.equal(verdict('*/4k', '/data/movies/4k'), 'full');
    assert.equal(verdict('s0?', '/data/series/Show/s01'), 'full');
    assert.equal(verdict('s0?', '/data/series/Show/s011'), 'none');
  });

  test('case is ignored, on both sides', () => {
    assert.equal(verdict('MOVIES/4K', '/data/Movies/4k'), 'full');
  });

  test('any of the patterns is enough', () => {
    assert.equal(verdict('movies/{4k,main}', '/data/movies/main'), 'full');
  });
});

describe('the tree rule', () => {
  const include = parsePathFilter('animation/movies/anime');
  const exclude = parsePathFilter('animation/movies/anime', 'exclude');

  test('include keeps matches, ancestors on the way, and folders above the libraries', () => {
    assert.equal(passesPathFilter(include, '/data/media/animation/movies/anime'), true);
    assert.equal(passesPathFilter(include, '/data/media/animation'), true);
    assert.equal(passesPathFilter(include, '/data/media/movies'), false);
    // a mount, or a folder with root folders below it, is how the tree reaches a match
    assert.equal(passesPathFilter(include, '/data/media', { navigable: true }), true);
  });

  test('exclude hides the match and its subtree, and protects nothing', () => {
    assert.equal(passesPathFilter(exclude, '/data/media/animation/movies/anime'), false);
    assert.equal(passesPathFilter(exclude, '/data/media/animation/movies/anime/4k'), false);
    assert.equal(passesPathFilter(exclude, '/data/media/animation/movies'), true);
    assert.equal(passesPathFilter(exclude, '/data/media/movies'), true);
    assert.equal(
      passesPathFilter(exclude, '/data/media/animation/movies/anime', { navigable: true }),
      false,
    );
  });

  test('a filter that cannot be read never filters', () => {
    const broken = parsePathFilter('{a,b');
    assert.equal(passesPathFilter(broken, '/anything'), true);
  });
});
