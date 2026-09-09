import type { Instance } from '@fleetarr/shared';
import type { ImportListRow, InstanceSnapshot } from './matrix';

/**
 * One instance that actually has this list. Absence is not a chip: like the folder
 * view, an instance that does not use the row is simply not here. Unknown stays off
 * the chip list too - the page says that once, above the table.
 */
export interface ImportListOwner {
  readonly instanceId: number;
  readonly name: string;
  readonly kind: Instance['kind'];
  readonly listId: number;
  readonly enabled: boolean;
  readonly autoAdd: boolean;
  readonly rootFolderPath: string;
  readonly qualityProfileId: number;
  /** Null when this instance has no profile for the id - never invent a label. */
  readonly qualityProfileName: string | null;
}

export interface ImportListFact {
  readonly label: string;
  readonly value: string;
  readonly detail: readonly string[];
  readonly tone: 'normal' | 'warn' | 'muted';
}

/** A healthy same-kind instance the + dialog can offer. */
export interface ImportListCloneCandidate {
  readonly instanceId: number;
  readonly name: string;
  readonly kind: Instance['kind'];
  readonly alreadyHas: boolean;
  readonly source: ImportListOwner;
}

/** Enabled lists read as present; disabled ones stay visible but quiet. */
export const LIST_CHIP_CLASSES = {
  enabled: 'border-sync/40 bg-sync/8 text-ink hover:border-sync/70',
  disabled: 'border-line bg-transparent text-muted hover:border-line-strong',
} as const;

export function importListOwners(
  row: ImportListRow,
  snapshots: readonly InstanceSnapshot[],
): ImportListOwner[] {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.instance.id, snapshot]));

  return row.cells.flatMap((cell) => {
    if (!cell.known || !cell.present || cell.listId === null) return [];
    const snapshot = byId.get(cell.instanceId);
    const instance = snapshot?.instance;
    const qualityProfileName =
      snapshot?.qualityProfiles.find((profile) => profile.id === cell.qualityProfileId)?.name ?? null;
    return [
      {
        instanceId: cell.instanceId,
        name: instance?.name ?? `instance ${String(cell.instanceId)}`,
        kind: instance?.kind ?? 'radarr',
        listId: cell.listId,
        enabled: cell.enabled,
        autoAdd: cell.autoAdd,
        rootFolderPath: cell.rootFolderPath,
        qualityProfileId: cell.qualityProfileId,
        qualityProfileName,
      },
    ];
  });
}

/**
 * Same-kind healthy instances only. A Radarr list cannot be POSTed onto Sonarr, and an
 * unreachable instance is unknown, not a place to copy to.
 */
export function importListCloneCandidates(
  row: ImportListRow,
  snapshots: readonly InstanceSnapshot[],
): ImportListCloneCandidate[] {
  const owners = importListOwners(row, snapshots);
  const present = new Set(owners.map((owner) => owner.instanceId));
  const sourceByKind = new Map<Instance['kind'], ImportListOwner>();
  for (const owner of owners) {
    if (!sourceByKind.has(owner.kind)) sourceByKind.set(owner.kind, owner);
  }

  return snapshots.flatMap((snapshot) => {
    if (snapshot.status !== 'ok') return [];
    const source = sourceByKind.get(snapshot.instance.kind);
    if (source === undefined) return [];
    return [
      {
        instanceId: snapshot.instance.id,
        name: snapshot.instance.name,
        kind: snapshot.instance.kind,
        alreadyHas: present.has(snapshot.instance.id),
        source,
      },
    ];
  });
}

export function canCloneImportList(
  row: ImportListRow,
  snapshots: readonly InstanceSnapshot[],
): boolean {
  return importListCloneCandidates(row, snapshots).some((candidate) => !candidate.alreadyHas);
}

/** The one word that belongs on the chip: on or off. Path and profile live on the card. */
export function ownerStateLabel(owner: ImportListOwner): { readonly value: string; readonly title: string } {
  if (!owner.enabled) return { value: 'off', title: 'Disabled' };
  return {
    value: 'on',
    title: owner.autoAdd ? 'Enabled, automatic add on' : 'Enabled',
  };
}

export function importListOwnerFacts(owner: ImportListOwner): ImportListFact[] {
  return [
    {
      label: 'State',
      value: owner.enabled ? 'enabled' : 'disabled',
      detail: [owner.autoAdd ? 'automatic add on' : 'automatic add off'],
      tone: owner.enabled ? 'normal' : 'muted',
    },
    {
      label: 'Root folder',
      value: owner.rootFolderPath || 'none set',
      detail: [],
      tone: owner.rootFolderPath.length > 0 ? 'normal' : 'muted',
    },
    {
      label: 'Profile',
      value:
        owner.qualityProfileName ??
        (owner.qualityProfileId === 0 ? 'none set' : `id ${String(owner.qualityProfileId)}`),
      detail: [],
      tone: owner.qualityProfileName !== null ? 'normal' : 'muted',
    },
  ];
}
