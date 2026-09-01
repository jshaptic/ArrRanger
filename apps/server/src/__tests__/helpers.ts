import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';
import { closeDatabase, openDatabase, type SqliteDatabase } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';

export interface TestApp {
  readonly app: FastifyInstance;
  readonly db: SqliteDatabase;
  readonly url: string;
  readonly configDir: string;
  close(): Promise<void>;
}

export function testConfig(configDir: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    appVersion: 'test',
    host: '127.0.0.1',
    port: 0,
    configDir,
    databaseFile: path.join(configDir, 'arrranger.db'),
    migrationsDir: fileURLToPath(new URL('../../migrations/', import.meta.url)),
    webRoot: path.join(configDir, 'no-web-build'),
    logLevel: 'fatal',
    trustProxy: false,
    corsOrigins: [],
    fsRoots: [],
    secret: 'test-secret-not-for-production',
    ...overrides,
  };
}

export function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'arrranger-test-'));
}

/** Boots the real app on an ephemeral port - SSE needs a socket, so no inject(). */
export async function startTestApp(
  configDir = makeTempDir(),
  overrides: Partial<AppConfig> = {},
): Promise<TestApp> {
  const config = testConfig(configDir, overrides);
  const db = openDatabase(config.databaseFile);
  runMigrations(db, config.migrationsDir);

  const app = await buildApp({ config, db });
  await app.listen({ host: config.host, port: 0 });
  const address = app.server.address() as AddressInfo;

  return {
    app,
    db,
    configDir,
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await app.close();
      closeDatabase(db);
    },
  };
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export interface ApiResult<T> {
  readonly status: number;
  readonly body: T;
}

export async function api<T>(
  baseUrl: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: init.method ?? 'GET',
    ...(init.body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  });

  const text = await response.text();
  return {
    status: response.status,
    body: (text.length === 0 ? undefined : JSON.parse(text)) as T,
  };
}

/** Polls until the predicate holds, so tests never race the async executor. */
export async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${options.label ?? 'condition'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export interface ReceivedSseEvent {
  readonly id: string | null;
  readonly type: string;
  readonly data: unknown;
}

/**
 * Minimal EventSource: reads text/event-stream until `until` matches or the stream ends.
 */
export async function readSse(
  url: string,
  until: (event: ReceivedSseEvent) => boolean,
  timeoutMs = 10_000,
): Promise<ReceivedSseEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const received: ReceivedSseEvent[] = [];
  // Aborting a stream we already finished reading surfaces as an unhandled rejection,
  // so the abort is reserved for the timeout / error path.
  let finished = false;

  try {
    const response = await fetch(url, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (response.body === null) throw new Error('SSE response had no body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);

        const parsed = parseFrame(frame);
        if (parsed !== null) {
          received.push(parsed);
          if (until(parsed)) {
            finished = true;
            await reader.cancel().catch(() => undefined);
            return received;
          }
        }
        separator = buffer.indexOf('\n\n');
      }
    }

    finished = true;
    return received;
  } finally {
    clearTimeout(timer);
    if (!finished) controller.abort();
  }
}

function parseFrame(frame: string): ReceivedSseEvent | null {
  let id: string | null = null;
  let type = 'message';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue; // heartbeat comment
    if (line.startsWith('id: ')) id = line.slice(4);
    else if (line.startsWith('event: ')) type = line.slice(7);
    else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
  }

  if (dataLines.length === 0) return null;
  return { id, type, data: JSON.parse(dataLines.join('\n')) as unknown };
}
