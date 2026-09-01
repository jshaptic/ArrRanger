import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSecret } from './lib/crypto.js';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  readonly appVersion: string;
  readonly host: string;
  readonly port: number;
  readonly configDir: string;
  readonly databaseFile: string;
  readonly migrationsDir: string;
  readonly webRoot: string;
  readonly logLevel: LogLevel;
  readonly trustProxy: boolean;
  readonly corsOrigins: readonly string[];
  /**
   * Storage roots ArrRanger may inspect and modify, colon-separated like PATH. Empty
   * disables every filesystem operation. These must be the same paths the *Arr containers
   * see - ArrRanger deliberately has no path translation layer.
   */
  readonly fsRoots: readonly string[];
  /** Used to derive the AES key for stored *Arr API keys. Never log this. */
  readonly secret: string;
}

/**
 * Both `src/` (tsx dev) and `dist/` (built) sit one level below apps/server, so
 * these relative resolutions hold in development and inside the container alike.
 */
function fromServerRoot(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

function envString(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function envInt(key: string, fallback: number): number {
  const raw = envString(key);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got "${raw}"`);
  }
  return parsed;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = envString(key)?.toLowerCase();
  if (raw === undefined) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function envLogLevel(fallback: LogLevel): LogLevel {
  const raw = envString('LOG_LEVEL')?.toLowerCase();
  if (raw === undefined) return fallback;
  const match = LOG_LEVELS.find((level) => level === raw);
  if (!match) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${raw}"`);
  }
  return match;
}

export function loadConfig(): AppConfig {
  // Container default is /config (the Unraid appdata volume). Dev falls back to a
  // gitignored folder at the repo root - resolved from this file rather than cwd, so
  // `npm run dev` (cwd apps/server) and `npm start` (cwd repo root) share one database.
  const configDir = path.resolve(envString('CONFIG_DIR') ?? fromServerRoot('../../../.config-dev'));
  mkdirSync(configDir, { recursive: true });

  const config: AppConfig = {
    appVersion: envString('APP_VERSION') ?? '0.1.0',
    host: envString('HOST') ?? '0.0.0.0',
    port: envInt('PORT', 8585),
    configDir,
    databaseFile: path.join(configDir, 'arrranger.db'),
    migrationsDir: envString('MIGRATIONS_DIR') ?? fromServerRoot('../migrations/'),
    webRoot: envString('WEB_ROOT') ?? fromServerRoot('../../web/dist/'),
    logLevel: envLogLevel('info'),
    trustProxy: envBool('TRUST_PROXY', false),
    corsOrigins: (envString('CORS_ORIGINS') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    fsRoots: (envString('FS_ROOTS') ?? '')
      .split(':')
      .map((root) => root.trim())
      .filter((root) => root.length > 0),
    secret: resolveSecret(process.env['ARRRANGER_SECRET'], path.join(configDir, 'secret.key')),
  };

  return Object.freeze(config);
}
