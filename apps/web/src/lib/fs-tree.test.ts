import { describe, expect, it } from 'vitest';
import { basename, breadcrumbs, joinPath, parentOf, rewritePathPrefix } from './fs-tree';

describe('path helpers', () => {
  it('joins and splits paths', () => {
    expect(joinPath('/data/movies', 'Dune')).toBe('/data/movies/Dune');
    expect(joinPath('/', 'data')).toBe('/data');
    expect(parentOf('/data/movies/Dune')).toBe('/data/movies');
    expect(parentOf('/data')).toBe('/');
    expect(basename('/data/movies/Dune (2021)')).toBe('Dune (2021)');
    expect(basename('/data/movies/')).toBe('movies');
  });

  it('builds breadcrumbs that stop at the storage root', () => {
    expect(breadcrumbs('/data/media/movies/Dune', ['/data'])).toEqual([
      { label: '/data', path: '/data' },
      { label: 'media', path: '/data/media' },
      { label: 'movies', path: '/data/media/movies' },
      { label: 'Dune', path: '/data/media/movies/Dune' },
    ]);
  });

  it('never walks above the root, even for a path outside it', () => {
    expect(breadcrumbs('/etc/passwd', ['/data'])).toEqual([
      { label: '/etc/passwd', path: '/etc/passwd' },
    ]);
  });

  it('rewrites a path under a renamed ancestor, never a shared prefix', () => {
    expect(rewritePathPrefix('/data/movies/europe/auto-feed/0k', '/data/movies/europe', '/data/movies/european')).toBe(
      '/data/movies/european/auto-feed/0k',
    );
    expect(rewritePathPrefix('/data/movies/europe', '/data/movies/europe', '/data/movies/european')).toBe(
      '/data/movies/european',
    );
    expect(rewritePathPrefix('/data/movies-4k', '/data/movies', '/data/films')).toBe('/data/movies-4k');
  });
});
