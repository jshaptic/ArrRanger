import type { ArrImportList, ArrRootFolder, ArrTagDetail, Instance } from '@arrranger/shared';

/**
 * Fleet normalisation.
 *
 * Everything here is pure: instance snapshots in, comparison rows out. The views never
 * reason about a "current instance" - they render rows whose cells are aligned with the
 * fleet's column order, so parity, drift and gaps are visible in one pass.
 */

export type SnapshotStatus = 'loading' | 'ok' | 'error';

export interface InstanceSnapshot {
  readonly instance: Instance;
  readonly status: SnapshotStatus;
  readonly fetchedAt: string | null;
  readonly error: string | null;
  readonly tags: readonly ArrTagDetail[];
  readonly rootFolders: readonly ArrRootFolder[];
  readonly importLists: readonly ArrImportList[];
}

/** `full` = on every healthy instance, `unique` = on exactly one, `partial` = drift. */
export type ParityState = 'full' | 'partial' | 'unique';

export interface TagCell {
  readonly instanceId: number;
  /** False when the instance did not answer: unknown, not "missing". */
  readonly known: boolean;
  readonly present: boolean;
  readonly tagId: number | null;
  readonly mediaCount: number;
  /** Indexers, import lists, notifications, restrictions, delay profiles. */
  readonly otherUses: number;
}

export interface TagMatrixRow {
  readonly label: string;
  readonly cells: readonly TagCell[];
  readonly presentOn: readonly number[];
  readonly missingOn: readonly number[];
  readonly parity: ParityState;
  readonly totalMedia: number;
  /** Exists somewhere but attached to nothing anywhere - a deletion candidate. */
  readonly unusedEverywhere: boolean;
}

export interface RootFolderCell {
  readonly instanceId: number;
  readonly known: boolean;
  readonly present: boolean;
  readonly rootFolderId: number | null;
  readonly accessible: boolean;
  readonly freeSpace: number | null;
  readonly totalSpace: number | null;
}

export interface RootFolderRow {
  readonly path: string;
  readonly leaf: string;
  readonly cells: readonly RootFolderCell[];
  readonly presentOn: readonly number[];
  readonly missingOn: readonly number[];
  readonly inaccessibleOn: readonly number[];
  readonly parity: ParityState;
}

/**
 * Sibling instances that disagree about where the same kind of library lives -
 * `/data/media/movies` on one, `/media/movies` on another. Detected by grouping paths on
 * their last segment and flagging groups no single instance holds completely.
 */
export interface PathDiscrepancy {
  readonly leaf: string;
  readonly variants: ReadonlyArray<{
    readonly path: string;
    readonly instanceIds: readonly number[];
  }>;
}

export interface ImportListCell {
  readonly instanceId: number;
  readonly known: boolean;
  readonly present: boolean;
  readonly listId: number | null;
  readonly enabled: boolean;
  readonly autoAdd: boolean;
  readonly rootFolderPath: string;
  readonly qualityProfileId: number;
}

export interface ImportListRow {
  readonly key: string;
  readonly name: string;
  readonly implementation: string;
  readonly cells: readonly ImportListCell[];
  readonly presentOn: readonly number[];
  readonly missingOn: readonly number[];
  readonly parity: ParityState;
  /** More than one distinct value across the fleet means the setting has drifted. */
  readonly rootFolderDrift: boolean;
  readonly qualityProfileDrift: boolean;
  readonly enabledDrift: boolean;
}

export interface FleetStats {
  readonly instances: number;
  readonly healthy: number;
  readonly failing: number;
  readonly tagsTotal: number;
  readonly tagsInSync: number;
  readonly tagsDrifted: number;
  readonly rootFoldersTotal: number;
  readonly rootFoldersInSync: number;
  readonly rootFoldersDrifted: number;
  readonly rootFoldersInaccessible: number;
  readonly pathDiscrepancies: number;
}

/** Stable column order: Radarr instances first, then Sonarr, alphabetical within a kind. */
export function sortSnapshots(snapshots: readonly InstanceSnapshot[]): InstanceSnapshot[] {
  return [...snapshots].sort((a, b) => {
    if (a.instance.kind !== b.instance.kind) return a.instance.kind === 'radarr' ? -1 : 1;
    return a.instance.name.localeCompare(b.instance.name, 'en');
  });
}

/** Only instances that answered can be compared - a failed one is "unknown", not "missing". */
function comparable(snapshots: readonly InstanceSnapshot[]): InstanceSnapshot[] {
  return snapshots.filter((snapshot) => snapshot.status === 'ok');
}

function parityOf(presentCount: number, comparableCount: number): ParityState {
  if (comparableCount > 0 && presentCount >= comparableCount) return 'full';
  if (presentCount <= 1) return 'unique';
  return 'partial';
}

function attachedMediaCount(tag: ArrTagDetail): number {
  return (tag.movieIds ?? tag.seriesIds ?? []).length;
}

function otherUseCount(tag: ArrTagDetail): number {
  return (
    tag.indexerIds.length +
    tag.importListIds.length +
    tag.notificationIds.length +
    tag.restrictionIds.length +
    tag.delayProfileIds.length
  );
}

export function buildTagRows(snapshots: readonly InstanceSnapshot[]): TagMatrixRow[] {
  // Cells cover every column - including unreachable ones, which render as unknown - so
  // the matrix header and body always line up.
  const healthy = comparable(snapshots);
  const labels = new Set<string>();
  for (const snapshot of healthy) {
    for (const tag of snapshot.tags) labels.add(tag.label);
  }

  const rows = [...labels].map((label): TagMatrixRow => {
    const cells = snapshots.map((snapshot): TagCell => {
      const tag = snapshot.tags.find((entry) => entry.label === label);
      return {
        instanceId: snapshot.instance.id,
        known: snapshot.status === 'ok',
        present: tag !== undefined,
        tagId: tag?.id ?? null,
        mediaCount: tag === undefined ? 0 : attachedMediaCount(tag),
        otherUses: tag === undefined ? 0 : otherUseCount(tag),
      };
    });

    const presentOn = cells.filter((cell) => cell.known && cell.present).map((cell) => cell.instanceId);
    const missingOn = cells.filter((cell) => cell.known && !cell.present).map((cell) => cell.instanceId);
    const totalMedia = cells.reduce((sum, cell) => sum + cell.mediaCount, 0);
    const totalOther = cells.reduce((sum, cell) => sum + cell.otherUses, 0);

    return {
      label,
      cells,
      presentOn,
      missingOn,
      parity: parityOf(presentOn.length, healthy.length),
      totalMedia,
      unusedEverywhere: totalMedia === 0 && totalOther === 0,
    };
  });

  return rows.sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

function leafOf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  const segments = trimmed.split(/[/\\]/);
  return (segments.at(-1) ?? trimmed).toLowerCase();
}

export function buildRootFolderRows(snapshots: readonly InstanceSnapshot[]): RootFolderRow[] {
  const healthy = comparable(snapshots);
  const paths = new Set<string>();
  for (const snapshot of healthy) {
    for (const folder of snapshot.rootFolders) paths.add(folder.path);
  }

  const rows = [...paths].map((path): RootFolderRow => {
    const cells = snapshots.map((snapshot): RootFolderCell => {
      const folder = snapshot.rootFolders.find((entry) => entry.path === path);
      return {
        instanceId: snapshot.instance.id,
        known: snapshot.status === 'ok',
        present: folder !== undefined,
        rootFolderId: folder?.id ?? null,
        accessible: folder?.accessible ?? true,
        freeSpace: folder?.freeSpace ?? null,
        totalSpace: folder?.totalSpace ?? null,
      };
    });

    const presentOn = cells.filter((cell) => cell.known && cell.present).map((cell) => cell.instanceId);

    return {
      path,
      leaf: leafOf(path),
      cells,
      presentOn,
      missingOn: cells.filter((cell) => cell.known && !cell.present).map((cell) => cell.instanceId),
      inaccessibleOn: cells
        .filter((cell) => cell.present && !cell.accessible)
        .map((cell) => cell.instanceId),
      parity: parityOf(presentOn.length, healthy.length),
    };
  });

  return rows.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function findPathDiscrepancies(rows: readonly RootFolderRow[]): PathDiscrepancy[] {
  const byLeaf = new Map<string, RootFolderRow[]>();
  for (const row of rows) {
    byLeaf.set(row.leaf, [...(byLeaf.get(row.leaf) ?? []), row]);
  }

  const discrepancies: PathDiscrepancy[] = [];

  for (const [leaf, group] of byLeaf) {
    if (group.length < 2) continue;

    // An instance that carries every variant itself is doing it on purpose (a 4K split,
    // for example). Drift is when instances disagree about which variant they have.
    const instanceIds = new Set(group.flatMap((row) => row.presentOn));
    const holdsAll = [...instanceIds].some((instanceId) =>
      group.every((row) => row.presentOn.includes(instanceId)),
    );
    if (holdsAll) continue;

    discrepancies.push({
      leaf,
      variants: group.map((row) => ({ path: row.path, instanceIds: row.presentOn })),
    });
  }

  return discrepancies.sort((a, b) => a.leaf.localeCompare(b.leaf, 'en'));
}

function autoAddOf(list: ArrImportList): boolean {
  return list.enableAutomaticAdd ?? list.enableAuto ?? false;
}

export function buildImportListRows(snapshots: readonly InstanceSnapshot[]): ImportListRow[] {
  const healthy = comparable(snapshots);
  const keys = new Map<string, ArrImportList>();
  for (const snapshot of healthy) {
    for (const list of snapshot.importLists) {
      const key = list.name.trim().toLowerCase();
      if (!keys.has(key)) keys.set(key, list);
    }
  }

  const rows = [...keys.entries()].map(([key, sample]): ImportListRow => {
    const cells = snapshots.map((snapshot): ImportListCell => {
      const list = snapshot.importLists.find((entry) => entry.name.trim().toLowerCase() === key);
      return {
        instanceId: snapshot.instance.id,
        known: snapshot.status === 'ok',
        present: list !== undefined,
        listId: list?.id ?? null,
        enabled: list?.enabled ?? false,
        autoAdd: list === undefined ? false : autoAddOf(list),
        rootFolderPath: list?.rootFolderPath ?? '',
        qualityProfileId: list?.qualityProfileId ?? 0,
      };
    });

    const present = cells.filter((cell) => cell.known && cell.present);
    const presentOn = present.map((cell) => cell.instanceId);

    return {
      key,
      name: sample.name,
      implementation: sample.implementationName ?? sample.implementation,
      cells,
      presentOn,
      missingOn: cells.filter((cell) => cell.known && !cell.present).map((cell) => cell.instanceId),
      parity: parityOf(presentOn.length, healthy.length),
      rootFolderDrift: new Set(present.map((cell) => cell.rootFolderPath)).size > 1,
      qualityProfileDrift: new Set(present.map((cell) => cell.qualityProfileId)).size > 1,
      enabledDrift: new Set(present.map((cell) => cell.enabled)).size > 1,
    };
  });

  return rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export function buildFleetStats(
  snapshots: readonly InstanceSnapshot[],
  tagRows: readonly TagMatrixRow[],
  rootFolderRows: readonly RootFolderRow[],
  discrepancies: readonly PathDiscrepancy[],
): FleetStats {
  return {
    instances: snapshots.length,
    healthy: snapshots.filter((snapshot) => snapshot.status === 'ok').length,
    failing: snapshots.filter((snapshot) => snapshot.status === 'error').length,
    tagsTotal: tagRows.length,
    tagsInSync: tagRows.filter((row) => row.parity === 'full').length,
    tagsDrifted: tagRows.filter((row) => row.parity !== 'full').length,
    rootFoldersTotal: rootFolderRows.length,
    rootFoldersInSync: rootFolderRows.filter((row) => row.parity === 'full').length,
    rootFoldersDrifted: rootFolderRows.filter((row) => row.parity !== 'full').length,
    rootFoldersInaccessible: rootFolderRows.filter((row) => row.inaccessibleOn.length > 0).length,
    pathDiscrepancies: discrepancies.length,
  };
}

/** Case-insensitive substring match used by Find &amp; Replace across the fleet. */
export interface ReplacementPreview {
  readonly instanceId: number;
  readonly tagId: number;
  readonly from: string;
  readonly to: string;
}

export function previewFindReplace(
  snapshots: readonly InstanceSnapshot[],
  find: string,
  replace: string,
  options: { caseSensitive?: boolean; instanceIds?: readonly number[] } = {},
): ReplacementPreview[] {
  if (find.length === 0) return [];

  const flags = options.caseSensitive === true ? 'g' : 'gi';
  const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  const allowed = options.instanceIds;

  const previews: ReplacementPreview[] = [];

  for (const snapshot of comparable(snapshots)) {
    if (allowed !== undefined && !allowed.includes(snapshot.instance.id)) continue;

    for (const tag of snapshot.tags) {
      pattern.lastIndex = 0;
      if (!pattern.test(tag.label)) continue;

      const next = tag.label.replace(new RegExp(pattern.source, flags), replace);
      if (next === tag.label || next.trim().length === 0) continue;

      previews.push({ instanceId: snapshot.instance.id, tagId: tag.id, from: tag.label, to: next });
    }
  }

  return previews;
}

/** The tag id carrying `label` on one instance, if any. */
export function tagIdByLabel(
  snapshots: readonly InstanceSnapshot[],
  instanceId: number,
  label: string,
): number | null {
  const snapshot = snapshots.find((entry) => entry.instance.id === instanceId);
  return snapshot?.tags.find((tag) => tag.label === label)?.id ?? null;
}

/**
 * Renames that would collide with an existing tag on the same instance, keyed
 * `${instanceId}|${label}` -> existing tag id. *Arr answers a colliding rename with
 * "Label already exists", so the caller stages a merge into that tag instead.
 */
export function findCollisions(
  snapshots: readonly InstanceSnapshot[],
  candidates: ReadonlyArray<{ instanceId: number; to: string }>,
): Map<string, number> {
  const collisions = new Map<string, number>();

  for (const candidate of candidates) {
    const existing = tagIdByLabel(snapshots, candidate.instanceId, candidate.to);
    if (existing !== null) collisions.set(`${String(candidate.instanceId)}|${candidate.to}`, existing);
  }

  return collisions;
}
