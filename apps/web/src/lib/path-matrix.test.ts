import type {
  PathFlag,
  PathInstanceCell,
  PathMatrixColumn,
  PathMatrixLevel,
  PathNode,
  PathRole,
  PathRollup,
} from '@arrranger/shared';
import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  cellFor,
  flattenLevels,
  levelKey,
  needsRollupRow,
  rollupChips,
  rootFolderTargets,
  TOP_LEVEL,
  trackedBy,
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
    ...overrides,
  };
}

function cell(instanceId: number, role: PathRole, overrides: Partial<PathInstanceCell> = {}): PathInstanceCell {
  return {
    instanceId,
    known: role !== 'unknown',
    role,
    rootFolderId: role === 'rootFolder' ? instanceId * 10 : null,
    accessible: role === 'rootFolder' ? true : null,
    freeSpace: role === 'rootFolder' ? 1024 : null,
    totalSpace: role === 'rootFolder' ? 2048 : null,
    mediaUnder: role === 'tracked' || role === 'ancestor' ? 1 : 0,
    title: role === 'tracked' ? 'A Title' : null,
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
    sizeOnDisk: null,
    error: null,
    cells: [],
    flags: [],
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

  it('survives a level that points back at itself', () => {
    const looped = { '/a': level('/a', [node('/a')]) };
    const rows = flattenLevels({ levels: looped, expanded: ['/a'], focus: '/a' });
    expect(rows.length).toBeLessThan(5);
  });
});

describe('the big-folder rollup row', () => {
  /** 812 entries, only the 6 that need attention returned - the whole point. */
  const library = level('/data/media/movies', [node('/data/media/movies/Orphan (1999)')], {
    selection: ['problems'],
    rollup: rollup({ entries: 812, tracked: 806, untracked: 4, missing: 2, mediaUnder: 806 }),
    matched: 6,
    truncated: true,
  });

  const levels = {
    [TOP_LEVEL]: level(null, [node('/data/media/movies')]),
    '/data/media/movies': library,
  };

  it('adds exactly one summary row under the expanded level, not 812 rows', () => {
    const rows = flattenLevels({ levels, expanded: ['/data/media/movies'], focus: null });

    expect(rows.filter((row) => row.kind === 'node')).toHaveLength(2);
    const summaries = rows.filter((row) => row.kind === 'rollup');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.level?.rollup.entries).toBe(812);
  });

  it('summarises a level whose selector hid rows, even when nothing was truncated', () => {
    expect(
      needsRollupRow(level('/x', [], { matched: 4, rollup: rollup({ entries: 812 }) })),
    ).toBe(true);
  });

  it('does not summarise a level that is showing everything', () => {
    expect(needsRollupRow(level('/x', [node('/x/a')]))).toBe(false);
  });

  it('states the real totals, and omits counts the server never evaluated', () => {
    const chips = rollupChips(library);
    expect(chips.map((chip) => [chip.label, chip.count])).toEqual([
      ['tracked', 806],
      ['untracked', 4],
      ['missing', 2],
    ]);
    // empty/unreadable are null here: not checked. Rendering them as 0 would be a lie.
    expect(chips.some((chip) => chip.label === 'empty')).toBe(false);
  });

  it('shows evaluated zero-free counts once the server resolved them', () => {
    const probed = level('/x', [], {
      rollup: rollup({ entries: 10, tracked: 8, empty: 2, unreadable: 0 }),
    });
    expect(rollupChips(probed).map((chip) => chip.label)).toEqual(['tracked', 'empty']);
  });
});

describe('cellFor', () => {
  it('finds the cell for an instance', () => {
    const target = node('/data', { cells: [cell(1, 'rootFolder'), cell(2, 'outside')] });
    expect(cellFor(target, 2).role).toBe('outside');
  });

  it('is unknown for an instance the response never mentioned', () => {
    const target = node('/data', { cells: [cell(1, 'rootFolder')] });
    const missing = cellFor(target, 99);

    expect(missing.known).toBe(false);
    expect(missing.role).toBe('unknown');
  });
});

describe('actionsFor', () => {
  const targets = [1, 2];

  const flagged = (path: string, flags: PathFlag[], cells: PathInstanceCell[]): PathNode =>
    node(path, { flags, cells });

  it('offers the root-folder actions on a root folder that holds media', () => {
    const target = flagged('/data/media/movies', ['rootFolder'], [
      cell(1, 'rootFolder', { mediaUnder: 806 }),
      cell(2, 'outside'),
    ]);

    expect(actionsFor(target, targets)).toEqual(
      expect.arrayContaining(['propagate', 'remove', 'remap', 'reconcile']),
    );
  });

  it('offers the disk actions on a folder nobody roots', () => {
    const target = flagged('/data/media/old-movies', ['candidate'], [cell(1, 'outside'), cell(2, 'outside')]);
    const actions = actionsFor(target, targets);

    expect(actions).toEqual(expect.arrayContaining(['propagate', 'rename', 'move', 'prune']));
    expect(actions).not.toContain('remove');
    expect(actions).not.toContain('remap');
  });

  it('never offers a prune that would cost an instance its media', () => {
    const tracked = flagged('/data/media/movies/Dune (2021)', ['rootFolder'], [
      cell(1, 'tracked', { mediaUnder: 1 }),
    ]);
    expect(actionsFor(tracked, targets)).not.toContain('prune');
  });

  it('offers align on a tracked media folder, but not a re-map', () => {
    const target = flagged('/data/media/movies/Dune (2021)', [], [cell(1, 'tracked')]);
    const actions = actionsFor(target, targets);

    expect(actions).toContain('reconcile');
    expect(actions).toContain('rename');
    expect(actions).not.toContain('remap');
  });

  it('never offers a disk action on a mount', () => {
    const mount = flagged('/data', ['mount'], [cell(1, 'ancestor')]);
    const actions = actionsFor(mount, targets);

    expect(actions).not.toContain('rename');
    expect(actions).not.toContain('move');
    expect(actions).not.toContain('prune');
    expect(actions).toContain('mkdir');
  });

  it('offers creating the folder for a path only *Arr believes in', () => {
    const missing = node('/data/media/movies/Gone (2001)', {
      exists: false,
      origin: 'arr',
      flags: ['missing'],
      cells: [cell(1, 'tracked')],
    });

    expect(actionsFor(missing, targets)).toContain('mkdir');
    expect(actionsFor(missing, targets)).not.toContain('prune');
  });

  it('offers only removal for a root folder this container cannot see', () => {
    const unseen = node('/elsewhere/movies', {
      exists: false,
      inScope: false,
      origin: 'arr',
      flags: ['rootFolder', 'unseen'],
      cells: [cell(1, 'rootFolder')],
    });

    expect(actionsFor(unseen, targets)).toEqual(['remove']);
  });

  it('skips instances outside the current target selection', () => {
    const target = flagged('/data/media/movies', ['rootFolder'], [
      cell(1, 'rootFolder'),
      cell(2, 'outside'),
    ]);

    // Targeting only instance 1: there is no gap to propagate into.
    expect(actionsFor(target, [1])).not.toContain('propagate');
    expect(rootFolderTargets(target, [1])).toEqual([
      { instanceId: 1, rootFolderId: 10, path: '/data/media/movies' },
    ]);
  });
});

describe('trackedBy', () => {
  it('names the instances that would lose media, with counts', () => {
    const target = node('/data/media/movies', {
      cells: [cell(1, 'rootFolder', { mediaUnder: 806 }), cell(2, 'outside')],
    });

    expect(trackedBy(target, [column(1, { name: 'Radarr-4K' }), column(2)])).toEqual([
      { instanceId: 1, name: 'Radarr-4K', mediaCount: 806 },
    ]);
  });
});

describe('levelKey', () => {
  it('maps the synthetic top level to a stable key', () => {
    expect(levelKey(null)).toBe(TOP_LEVEL);
    expect(levelKey('/data')).toBe('/data');
  });
});
