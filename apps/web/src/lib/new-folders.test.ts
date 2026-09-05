import { describe, expect, it } from 'vitest';
import { planNewFolders, quoteFolderName } from './new-folders';

describe('planNewFolders', () => {
  it('creates one folder from a plain name', () => {
    expect(planNewFolders('/data/media', 'movies-4k')).toEqual({
      targets: ['/data/media/movies-4k'],
      error: null,
      nested: false,
    });
  });

  it('expands a brace tree the way mkdir -p does, parent first', () => {
    const plan = planNewFolders('/data/media', '{movies,series}/{russian,western}');

    expect(plan.targets).toEqual([
      '/data/media/movies/russian',
      '/data/media/movies/western',
      '/data/media/series/russian',
      '/data/media/series/western',
    ]);
    // Every one of them is two levels down, so the recursive flag is not optional.
    expect(plan.nested).toBe(true);
  });

  it('takes an absolute pattern at its word and ignores the parent', () => {
    expect(planNewFolders('/data/media', '/data/backup/{a,b}').targets).toEqual([
      '/data/backup/a',
      '/data/backup/b',
    ]);
  });

  it('reads ranges, quotes and whitespace-separated patterns as one source', () => {
    expect(planNewFolders('/data', 'season{01..03} "TV Shows"').targets).toEqual([
      '/data/season01',
      '/data/season02',
      '/data/season03',
      '/data/TV Shows',
    ]);
  });

  it('normalises stray slashes and deduplicates what two patterns both name', () => {
    expect(planNewFolders('/data/media/', '{4k,4k}/ movies//4k').targets).toEqual([
      '/data/media/4k',
      '/data/media/movies/4k',
    ]);
  });

  it('is empty, not wrong, while the box is blank', () => {
    expect(planNewFolders('/data', '   ')).toEqual({ targets: [], error: null, nested: false });
  });

  it('refuses a source it cannot expand, and creates nothing', () => {
    const plan = planNewFolders('/data', '{movies,series');

    expect(plan.targets).toEqual([]);
    expect(plan.error).not.toBeNull();
  });

  it('refuses to walk the tree with . or ..', () => {
    expect(planNewFolders('/data/media', '../escape').error).toMatch(/\.\./);
  });

  it('plans exactly one folder for a name that was quoted for it', () => {
    // The round trip the "repair this missing folder" prefill depends on.
    const name = 'Gone (2001) {director\'s cut}';

    expect(planNewFolders('/data/media', quoteFolderName(name)).targets).toEqual([
      `/data/media/${name}`,
    ]);
  });

  it('asks for a parent before it will place a relative name', () => {
    const plan = planNewFolders('', 'movies');

    expect(plan.targets).toEqual([]);
    expect(plan.error).toMatch(/absolute/);
  });
});
