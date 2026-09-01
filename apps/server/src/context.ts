import type { FastifyBaseLogger } from 'fastify';
import { ArrDispatcherPool } from './arr/http.js';
import type { AppConfig } from './config.js';
import type { SqliteDatabase } from './db/client.js';
import { FilesystemService } from './fs/filesystem.service.js';
import { PathGuard } from './fs/paths.js';
import { RunEventBus } from './queue/events.js';
import { QueueExecutor } from './queue/executor.js';
import { InstancesRepository } from './repositories/instances.repo.js';
import { QueueRepository } from './repositories/queue.repo.js';
import { RunsRepository } from './repositories/runs.repo.js';
import { SnapshotsRepository } from './repositories/snapshots.repo.js';
import { InstancesService } from './services/instances.service.js';
import { ReconcileService } from './services/reconcile.service.js';
import { ResourcesService } from './services/resources.service.js';

/** Composition root: one place where every dependency is wired. */
export interface AppContext {
  readonly config: AppConfig;
  readonly db: SqliteDatabase;
  readonly instancesRepo: InstancesRepository;
  readonly queue: QueueRepository;
  readonly runs: RunsRepository;
  readonly snapshots: SnapshotsRepository;
  readonly dispatchers: ArrDispatcherPool;
  readonly events: RunEventBus;
  readonly executor: QueueExecutor;
  readonly instances: InstancesService;
  readonly resources: ResourcesService;
  readonly filesystem: FilesystemService;
  readonly reconcile: ReconcileService;
  shutdown(): Promise<void>;
}

export async function createContext(params: {
  config: AppConfig;
  db: SqliteDatabase;
  logger: FastifyBaseLogger;
}): Promise<AppContext> {
  const { config, db, logger } = params;

  const instancesRepo = new InstancesRepository(db, config.secret);
  const queue = new QueueRepository(db);
  const runs = new RunsRepository(db);
  const snapshots = new SnapshotsRepository(db);
  const dispatchers = new ArrDispatcherPool();
  const events = new RunEventBus();

  const guard = await PathGuard.create(config.fsRoots);
  const filesystem = new FilesystemService(guard);

  const instances = new InstancesService({ instances: instancesRepo, snapshots, dispatchers });
  const resources = new ResourcesService({ instances: instancesRepo, snapshots, dispatchers });
  const reconcile = new ReconcileService({ instances: instancesRepo, resources, filesystem });

  // The delete guard asks *Arr what it still owns; the reconcile service needs the
  // filesystem to scan. Wiring the lookup after construction breaks the cycle.
  filesystem.setReferenceLookup(reconcile.referencedBy);

  const executor = new QueueExecutor({
    instances: instancesRepo,
    filesystem,
    queue,
    runs,
    snapshots,
    dispatchers,
    events,
    logger,
    onFilesystemChanged: () => reconcile.invalidate(),
  });

  for (const root of filesystem.roots().roots) {
    logger.info(
      {
        path: root.path,
        exists: root.exists,
        readable: root.readable,
        writable: root.writable,
        deviceId: root.deviceId,
        error: root.error,
      },
      root.writable ? 'storage root ready' : 'storage root is not writable',
    );
  }
  if (!filesystem.enabled) {
    logger.info('FS_ROOTS is unset - filesystem operations are disabled');
  }

  return {
    config,
    db,
    instancesRepo,
    queue,
    runs,
    snapshots,
    dispatchers,
    events,
    executor,
    instances,
    resources,
    filesystem,
    reconcile,
    async shutdown() {
      // Let the in-flight queue item finish before sockets go away.
      await executor.waitForIdle();
      await dispatchers.closeAll();
    },
  };
}
