import { existsSync } from 'node:fs';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import type { AppContext } from './context.js';
import { createContext } from './context.js';
import type { SqliteDatabase } from './db/client.js';
import { serialiseError } from './lib/errors.js';
import { apiRoutes } from './routes/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    appConfig: AppConfig;
    db: SqliteDatabase;
    /** Repositories, services and the queue executor - see context.ts. */
    ctx: AppContext;
  }
}

export interface AppDeps {
  readonly config: AppConfig;
  readonly db: SqliteDatabase;
}

export async function buildApp({ config, db }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 4 * 1024 * 1024, // bulk selections can carry thousands of media ids
  });

  app.decorate('appConfig', config);
  app.decorate('db', db);

  const ctx = await createContext({ config, db, logger: app.log });
  app.decorate('ctx', ctx);

  // A process that died mid-run leaves rows claiming to be running; park them as paused.
  ctx.executor.recoverInterrupted();

  app.addHook('onClose', async () => {
    await ctx.shutdown();
  });

  await app.register(sensible);

  // Same-origin in production (the SPA is served by this process) and proxied by
  // Vite in dev, so CORS stays off unless explicitly configured.
  if (config.corsOrigins.length > 0) {
    await app.register(cors, { origin: [...config.corsOrigins], credentials: true });
  }

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({
        error: {
          code: 'validation_failed',
          message: 'Request validation failed',
          details: error.issues,
        },
      });
      return;
    }

    const serialised = serialiseError(error);
    if (serialised.httpStatus >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.warn({ err: error }, 'request rejected');
    }

    reply.code(error.statusCode ?? serialised.httpStatus).send({
      error: {
        code: serialised.code,
        message: serialised.message,
        ...(serialised.details === undefined ? {} : { details: serialised.details }),
      },
    });
  });

  await app.register(apiRoutes, { prefix: '/api' });

  // In dev the SPA is served by Vite on :5173 and this directory does not exist yet.
  const hasWebBuild = existsSync(config.webRoot);
  if (hasWebBuild) {
    await app.register(fastifyStatic, { root: config.webRoot, wildcard: false });
  } else {
    app.log.warn({ webRoot: config.webRoot }, 'no web build found - serving API only');
  }

  // SPA fallback: anything that is not /api and not a real file gets index.html.
  app.setNotFoundHandler((request, reply) => {
    if (!hasWebBuild || request.method !== 'GET' || request.url.startsWith('/api')) {
      reply.code(404).send({
        error: {
          code: 'not_found',
          message: `Route ${request.method} ${request.url} not found`,
        },
      });
      return;
    }
    reply.sendFile('index.html');
  });

  return app;
}
