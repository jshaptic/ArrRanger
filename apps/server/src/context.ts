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
import { PathIndexService } from './services/path-index.service.js';
import { PathMatrixService } from './services/path-matrix.service.js';
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
  readonly pathIndex: PathIndexService;
  readonly pathMatrix: PathMatrixService;
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
  const pathIndex = new PathIndexService({ instances: instancesRepo, resources });
  const pathMatrix = new PathMatrixService({
    index: pathIndex,
    filesystem,
    lowSpace: { bytes: config.lowSpaceBytes, percent: config.lowSpacePercent },
  });

  // The safety guards ask *Arr what it still owns. The index answers from cached
  // snapshots alone and never touches the disk, so there is no cycle to break here.
  filesystem.setReferenceLookup(pathIndex.referencedBy);

  const executor = new QueueExecutor({
    instances: instancesRepo,
    filesystem,
    queue,
    runs,
    snapshots,
    dispatchers,
    events,
    logger,
    onFilesystemChanged: () => pathIndex.invalidate(),
    // An *Arr change invalidates the joined view too - a root folder a run just
    // created has to be visible in the next read, not 30 seconds later.
    onInstanceChanged: () => pathIndex.invalidate(),
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
    pathIndex,
    pathMatrix,
    async shutdown() {
      // Let the in-flight queue item finish before sockets go away.
      await executor.waitForIdle();
      await dispatchers.closeAll();
    },
  };
}
