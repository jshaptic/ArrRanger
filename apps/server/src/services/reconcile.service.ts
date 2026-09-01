import path from 'node:path';
import type {
  MappingMismatch,
  MissingPath,
  ReconcileEntry,
  ReconcileReport,
} from '@arrranger/shared';
import type { FilesystemService } from '../fs/filesystem.service.js';
import { describePath } from '../fs/paths.js';
import type { InstancesRepository } from '../repositories/instances.repo.js';
import type { ResourcesService } from './resources.service.js';

export interface ReconcileServiceDeps {
  readonly instances: InstancesRepository;
  readonly resources: ResourcesService;
  readonly filesystem: FilesystemService;
}

interface InstanceView {
  readonly instanceId: number;
  readonly name: string;
  readonly mediaPaths: ReadonlySet<string>;
  readonly rootFolders: readonly string[];
  readonly titleByPath: ReadonlyMap<string, string>;
}

function normalise(target: string): string {
  const trimmed = target.replace(/[/\\]+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
}

/**
 * Joins disk truth to *Arr truth.
 *
 * Both sides must describe the same path - ArrRanger deliberately has no path translation
 * layer, so a volume mapping difference is reported as exactly that rather than showing an
 * entire library as "missing".
 */
export class ReconcileService {
  private cache: { report: ReconcileReport; at: number } | null = null;

  constructor(private readonly deps: ReconcileServiceDeps) {}

  private async instanceViews(refresh: boolean): Promise<InstanceView[]> {
    const views: InstanceView[] = [];

    for (const instance of this.deps.instances.list()) {
      if (!instance.enabled) continue;
      try {
        const [library, rootFolders] = await Promise.all([
          this.deps.resources.mediaLibrary(instance.id, refresh),
          this.deps.resources.rootFolders(instance.id, refresh),
        ]);

        const titleByPath = new Map<string, string>();
        const mediaPaths = new Set<string>();
        for (const media of library.items) {
          if (media.path.length === 0) continue;
          const normalised = normalise(media.path);
          mediaPaths.add(normalised);
          titleByPath.set(normalised, media.title);
        }

        views.push({
          instanceId: instance.id,
          name: instance.name,
          mediaPaths,
          rootFolders: rootFolders.map((folder) => normalise(folder.path)),
          titleByPath,
        });
      } catch {
        // An unreachable instance contributes nothing; the fleet views already flag it.
      }
    }

    return views;
  }

  async report(options: { refresh?: boolean } = {}): Promise<ReconcileReport> {
    if (options.refresh !== true && this.cache !== null && Date.now() - this.cache.at < 30_000) {
      return this.cache.report;
    }

    const views = await this.instanceViews(options.refresh === true);
    const localRoots = this.deps.filesystem.rootPaths;

    const entries: ReconcileEntry[] = [];
    const missing: MissingPath[] = [];
    const mismatches: MappingMismatch[] = [];

    // Which *Arr root folders can this container actually see?
    const scannable = new Set<string>();
    for (const view of views) {
      let reachable = 0;

      for (const rootFolder of view.rootFolders) {
        const insideOurRoots = localRoots.some(
          (root) => rootFolder === root || rootFolder.startsWith(`${root}${path.sep}`),
        );
        if (!insideOurRoots) continue;

        const stats = await describePath(rootFolder);
        if (stats.exists && stats.isDirectory) {
          scannable.add(rootFolder);
          reachable += 1;
        } else {
          missing.push({
            path: rootFolder,
            instanceId: view.instanceId,
            kind: 'rootFolder',
            title: `${view.name} root folder`,
          });
        }
      }

      // Nothing this instance believes in exists here: a mapping problem, not missing media.
      if (reachable === 0 && view.mediaPaths.size > 0) {
        mismatches.push({
          instanceId: view.instanceId,
          reportedPaths: view.rootFolders,
          checkedRoots: localRoots,
          mediaPathCount: view.mediaPaths.size,
        });
      }
    }

    // Disk -> *Arr: what is on the array that nobody tracks.
    for (const rootFolder of scannable) {
      const listing = await this.deps.filesystem.list(rootFolder).catch(() => null);
      if (listing === null) continue;

      for (const entry of listing.entries) {
        if (entry.kind !== 'directory' && entry.kind !== 'symlink') continue;

        const owners = views
          .filter((view) => view.mediaPaths.has(normalise(entry.path)))
          .map((view) => view.instanceId);

        const state = owners.length > 0 ? 'matched' : entry.childCount === 0 ? 'empty' : 'orphan';

        entries.push({
          path: entry.path,
          name: entry.name,
          rootFolderPath: rootFolder,
          state,
          isSymlink: entry.kind === 'symlink',
          instanceIds: owners,
          modifiedAt: entry.modifiedAt,
        });
      }
    }

    // *Arr -> disk: paths in a database that no longer exist. Instances with a mapping
    // mismatch are skipped: every one of their paths would be reported, drowning the signal.
    const mismatched = new Set(mismatches.map((entry) => entry.instanceId));
    for (const view of views) {
      if (mismatched.has(view.instanceId)) continue;

      for (const mediaPath of view.mediaPaths) {
        const insideScannable = [...scannable].some(
          (root) => mediaPath === root || mediaPath.startsWith(`${root}${path.sep}`),
        );
        if (!insideScannable) continue;

        const stats = await describePath(mediaPath);
        if (!stats.exists) {
          missing.push({
            path: mediaPath,
            instanceId: view.instanceId,
            kind: 'media',
            title: view.titleByPath.get(mediaPath) ?? path.basename(mediaPath),
          });
        }
      }
    }

    const report: ReconcileReport = {
      scannedAt: new Date().toISOString(),
      roots: [...scannable].sort(),
      entries: entries.sort((a, b) => a.path.localeCompare(b.path, 'en')),
      missing: missing.sort((a, b) => a.path.localeCompare(b.path, 'en')),
      mismatches,
      counts: {
        matched: entries.filter((entry) => entry.state === 'matched').length,
        orphan: entries.filter((entry) => entry.state === 'orphan').length,
        empty: entries.filter((entry) => entry.state === 'empty').length,
        missing: missing.length,
      },
    };

    this.cache = { report, at: Date.now() };
    return report;
  }

  invalidate(): void {
    this.cache = null;
  }

  /**
   * Instances that still have media at or under `target`. Powers the delete guard, so it
   * reads cached snapshots only - a preflight must not depend on a reachable instance.
   */
  referencedBy = async (target: string): Promise<readonly number[]> => {
    const normalised = normalise(target);
    const prefix = `${normalised}${path.sep}`;
    const owners: number[] = [];

    for (const view of await this.instanceViews(false)) {
      const referenced =
        view.rootFolders.includes(normalised) ||
        [...view.mediaPaths].some((mediaPath) => mediaPath === normalised || mediaPath.startsWith(prefix));
      if (referenced) owners.push(view.instanceId);
    }

    return owners;
  };
}
