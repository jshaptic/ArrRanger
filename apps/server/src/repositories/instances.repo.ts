import {
  normaliseBaseUrl,
  type ConnectionTestResult,
  type CreateInstance,
  type Instance,
  type InstanceWithKey,
  type UpdateInstance,
} from '@arrranger/shared';
import type { SqliteDatabase } from '../db/client.js';
import { fromBool, nowIso, rowToInstance } from '../db/mappers.js';
import type { InstanceRow } from '../db/rows.js';
import { decryptSecret, deriveKey, encryptSecret } from '../lib/crypto.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';

interface SqliteErrorLike {
  readonly code?: string;
  readonly message?: string;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as SqliteErrorLike | undefined)?.code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}

export class InstancesRepository {
  private readonly key: Buffer;

  constructor(
    private readonly db: SqliteDatabase,
    secret: string,
  ) {
    this.key = deriveKey(secret);
  }

  list(): Instance[] {
    const rows = this.db
      .prepare('SELECT * FROM instances ORDER BY name COLLATE NOCASE')
      .all() as InstanceRow[];
    return rows.map(rowToInstance);
  }

  get(id: number): Instance | null {
    const row = this.row(id);
    return row === null ? null : rowToInstance(row);
  }

  require(id: number): Instance {
    const instance = this.get(id);
    if (!instance) throw new NotFoundError(`Instance ${id}`);
    return instance;
  }

  /** Server-internal: decrypts the stored API key. Never hand this to a route response. */
  getWithKey(id: number): InstanceWithKey | null {
    const row = this.row(id);
    if (row === null) return null;
    return { ...rowToInstance(row), apiKey: decryptSecret(this.key, row.api_key_enc) };
  }

  requireWithKey(id: number): InstanceWithKey {
    const instance = this.getWithKey(id);
    if (!instance) throw new NotFoundError(`Instance ${id}`);
    return instance;
  }

  create(input: CreateInstance): Instance {
    const statement = this.db.prepare(`
      INSERT INTO instances (name, kind, base_url, api_key_enc, verify_ssl, timeout_ms)
      VALUES (@name, @kind, @baseUrl, @apiKeyEnc, @verifySsl, @timeoutMs)
      RETURNING *
    `);

    try {
      const row = statement.get({
        name: input.name,
        kind: input.kind,
        baseUrl: normaliseBaseUrl(input.baseUrl),
        apiKeyEnc: encryptSecret(this.key, input.apiKey),
        verifySsl: fromBool(input.verifySsl),
        timeoutMs: input.timeoutMs,
      }) as InstanceRow;
      return rowToInstance(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('An instance with that name or URL already exists');
      }
      throw error;
    }
  }

  update(id: number, patch: UpdateInstance): Instance {
    const current = this.row(id);
    if (current === null) throw new NotFoundError(`Instance ${id}`);

    const assignments: string[] = [];
    const params: Record<string, string | number> = { id };

    const set = (column: string, key: string, value: string | number): void => {
      assignments.push(`${column} = @${key}`);
      params[key] = value;
    };

    if (patch.name !== undefined) set('name', 'name', patch.name);
    if (patch.kind !== undefined) set('kind', 'kind', patch.kind);
    if (patch.baseUrl !== undefined) set('base_url', 'baseUrl', normaliseBaseUrl(patch.baseUrl));
    if (patch.apiKey !== undefined) {
      set('api_key_enc', 'apiKeyEnc', encryptSecret(this.key, patch.apiKey));
    }
    if (patch.verifySsl !== undefined) set('verify_ssl', 'verifySsl', fromBool(patch.verifySsl));
    if (patch.enabled !== undefined) set('enabled', 'enabled', fromBool(patch.enabled));
    if (patch.timeoutMs !== undefined) set('timeout_ms', 'timeoutMs', patch.timeoutMs);

    if (assignments.length === 0) return rowToInstance(current);

    set('updated_at', 'updatedAt', nowIso());

    try {
      const row = this.db
        .prepare(`UPDATE instances SET ${assignments.join(', ')} WHERE id = @id RETURNING *`)
        .get(params) as InstanceRow;
      return rowToInstance(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('An instance with that name or URL already exists');
      }
      throw error;
    }
  }

  remove(id: number): void {
    const result = this.db.prepare('DELETE FROM instances WHERE id = ?').run(id);
    if (result.changes === 0) throw new NotFoundError(`Instance ${id}`);
  }

  /** Records the outcome of a connection test so the UI can show per-instance health. */
  recordProbe(id: number, result: ConnectionTestResult): void {
    if (result.ok) {
      this.db
        .prepare(
          `UPDATE instances
              SET app_version = @appVersion,
                  last_connected_at = @at,
                  last_error = NULL,
                  updated_at = @at
            WHERE id = @id`,
        )
        .run({ id, appVersion: result.appVersion ?? null, at: nowIso() });
      return;
    }

    this.db
      .prepare('UPDATE instances SET last_error = @error, updated_at = @at WHERE id = @id')
      .run({ id, error: result.error?.message ?? 'Connection failed', at: nowIso() });
  }

  private row(id: number): InstanceRow | null {
    const row = this.db.prepare('SELECT * FROM instances WHERE id = ?').get(id) as
      | InstanceRow
      | undefined;
    return row ?? null;
  }
}
