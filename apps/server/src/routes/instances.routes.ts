import {
  createInstanceSchema,
  updateInstanceSchema,
  type ConnectionTestResult,
  type InstanceListResponse,
  type InstanceResponse,
} from '@arrranger/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const idParams = z.object({ id: z.coerce.number().int().positive() });

const connectionTestSchema = createInstanceSchema.pick({
  kind: true,
  baseUrl: true,
  apiKey: true,
  verifySsl: true,
  timeoutMs: true,
});

export const instanceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/instances', async (): Promise<InstanceListResponse> => ({
    instances: app.ctx.instances.list(),
  }));

  app.get('/instances/:id', async (request): Promise<InstanceResponse> => {
    const { id } = idParams.parse(request.params);
    return { instance: app.ctx.instances.require(id) };
  });

  app.post('/instances', async (request, reply): Promise<InstanceResponse> => {
    const input = createInstanceSchema.parse(request.body);
    const result = await app.ctx.instances.create(input);
    reply.code(201);
    return result;
  });

  app.patch('/instances/:id', async (request): Promise<InstanceResponse> => {
    const { id } = idParams.parse(request.params);
    const patch = updateInstanceSchema.parse(request.body);
    return app.ctx.instances.update(id, patch);
  });

  app.delete('/instances/:id', async (request, reply): Promise<void> => {
    const { id } = idParams.parse(request.params);
    await app.ctx.instances.remove(id);
    reply.code(204);
  });

  /** Probe a stored instance. */
  app.post('/instances/:id/test', async (request): Promise<ConnectionTestResult> => {
    const { id } = idParams.parse(request.params);
    return app.ctx.instances.testSaved(id);
  });

  /** Probe credentials that have not been saved yet. */
  app.post('/instances/test', async (request): Promise<ConnectionTestResult> => {
    const input = connectionTestSchema.parse(request.body);
    return app.ctx.instances.testCandidate(input);
  });
};
