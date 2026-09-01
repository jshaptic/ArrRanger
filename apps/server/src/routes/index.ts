import type { FastifyPluginAsync } from 'fastify';
import { healthRoutes } from './health.routes.js';
import { instanceRoutes } from './instances.routes.js';
import { queueRoutes } from './queue.routes.js';
import { resourceRoutes } from './resources.routes.js';
import { storageRoutes } from './storage.routes.js';

/** Everything under /api. */
export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(healthRoutes);
  await app.register(instanceRoutes);
  await app.register(resourceRoutes);
  await app.register(storageRoutes);
  await app.register(queueRoutes);
};
