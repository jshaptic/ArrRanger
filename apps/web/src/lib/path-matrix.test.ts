import type {
  PathFlag,
  PathMatrixColumn,
  PathMatrixLevel,
  PathNode,
  PathOwner,
  PathRollup,
  PathUse,
} from '@arrranger/shared';
import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  flattenLeaves,
  flattenLevels,
  levelKey,
  mediaSummary,
  ownerFacts,
  ownerHeadline,
  ownerMedia,
  rootFolderTargets,
  SEVERITY_STYLES,
  TOP_LEVEL,
  trackedBy,
  unknownColumns,
  worstSeverity,
} from './path-matrix';

function rollup(overrides: Partial<PathRollup> = {}): PathRollup {
  return {
    entries: 0,
    tracked: 0,
    untracked: 0,
    neutral: 0,
    missing: 0,
    rootFolders: 0,
    candidates: 0,
    symlinks: 0,
    empty: null,
    unreadable: null,
    mediaUnder: 0,
    severity: 'ok',
    ...overrides,
  };
}

function owner(instanceId: number, use: PathUse, overrides: Partial<PathOwner> = {}): PathOwner {
  return {
    instanceId,
    name: `instance ${String(instanceId)}`,
    kind: 'radarr',
    use,
    rootFolderId: use === 'rootFolder' ? instanceId * 10 : null,
    accessible: use === 'rootFolder' ? true : null,
    mediaUnder: use === 'rootFolder' ? 0 : 1,
    mediaWithFiles: use === 'rootFolder' ? 0 : 1,
    title: use === 'tracked' ? 'A Title' : null,
    rootFoldersUnder: use === 'containsRoot' ? ['/data/media/movies'] : [],
    importLists: [],
    freeSpace: use === 'rootFolder' ? 1_000_000_000 : null,
    totalSpace: use === 'rootFolder' ? 4_000_000_000 : null,
    ...overrides,
  };
}

function node(path: string, overrides: Partial<PathNode> = {}): PathNode {
  return {
    path,
    name: path.split('/').filter(Boolean).at(-1) ?? path,
    origin: 'disk',
    exists: true,
    kind: 'directory',
    inScope: true,
    modifiedAt: null,
    childCount: 3,
    readable: true,
    writable: true,
    deviceId: '1',
    freeSpace: null,
    totalSpace: null,
    lowSpace: false,
    sizeOnDisk: null,
    error: null,
    owners: [],
    flags: [],
    severity: 'ok',
    canAddRootFolder: true,
    rollup: null,
    expandable: true,
    ...overrides,
  };
}

function level(path: string | null, nodes: PathNode[], overrides: Partial<PathMatrixLevel> = {}): PathMatrixLevel {
  return {
    path,
    parent: null,
    nodes,
    rollup: rollup({ entries: nodes.length }),
    selection: ['all'],
    matched: nodes.length,
    offset: 0,
    limit: 200,
    truncated: false,
    childCountsResolved: true,
    error: null,
    ...overrides,
  };
}

function column(instanceId: number, overrides: Partial<PathMatrixColumn> = {}): PathMatrixColumn {
  return {
    instanceId,
    name: `instance ${String(instanceId)}`,
    kind: 'radarr',
    reachable: true,
    error: null,
    fetchedAt: null,
    rootFolderCount: 1,
    mediaPathCount: 0,
    unseenRootFolders: [],
    ...overrides,
  };
}

describe('flattenLevels', () => {
  const levels = {
    [TOP_LEVEL]: level(null, [node('/data')]),
    '/data': level('/data', [node('/data/media'), node('/data/other')]),
    '/data/media': level('/data/media', [node('/data/media/movies')]),
  };

  it('walks depth-first and indents by depth', () => {
    const rows = flattenLevels({ levels, expanded: ['/data', '/data/media'], focus: null });

    expect(rows.map((row) => [row.node?.path, row.depth])).toEqual([
      ['/data', 0],
      ['/data/media', 1],
      ['/data/media/movies', 2],
      ['/data/other', 1],
    ]);
  });

  it('hides a subtree that is not expanded', () => {
    const rows = flattenLevels({ levels, expanded: ['/data'], focus: null });
    expect(rows.map((row) => row.node?.path)).toEqual(['/data', '/data/media', '/data/other']);
  });

  it('does not expand a node whose level has not been fetched yet', () => {
    const rows = flattenLevels({ levels: { [TOP_LEVEL]: levels[TOP_LEVEL] }, expanded: ['/data'], focus: null });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.expanded).toBe(false);
    expect(rows[0]?.hasLevel).toBe(false);
  });

  it('re-roots at the focused path', () => {
    const rows = flattenLevels({ levels, expanded: ['/data/media'], focus: '/data/media' });

    expect(rows.map((row) => [row.node?.path, row.depth])).toEqual([['/data/media/movies', 0]]);
  });

  it('returns nothing when the focused level is not loaded', () => {
    expect(flattenLevels({ levels, expanded: [], focus: '/nowhere' })).toEqual([]);
  });

  it('carries the worst severity inside a node, so a collapsed row can warn', () => {
    const withProblem = {
      [TOP_LEVEL]: level(null, [node('/data')]),
      '/data': level('/data', [node('/data/media')], { rollup: rollup({ severity: 'error' }) }),
    };
    const rows = flattenLevels({ levels: withProblem, expanded: [], focus: null });

    // /data is collapsed, but its level is loaded and holds something broken.
    expect(rows[0]?.childSeverity).toBe('error');
  });

  it('reports no child severity for a node whose level was never fetched', () => {
    // "Nothing fetched" is not "nothing wrong" - the row must not claim it is clean.
    const rows = flattenLevels({
      levels: { [TOP_LEVEL]: level(null, [node('/data')]) },
      expanded: [],
      focus: null,
    });

    expect(rows[0]?.childSeverity).toBeNull();
  });

  it('survives a level that points back at itself', () => {
    const looped = { '/a': level('/a', [node('/a')]) };
    const rows = flattenLevels({ levels: looped, expanded: ['/a'], focus: '/a' });
    expect(rows.length).toBeLessThan(5);
  });

  it('never shows a plain file - this view manages folders, not media files', () => {
    const withAFile = {
      [TOP_LEVEL]: level(null, [node('/data')]),
      '/data': level('/data', [
        node('/data/media'),
        node('/data/movie.mkv', { kind: 'file', expandable: false }),
      ]),
    };
    const rows = flattenLevels({ levels: withAFile, expanded: ['/data'], focus: null });

    expect(rows.map((row) => row.node?.path)).toEqual(['/data', '/data/media']);
  });
});

describe('flattenLeaves', () => {
  const levels = {
    [TOP_LEVEL]: level(null, [node('/data')]),
    '/data': level('/data', [
      node('/data/media'),
      node('/data/other', { expandable: false }),
    ]),
    '/data/media': level('/data/media', [node('/data/media/movies', { expandable: false })]),
  };

  it('lists only the leaves, flat, in path order', () => {
    const rows = flattenLeaves({ levels, expanded: [], focus: null });

    expect(rows.map((row) => [row.node?.path, row.depth])).toEqual([
      ['/data/media/movies', 0],
      ['/data/other', 0],
    ]);
  });

  it('drops files and other non-directories - this is a folder list', () => {
    const withAFile = {
      ...levels,
      '/data': level('/data', [
        node('/data/media'),
        node('/data/other', { expandable: false }),
        node('/data/movie.mkv', { kind: 'file', expandable: false }),
        node('/data/link', { kind: 'symlink', expandable: false }),
      ]),
    };
    const rows = flattenLeaves({ levels: withAFile, expanded: [], focus: null });

    expect(rows.map((row) => row.node?.path)).toEqual(['/data/media/movies', '/data/other']);
  });

  it('ignores the expanded set entirely - it walks every fetched level regardless', () => {
    const withoutExpanded = flattenLeaves({ levels, expanded: [], focus: null });
    const withExpanded = flattenLeaves({ levels, expanded: ['/data', '/data/media'], focus: null });
    expect(withoutExpanded).toEqual(withExpanded);
  });

  it('re-roots at the focused path, same as flattenLevels', () => {
    const rows = flattenLeaves({ levels, expanded: [], focus: '/data/media' });
    expect(rows.map((row) => row.node?.path)).toEqual(['/data/media/movies']);
  });

  it('falls back to showing an unfetched expandable node rather than dropping it', () => {
    const partial = { [TOP_LEVEL]: level(null, [node('/data')]) };
    const rows = flattenLeaves({ levels: partial, expanded: [], focus: null });
    expect(rows.map((row) => row.node?.path)).toEqual(['/data']);
  });

  it('keeps a folder that holds only files - it is the deepest folder, not a branch', () => {
    // The real case this got wrong: /data/media/onepiece holds 172 episode files and no
    // subfolder. The server calls it expandable (it has entries), so walking into it and
    // then dropping its files left the folder itself with no row at all.
    const withEpisodes = {
      [TOP_LEVEL]: level(null, [node('/data')]),
      '/data': level('/data', [node('/data/onepiece')]),
      '/data/onepiece': level('/data/onepiece', [
        node('/data/onepiece/ep01.mp4', { kind: 'file', expandable: false }),
        node('/data/onepiece/ep02.mp4', { kind: 'file', expandable: false }),
      ]),
    };
    const rows = flattenLeaves({ levels: withEpisodes, expanded: [], focus: null });

    expect(rows.map((row) => row.node?.path)).toEqual(['/data/onepiece']);
  });

  it('walks past a folder that holds subfolders, even when it also holds files', () => {
    const mixed = {
      [TOP_LEVEL]: level(null, [node('/data')]),
      '/data': level('/data', [node('/data/media')]),
      '/data/media': level('/data/media', [
        node('/data/media/movies'),
        node('/data/media/stray.mkv', { kind: 'file', expandable: false }),
      ]),
      '/data/media/movies': level('/data/media/movies', [
        node('/data/media/movies/film.mkv', { kind: 'file', expandable: false }),
      ]),
    };
    const rows = flattenLeaves({ levels: mixed, expanded: [], focus: null });

    expect(rows.map((row) => row.node?.path)).toEqual(['/data/media/movies']);
  });

  it('survives a level that points back at itself', () => {
    const looped = { '/a': level('/a', [node('/a')]) };
    expect(flattenLeaves({ levels: looped, expanded: [], focus: '/a' }).length).toBeLessThan(5);
  });
});

describe('actionsFor', () => {
  const flagged = (path: string, flags: PathFlag[], owners: PathOwner[]): PathNode =>
    node(path, { flags, owners, canAddRootFolder: false });

  it('offers the root-folder actions on a root folder that holds media', () => {
    const target = flagged('/data/media/movies', ['rootFolder'], [
      owner(1, 'rootFolder', { mediaUnder: 806 }),
    ]);

    expect(actionsFor(target)).toEqual(
      expect.arrayContaining(['remove', 'remap', 'rename']),
    );
  });

  it('offers the disk actions on a folder nobody roots', () => {
    const target = node('/data/media/old-movies', { flags: ['candidate'], owners: [] });
    const actions = actionsFor(target);

    expect(actions).toEqual(expect.arrayContaining(['addRoot', 'rename', 'move', 'prune']));
    expect(actions).not.toContain('remove');
    expect(actions).not.toContain('remap');
  });

  it('offers addRoot only when the server says the path could take one', () => {
    // The server owns this decision: it is the only side that knows every instance's
    // root folders, and the old client-side version needed a target selection to guess.
    const already = node('/data/media/movies', {
      flags: ['rootFolder'],
      owners: [owner(1, 'rootFolder')],
      canAddRootFolder: false,
    });
    expect(actionsFor(already)).not.toContain('addRoot');
    expect(actionsFor(node('/data/media/spare', { canAddRootFolder: true }))).toContain('addRoot');
  });

  it('never offers a prune that would cost an instance its media', () => {
    const tracked = flagged('/data/media/movies/Dune (2021)', [], [
      owner(1, 'tracked', { mediaUnder: 1 }),
    ]);
    expect(actionsFor(tracked)).not.toContain('prune');
  });

  it('never prunes the parent of a root folder, even one with nothing in it yet', () => {
    // No media anywhere below, so the media-only rule called this safe to delete - and it
    // would have taken a configured root folder with it.
    const target = node('/data/media', {
      owners: [owner(1, 'containsRoot', { mediaUnder: 0, rootFoldersUnder: ['/data/media/tv'] })],
    });

    expect(actionsFor(target)).not.toContain('prune');
  });

  it('prunes a folder no owner holds media under - an unreachable instance is not an owner', () => {
    // The old check was `cells.every(c => !c.known || c.mediaUnder === 0)`. An instance
    // that did not answer is absent from `owners` entirely, so it reaches the same answer.
    expect(actionsFor(node('/data/media/spare', { owners: [] }))).toContain('prune');
  });

  // Align is not a second row action any more: renaming a root folder offers the instances
  // rooting at it inside the one dialog. A media folder has none, so it gets a plain rename
  // - which is exactly what it could ever have had.
  it('offers a plain rename on a tracked media folder, and no re-map', () => {
    const target = flagged('/data/media/movies/Dune (2021)', [], [owner(1, 'tracked')]);
    const actions = actionsFor(target);

    expect(actions).toContain('rename');
    expect(actions).not.toContain('remap');
  });

  it('never offers a disk action on a mount', () => {
    const mount = flagged('/data', ['mount'], [owner(1, 'ancestor')]);
    const actions = actionsFor(mount);

    expect(actions).not.toContain('rename');
    expect(actions).not.toContain('move');
    expect(actions).not.toContain('prune');
  });

  // Creating folders left the row entirely - it is one toolbar button taking mkdir syntax,
  // see `planNewFolders`. A path only *Arr believes in has nothing on disk to act on at
  // all: it is not a root folder, so there is no re-map, and there is no folder to rename.
  it('offers no action at all on a path only *Arr believes in', () => {
    const missing = node('/data/media/movies/Gone (2001)', {
      exists: false,
      origin: 'arr',
      flags: ['missing'],
      owners: [owner(1, 'tracked')],
      canAddRootFolder: false,
    });

    expect(actionsFor(missing)).toEqual([]);
  });

  it('offers only removal for a root folder this container cannot see', () => {
    const unseen = node('/elsewhere/movies', {
      exists: false,
      inScope: false,
      origin: 'arr',
      flags: ['rootFolder', 'unseen'],
      owners: [owner(1, 'rootFolder')],
      canAddRootFolder: false,
    });

    expect(actionsFor(unseen)).toEqual(['remove']);
  });
});

describe('rootFolderTargets', () => {
  it('takes its instances from the folder own owners, not from a selection', () => {
    const shared = node('/data/media/movies', {
      flags: ['rootFolder'],
      owners: [owner(1, 'rootFolder'), owner(2, 'rootFolder')],
    });

    expect(rootFolderTargets(shared)).toEqual([
      { instanceId: 1, rootFolderId: 10, path: '/data/media/movies' },
      { instanceId: 2, rootFolderId: 20, path: '/data/media/movies' },
    ]);
  });

  it('ignores an owner that merely holds media here', () => {
    const target = node('/data/media/old-movies', { owners: [owner(1, 'ancestor')] });
    expect(rootFolderTargets(target)).toEqual([]);
  });
});

describe('trackedBy', () => {
  it('names the instances that would lose media, with counts', () => {
    const target = node('/data/media/movies', {
      owners: [owner(1, 'rootFolder', { name: 'Radarr-4K', mediaUnder: 806 })],
    });

    // No column list to join against any more - the owner carries its own name.
    expect(trackedBy(target)).toEqual([{ instanceId: 1, name: 'Radarr-4K', mediaCount: 806 }]);
  });

  it('says nothing about a folder no instance holds media under', () => {
    expect(trackedBy(node('/data/media/spare', { owners: [] }))).toEqual([]);
  });
});

describe('severity', () => {
  it('is silent for ok and info - a glyph on every row would be noise', () => {
    expect(SEVERITY_STYLES.ok).toBeNull();
    expect(SEVERITY_STYLES.info).toBeNull();
    expect(SEVERITY_STYLES.warn?.classes).toContain('drift');
    expect(SEVERITY_STYLES.error?.classes).toContain('danger');
  });

  it('takes the worst of a set, in order', () => {
    expect(worstSeverity(['ok', 'info', 'warn'])).toBe('warn');
    expect(worstSeverity(['warn', 'error', 'info'])).toBe('error');
    expect(worstSeverity([])).toBe('ok');
    expect(worstSeverity(['ok'])).toBe('ok');
  });
});

describe('unknownColumns', () => {
  it('names the instances that did not answer, so an empty row is not read as "nobody"', () => {
    const columns = [column(1), column(2, { reachable: false, error: 'unreachable' })];
    expect(unknownColumns(columns).map((entry) => entry.instanceId)).toEqual([2]);
  });

  it('is empty when the whole fleet answered', () => {
    expect(unknownColumns([column(1), column(2)])).toEqual([]);
  });
});

describe('mediaSummary', () => {
  it('names the item when exactly one instance tracks one at this path', () => {
    const target = node('/data/media/movies/Dune (2021)', {
      owners: [owner(1, 'tracked', { title: 'Dune', mediaUnder: 1 })],
    });
    expect(mediaSummary(target)?.label).toBe('Dune');
  });

  it('sums across owners, and breaks the sum down in the detail', () => {
    // A 4K/HD split counts the same films twice; neither number alone is the truth, so
    // the total leads and the tooltip says who contributed what.
    const target = node('/data/media/movies', {
      owners: [
        owner(1, 'rootFolder', { name: 'Radarr', mediaUnder: 384 }),
        owner(2, 'rootFolder', { name: 'Radarr-4K', mediaUnder: 112 }),
      ],
    });

    const summary = mediaSummary(target);
    expect(summary?.label).toBe('496');
    expect(summary?.detail).toContain('Radarr: 384 item(s)');
    expect(summary?.detail).toContain('Radarr-4K: 112 item(s)');
  });

  it('says nothing for a folder nobody uses', () => {
    expect(mediaSummary(node('/data/media/spare', { owners: [] }))).toBeNull();
  });
});

describe('levelKey', () => {
  it('maps the synthetic top level to a stable key', () => {
    expect(levelKey(null)).toBe(TOP_LEVEL);
    expect(levelKey('/data')).toBe('/data');
  });
});

describe('the owner card', () => {
  it('names the claim, and counts the one that begs a number', () => {
    expect(ownerHeadline(owner(1, 'rootFolder'))).toBe('root folder here');
    expect(ownerHeadline(owner(1, 'rootFolder', { accessible: false }))).toContain('cannot see it');
    expect(ownerHeadline(owner(1, 'tracked'))).toContain('A Title');
    expect(ownerHeadline(owner(1, 'ancestor'))).toBe('holds media below this folder');
    expect(
      ownerHeadline(owner(1, 'containsRoot', { rootFoldersUnder: ['/a/x', '/a/y'] })),
    ).toBe('2 root folders below this one');
  });

  it('puts one number on the chip: this instance share of the folder, zero included', () => {
    expect(ownerMedia(owner(1, 'ancestor', { mediaUnder: 806 })).value).toBe(806);

    // A bare chip could not tell "tracks nothing here" from "we did not count".
    const empty = ownerMedia(owner(1, 'containsRoot', { mediaUnder: 0 }));
    expect(empty.value).toBe(0);
    expect(empty.title).toContain('nothing tracked');
  });

  it('separates what is tracked from what is on disk', () => {
    const facts = ownerFacts(
      owner(1, 'rootFolder', { mediaUnder: 812, mediaWithFiles: 806 }),
      '/data/media/movies',
    );
    const media = facts.find((fact) => fact.label === 'Media');

    expect(media?.value).toBe('812 items at or under here');
    expect(media?.detail).toEqual(['806 on disk', '6 monitored, not downloaded']);
  });

  it('leaves root folders below to the headline, which already counts them', () => {
    const target = owner(1, 'containsRoot', { rootFoldersUnder: ['/data/media/tv'] });

    expect(ownerHeadline(target)).toBe('1 root folder below this one');
    // Stating it twice in one card is duplication, not emphasis.
    expect(ownerFacts(target, '/data/media').map((fact) => fact.label)).toEqual([
      'Media',
      'Import lists',
    ]);
  });

  it('names every list, and says where the ones aimed below land', () => {
    const facts = ownerFacts(
      owner(1, 'containsRoot', {
        rootFoldersUnder: ['/data/media/tv'],
        importLists: [
          { id: 1, name: 'Trakt watchlist', enabled: true, automatic: true, path: '/data/media' },
          { id: 2, name: 'Series watchlist', enabled: true, automatic: false, path: '/data/media/tv' },
          { id: 3, name: 'Stalled', enabled: false, automatic: false, path: '/data/media/tv' },
        ],
      }),
      '/data/media',
    );
    const lists = facts.find((fact) => fact.label === 'Import lists');

    expect(lists?.value).toBe('1 list adds here, 2 below');
    expect(lists?.detail).toEqual([
      'Trakt watchlist - adds automatically',
      // Prefixed with the folder it fills, said relative to the one being read.
      'tv: Series watchlist - manual add',
      'tv: Stalled - disabled',
    ]);
  });

  it('states the import lists even when there are none, and flags an orphaned one', () => {
    const quiet = ownerFacts(owner(1, 'rootFolder'), '/data/media/movies');
    expect(quiet.find((fact) => fact.label === 'Import lists')).toMatchObject({
      value: 'none point here',
      tone: 'muted',
    });

    // A list filling a folder its own instance does not root at is a question, not a fact.
    const orphan = ownerFacts(
      owner(1, 'importList', {
        mediaUnder: 0,
        importLists: [
          { id: 2, name: 'Stalled', enabled: false, automatic: false, path: '/data/inbox' },
        ],
      }),
      '/data/inbox',
    );
    expect(orphan.find((fact) => fact.label === 'Import lists')).toMatchObject({
      value: '1 list adds here',
      detail: ['Stalled - disabled'],
      tone: 'warn',
    });
  });

  it('reports the free space the instance sees, which is not this container statfs', () => {
    const facts = ownerFacts(owner(1, 'rootFolder'), '/data/media/movies');
    const root = facts.find((fact) => fact.label === 'Root folder');

    expect(root?.value).toBe('here');
    expect(root?.detail[0]).toContain('as this instance sees it');
    // A folder nobody roots at has no root folder fact at all.
    expect(ownerFacts(owner(1, 'ancestor'), '/data/media').some((f) => f.label === 'Root folder')).toBe(
      false,
    );
  });
});
