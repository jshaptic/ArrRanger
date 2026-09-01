import type { HealthResponse } from '@arrranger/shared';
import type { FastifyPluginAsync } from 'fastify';
import { getSchemaVersion } from '../db/client.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (): Promise<HealthResponse> => {
    let database: HealthResponse['database'] = 'ok';
    let schemaVersion = 0;

    try {
      schemaVersion = getSchemaVersion(app.db);
      app.db.prepare('SELECT 1').get();
    } catch (error) {
      app.log.error({ err: error }, 'health check: database unreachable');
      database = 'error';
    }

    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      version: app.appConfig.appVersion,
      uptimeSeconds: Math.round(process.uptime()),
      database,
      schemaVersion,
    };
  });
};
