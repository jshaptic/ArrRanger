import { z } from 'zod';

/**
 * Radarr/Sonarr v3 responses are wide, version-dependent and differ per flavour.
 * The rule in this codebase: parse a NARROW view of the fields we render, and keep
 * the body exactly as sent alongside it. `z.object()` strips unknown keys, so the
 * view stays clean while `raw` keeps everything the API gave us.
 */
export type ArrJson = Record<string, unknown>;

export interface ArrResource<TView> {
  readonly view: TView;
  readonly raw: ArrJson;
}

export const arrSystemStatusSchema = z.object({
  version: z.string(),
  appName: z.string().optional(),
  instanceName: z.string().optional(),
  isDocker: z.boolean().optional(),
});
export type ArrSystemStatus = z.infer<typeof arrSystemStatusSchema>;

export const arrTagSchema = z.object({
  id: z.number().int(),
  label: z.string(),
});
export type ArrTag = z.infer<typeof arrTagSchema>;

/** GET /api/v3/tag/detail - the only way to know what a tag is actually attached to. */
export const arrTagDetailSchema = arrTagSchema.extend({
  movieIds: z.array(z.number().int()).optional(),
  seriesIds: z.array(z.number().int()).optional(),
  indexerIds: z.array(z.number().int()).default([]),
  importListIds: z.array(z.number().int()).default([]),
  notificationIds: z.array(z.number().int()).default([]),
  restrictionIds: z.array(z.number().int()).default([]),
  delayProfileIds: z.array(z.number().int()).default([]),
});
export type ArrTagDetail = z.infer<typeof arrTagDetailSchema>;

export const arrRootFolderSchema = z.object({
  id: z.number().int(),
  path: z.string(),
  accessible: z.boolean().default(true),
  freeSpace: z.number().nullable().default(null),
  totalSpace: z.number().nullable().default(null),
});
export type ArrRootFolder = z.infer<typeof arrRootFolderSchema>;

export const arrFieldSchema = z.object({
  name: z.string(),
  value: z.unknown().optional(),
});
export type ArrField = z.infer<typeof arrFieldSchema>;

/**
 * Import lists diverge the most between the two apps:
 * Radarr uses `enableAuto`/`minimumAvailability`, Sonarr uses `enableAutomaticAdd`/
 * `seasonFolder`/`seriesType`. Both are optional here; `raw` carries the rest.
 */
export const arrImportListSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  implementation: z.string(),
  implementationName: z.string().optional(),
  configContract: z.string(),
  enabled: z.boolean().default(true),
  enableAuto: z.boolean().optional(),
  enableAutomaticAdd: z.boolean().optional(),
  rootFolderPath: z.string().default(''),
  qualityProfileId: z.number().int().default(0),
  monitor: z.string().optional(),
  minimumAvailability: z.string().optional(),
  seasonFolder: z.boolean().optional(),
  seriesType: z.string().optional(),
  tags: z.array(z.number().int()).default([]),
  fields: z.array(arrFieldSchema).default([]),
});
export type ArrImportList = z.infer<typeof arrImportListSchema>;

/** Minimal projection of a movie/series row, enough for the bulk-selection grid. */
export const arrMediaSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  sortTitle: z.string().optional(),
  path: z.string().default(''),
  rootFolderPath: z.string().optional(),
  qualityProfileId: z.number().int().default(0),
  monitored: z.boolean().default(false),
  tags: z.array(z.number().int()).default([]),
  sizeOnDisk: z.number().optional(),
  /**
   * Radarr sets this false for a monitored film nobody has downloaded yet. Such an item
   * has a `path` that deliberately does not exist, so it must never be reported as a
   * folder missing from disk.
   */
  hasFile: z.boolean().optional(),
  year: z.number().int().optional(),
});
export type ArrMedia = z.infer<typeof arrMediaSchema>;

/** Body of an *Arr `POST /api/v3/command` acknowledgement. */
export const arrCommandSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string().optional(),
});
export type ArrCommand = z.infer<typeof arrCommandSchema>;

/**
 * *Arr v3 PUT endpoints REPLACE the resource - a partial body silently wipes the
 * omitted fields. Always fetch the raw resource, merge the changed keys onto it,
 * then PUT the merged object back.
 */
export function mergeForPut(raw: ArrJson, patch: ArrJson): ArrJson {
  return { ...raw, ...patch };
}

/** Parse an *Arr list response into view+raw pairs. */
export function toResources<TView>(
  schema: z.ZodType<TView>,
  body: unknown,
): ArrResource<TView>[] {
  if (!Array.isArray(body)) {
    throw new TypeError('Expected a JSON array from the *Arr API');
  }
  return body.map((entry) => ({
    view: schema.parse(entry),
    raw: entry as ArrJson,
  }));
}

export function toResource<TView>(schema: z.ZodType<TView>, body: unknown): ArrResource<TView> {
  return { view: schema.parse(body), raw: body as ArrJson };
}
