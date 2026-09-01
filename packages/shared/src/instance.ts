import { z } from 'zod';

export const INSTANCE_KINDS = ['radarr', 'sonarr'] as const;
export type InstanceKind = (typeof INSTANCE_KINDS)[number];

/** Media entity managed by each *Arr flavour. Drives endpoint + label selection. */
export const MEDIA_KIND_BY_INSTANCE = {
  radarr: 'movie',
  sonarr: 'series',
} as const satisfies Record<InstanceKind, 'movie' | 'series'>;

export type MediaKind = (typeof MEDIA_KIND_BY_INSTANCE)[InstanceKind];

/**
 * An instance as exposed by the HTTP API.
 * The API key deliberately never crosses this boundary - see `InstanceWithKey`.
 */
export interface Instance {
  readonly id: number;
  readonly name: string;
  readonly kind: InstanceKind;
  readonly baseUrl: string;
  readonly verifySsl: boolean;
  readonly enabled: boolean;
  readonly timeoutMs: number;
  readonly appVersion: string | null;
  readonly lastConnectedAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Server-internal projection. Never serialise this to a client. */
export interface InstanceWithKey extends Instance {
  readonly apiKey: string;
}

/** Trailing slashes and stray whitespace are the #1 source of 404s against *Arr. */
export function normaliseBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, '');
}

export const createInstanceSchema = z.object({
  name: z.string().min(1).max(64),
  kind: z.enum(INSTANCE_KINDS),
  baseUrl: z
    .string()
    .min(1)
    .transform(normaliseBaseUrl)
    .refine((value) => /^https?:\/\//i.test(value), 'baseUrl must start with http:// or https://'),
  apiKey: z.string().min(8).max(128),
  verifySsl: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(120_000).default(20_000),
});
export type CreateInstanceInput = z.input<typeof createInstanceSchema>;
export type CreateInstance = z.output<typeof createInstanceSchema>;

export const updateInstanceSchema = createInstanceSchema
  .partial()
  .extend({ enabled: z.boolean().optional() });
export type UpdateInstanceInput = z.input<typeof updateInstanceSchema>;
export type UpdateInstance = z.output<typeof updateInstanceSchema>;

/** Result of probing /api/v3/system/status with the supplied credentials. */
export interface ConnectionTestResult {
  readonly ok: boolean;
  readonly appVersion?: string;
  readonly instanceName?: string;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly httpStatus?: number;
  };
}
