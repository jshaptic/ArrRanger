import type { ArrImportList, ArrRootFolder, ArrTagDetail, Instance } from '@arrranger/shared';
import { describe, expect, it } from 'vitest';
import {
  buildImportListRows,
  buildRootFolderRows,
  buildTagRows,
  findCollisions,
  findPathDiscrepancies,
  previewFindReplace,
  sortSnapshots,
  type InstanceSnapshot,
} from './matrix';

function instance(id: number, name: string, kind: Instance['kind'] = 'radarr'): Instance {
  return {
    id,
    name,
    kind,
    baseUrl: `http://host:${String(7000 + id)}`,
    verifySsl: true,
    enabled: true,
    timeoutMs: 20_000,
    appVersion: '5.0.0',
    lastConnectedAt: '2026-09-01T00:00:00.000Z',
    lastError: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function tag(id: number, label: string, mediaIds: number[] = []): ArrTagDetail {
  return {
    id,
    label,
    movieIds: mediaIds,
    indexerIds: [],
    importListIds: [],
    notificationIds: [],
    restrictionIds: [],
    delayProfileIds: [],
  };
}

function rootFolder(id: number, path: string, accessible = true): ArrRootFolder {
  return { id, path, accessible, freeSpace: 1000, totalSpace: 5000 };
}

function importList(id: number, name: string, overrides: Partial<ArrImportList> = {}): ArrImportList {
  return {
    id,
    name,
    implementation: 'TraktListImport',
    configContract: 'TraktListSettings',
    enabled: true,
    rootFolderPath: '/data/media',
    qualityProfileId: 1,
    tags: [],
    fields: [],
    ...overrides,
  };
}

function snapshot(
  id: number,
  name: string,
  parts: Partial<Pick<InstanceSnapshot, 'status' | 'tags' | 'rootFolders' | 'importLists'>> = {},
): InstanceSnapshot {
  return {
    instance: instance(id, name),
    status: parts.status ?? 'ok',
    fetchedAt: '2026-09-01T00:00:00.000Z',
    error: null,
    tags: parts.tags ?? [],
    rootFolders: parts.rootFolders ?? [],
    importLists: parts.importLists ?? [],
  };
}

describe('tag matrix', () => {
  const fleet = [
    snapshot(1, 'Radarr-4K', {
      tags: [tag(1, 'hd', [10, 11]), tag(2, 'kids'), tag(3, 'shared', [10])],
    }),
    snapshot(2, 'Radarr-HD', { tags: [tag(7, 'hd', [20]), tag(8, 'shared')] }),
    snapshot(3, 'Sonarr-Anime', { tags: [tag(4, 'anime', [30]), tag(5, 'shared')] }),
  ];

  it('lists every unique label across the fleet', () => {
    expect(buildTagRows(fleet).map((row) => row.label)).toEqual([
      'anime',
      'hd',
      'kids',
      'shared',
    ]);
  });

  it('marks a tag present on every healthy instance as in sync', () => {
    const row = buildTagRows(fleet).find((entry) => entry.label === 'shared');
    expect(row?.parity).toBe('full');
    expect(row?.presentOn).toEqual([1, 2, 3]);
    expect(row?.missingOn).toEqual([]);
  });

  it('flags a tag that only some instances have', () => {
    const row = buildTagRows(fleet).find((entry) => entry.label === 'hd');
    expect(row?.parity).toBe('partial');
    expect(row?.presentOn).toEqual([1, 2]);
    expect(row?.missingOn).toEqual([3]);
    expect(row?.totalMedia).toBe(3);
  });

  it('reports a tag attached to nothing anywhere as unused', () => {
    const row = buildTagRows(fleet).find((entry) => entry.label === 'kids');
    expect(row?.unusedEverywhere).toBe(true);
  });

  it('treats an unreachable instance as unknown, not missing', () => {
    const withFailure = [...fleet, snapshot(9, 'Radarr-Down', { status: 'error' })];
    const row = buildTagRows(withFailure).find((entry) => entry.label === 'shared');

    // One cell per column so the header and body line up...
    expect(row?.cells).toHaveLength(4);
    // ...but the failed instance is neither present nor missing.
    expect(row?.presentOn).not.toContain(9);
    expect(row?.missingOn).not.toContain(9);
    expect(row?.cells.at(-1)?.known).toBe(false);
    expect(row?.parity).toBe('full');
  });

  it('orders columns Radarr first, then alphabetically', () => {
    const mixed = [
      snapshot(1, 'Zeta'),
      { ...snapshot(2, 'Alpha'), instance: instance(2, 'Alpha', 'sonarr') },
      snapshot(3, 'Beta'),
    ];
    expect(sortSnapshots(mixed).map((entry) => entry.instance.name)).toEqual([
      'Beta',
      'Zeta',
      'Alpha',
    ]);
  });
});

describe('root folder topology', () => {
  const fleet = [
    snapshot(1, 'Radarr-4K', {
      rootFolders: [rootFolder(1, '/data/media/movies'), rootFolder(2, '/data/media/movies-4k')],
    }),
    snapshot(2, 'Radarr-HD', { rootFolders: [rootFolder(5, '/media/movies')] }),
    snapshot(3, 'Sonarr', { rootFolders: [rootFolder(8, '/data/media/tv', false)] }),
  ];

  it('rows are one per distinct path with parity per instance', () => {
    const rows = buildRootFolderRows(fleet);
    expect(rows.map((row) => row.path)).toEqual([
      '/data/media/movies',
      '/data/media/movies-4k',
      '/data/media/tv',
      '/media/movies',
    ]);
    expect(rows[0]?.parity).toBe('unique');
    expect(rows[0]?.missingOn).toEqual([2, 3]);
  });

  it('surfaces inaccessible folders', () => {
    const row = buildRootFolderRows(fleet).find((entry) => entry.path === '/data/media/tv');
    expect(row?.inaccessibleOn).toEqual([3]);
  });

  it('detects sibling instances disagreeing on a mount point', () => {
    const discrepancies = findPathDiscrepancies(buildRootFolderRows(fleet));
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]?.leaf).toBe('movies');
    expect(discrepancies[0]?.variants.map((variant) => variant.path)).toEqual([
      '/data/media/movies',
      '/media/movies',
    ]);
  });

  it('does not flag one instance that deliberately holds both variants', () => {
    const deliberate = [
      snapshot(1, 'Radarr', {
        rootFolders: [rootFolder(1, '/data/movies'), rootFolder(2, '/tank/movies')],
      }),
      snapshot(2, 'Radarr-2', { rootFolders: [rootFolder(3, '/data/movies')] }),
    ];
    expect(findPathDiscrepancies(buildRootFolderRows(deliberate))).toEqual([]);
  });
});

describe('import list fleet', () => {
  it('matches lists by name and flags setting drift', () => {
    const rows = buildImportListRows([
      snapshot(1, 'Radarr-4K', {
        importLists: [importList(1, 'Trakt watchlist', { rootFolderPath: '/data/media/movies-4k' })],
      }),
      snapshot(2, 'Radarr-HD', {
        importLists: [
          importList(4, 'trakt watchlist', { rootFolderPath: '/media/movies', enabled: false }),
        ],
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.parity).toBe('full');
    expect(rows[0]?.rootFolderDrift).toBe(true);
    expect(rows[0]?.enabledDrift).toBe(true);
    expect(rows[0]?.qualityProfileDrift).toBe(false);
  });

  it('reads the auto-add flag from either flavour of the field', () => {
    const rows = buildImportListRows([
      snapshot(1, 'Radarr', { importLists: [importList(1, 'A', { enableAuto: true })] }),
      snapshot(2, 'Sonarr', { importLists: [importList(2, 'A', { enableAutomaticAdd: true })] }),
    ]);
    expect(rows[0]?.cells.map((cell) => cell.autoAdd)).toEqual([true, true]);
  });
});

describe('find and replace', () => {
  const fleet = [
    snapshot(1, 'Radarr-4K', { tags: [tag(1, '4k-remux'), tag(2, '4k-web')] }),
    snapshot(2, 'Radarr-HD', { tags: [tag(5, '4k-remux'), tag(6, 'uhd-web')] }),
  ];

  it('previews one rename per matching tag per instance', () => {
    const previews = previewFindReplace(fleet, '4k-', 'uhd-');
    expect(previews).toEqual([
      { instanceId: 1, tagId: 1, from: '4k-remux', to: 'uhd-remux' },
      { instanceId: 1, tagId: 2, from: '4k-web', to: 'uhd-web' },
      { instanceId: 2, tagId: 5, from: '4k-remux', to: 'uhd-remux' },
    ]);
  });

  it('honours case sensitivity and instance scoping', () => {
    expect(previewFindReplace(fleet, '4K-', 'uhd-', { caseSensitive: true })).toEqual([]);
    expect(previewFindReplace(fleet, '4k-', 'uhd-', { instanceIds: [2] })).toHaveLength(1);
  });

  it('escapes regex metacharacters in the search term', () => {
    const dotted = [snapshot(1, 'Radarr', { tags: [tag(1, 'a.b'), tag(2, 'axb')] })];
    const previews = previewFindReplace(dotted, 'a.b', 'ok');
    expect(previews.map((preview) => preview.from)).toEqual(['a.b']);
  });

  it('finds renames that would collide with an existing tag', () => {
    const previews = previewFindReplace(fleet, '4k-web', 'uhd-web');
    const collisions = findCollisions(fleet, previews);
    // Instance 1 has no uhd-web, instance 2 does - but only instance 1 matched.
    expect(collisions.size).toBe(0);

    const acrossFleet = findCollisions(fleet, [{ instanceId: 2, to: 'uhd-web' }]);
    expect(acrossFleet.get('2|uhd-web')).toBe(6);
  });
});
