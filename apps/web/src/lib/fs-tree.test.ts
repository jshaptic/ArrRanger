import type { FsEntry, ReconcileReport } from '@arrranger/shared';
import { describe, expect, it } from 'vitest';
import {
  basename,
  breadcrumbs,
  classifyEntries,
  indexReconcile,
  joinPath,
  missingUnder,
  parentOf,
} from './fs-tree';

function entry(name: string, overrides: Partial<FsEntry> = {}): FsEntry {
  return {
    path: `/data/movies/${name}`,
    name,
    kind: 'directory',
    modifiedAt: '2026-09-01T00:00:00.000Z',
    childCount: 2,
    sizeOnDisk: null,
    fileCount: null,
    readable: true,
    writable: true,
    ...overrides,
  };
}

const report: ReconcileReport = {
  scannedAt: '2026-09-01T00:00:00.000Z',
  roots: ['/data/movies'],
  entries: [
    {
      path: '/data/movies/Arrival (2016)',
      name: 'Arrival (2016)',
      rootFolderPath: '/data/movies',
      state: 'matched',
      isSymlink: false,
      instanceIds: [1, 2],
      modifiedAt: null,
    },
    {
      path: '/data/movies/Orphan (1999)',
      name: 'Orphan (1999)',
      rootFolderPath: '/data/movies',
      state: 'orphan',
      isSymlink: false,
      instanceIds: [],
      modifiedAt: null,
    },
  ],
  missing: [
    { path: '/data/movies/Gone (2001)', instanceId: 1, kind: 'media', title: 'Gone' },
    { path: '/data/movies/deep/Nested (2002)', instanceId: 1, kind: 'media', title: 'Nested' },
  ],
  mismatches: [],
  counts: { matched: 1, orphan: 1, empty: 0, missing: 2 },
};

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
});

describe('entry classification', () => {
  const index = indexReconcile(report);

  it('marks tracked folders with the instances that own them', () => {
    const [row] = classifyEntries([entry('Arrival (2016)')], index);
    expect(row?.badges).toContain('tracked');
    expect(row?.instanceIds).toEqual([1, 2]);
  });

  it('marks folders no instance knows about as orphans', () => {
    const [row] = classifyEntries([entry('Orphan (1999)')], index);
    expect(row?.badges).toEqual(['orphan']);
  });

  it('marks empty directories and unreadable ones', () => {
    const rows = classifyEntries(
      [entry('Nothing Here', { childCount: 0 }), entry('No Access', { readable: false })],
      index,
    );
    expect(rows[0]?.badges).toContain('empty');
    expect(rows[1]?.badges).toContain('unreadable');
  });

  it('marks symlinks, which are shown but never followed', () => {
    const [row] = classifyEntries([entry('link', { kind: 'symlink' })], index);
    expect(row?.badges).toContain('symlink');
  });

  it('is empty-safe with no report yet', () => {
    const rows = classifyEntries([entry('Arrival (2016)')], indexReconcile(null));
    expect(rows[0]?.badges).toEqual([]);
    expect(rows[0]?.instanceIds).toEqual([]);
  });
});

describe('missing paths', () => {
  it('lists *Arr paths that should be in this directory but are not', () => {
    expect(missingUnder(report, '/data/movies')).toEqual(['/data/movies/Gone (2001)']);
  });

  it('does not surface deeper missing paths in a shallow listing', () => {
    expect(missingUnder(report, '/data/movies')).not.toContain('/data/movies/deep/Nested (2002)');
    expect(missingUnder(report, '/data/movies/deep')).toEqual(['/data/movies/deep/Nested (2002)']);
  });

  it('returns nothing without a report', () => {
    expect(missingUnder(null, '/data/movies')).toEqual([]);
  });
});
