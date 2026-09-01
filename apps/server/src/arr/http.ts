import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';
import type { InstanceWithKey } from '@arrranger/shared';
import { ArrApiError } from '../lib/errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ArrRequestOptions {
  readonly method?: HttpMethod;
  /** Path below /api/v3, e.g. '/tag' or '/movie/editor'. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** One HTTP exchange, recorded so a failed queue item can show what actually happened. */
export interface ArrHttpTrace {
  readonly method: HttpMethod;
  readonly url: string;
  readonly status: number | null;
  readonly requestBody: string | null;
  readonly responseBody: string | null;
  readonly durationMs: number;
  readonly error: string | null;
}

export type TraceSink = (trace: ArrHttpTrace) => void;

/** Response bodies are stored for the audit trail - cap what we keep. */
const MAX_TRACE_BODY = 2000;

function truncate(value: string | null): string | null {
  if (value === null) return null;
  return value.length <= MAX_TRACE_BODY ? value : `${value.slice(0, MAX_TRACE_BODY)}… (truncated)`;
}

/** Radarr/Sonarr 400 bodies come back as an array of these. */
interface ArrValidationFailure {
  readonly propertyName?: string;
  readonly errorMessage?: string;
  readonly severity?: string;
}

/** …or as a single object with message/description. */
interface ArrErrorObject {
  readonly message?: string;
  readonly description?: string;
  readonly error?: string;
}

function describeErrorBody(status: number, text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    // HTML from a reverse proxy, or an empty body.
    const trimmed = text.trim();
    if (trimmed.length === 0) return `HTTP ${status} with an empty body`;
    return `HTTP ${status}: ${trimmed.slice(0, 200)}`;
  }

  if (Array.isArray(parsed)) {
    const failures = parsed as ArrValidationFailure[];
    const rendered = failures
      .map((failure) => {
        const property = failure.propertyName?.trim();
        const message = failure.errorMessage?.trim() ?? 'invalid value';
        return property ? `${property}: ${message}` : message;
      })
      .filter((entry) => entry.length > 0);
    if (rendered.length > 0) return rendered.join('; ');
  }

  if (parsed !== null && typeof parsed === 'object') {
    const object = parsed as ArrErrorObject;
    const message = object.message ?? object.error ?? object.description;
    if (message) return message;
  }

  return `HTTP ${status}: ${text.slice(0, 200)}`;
}

interface NodeErrorLike {
  readonly name?: string;
  readonly message?: string;
  readonly code?: string;
  readonly cause?: NodeErrorLike;
  /** A host resolving to both A and AAAA records fails as an AggregateError. */
  readonly errors?: readonly NodeErrorLike[];
}

/** TLS failures that a `verifySsl: false` toggle would fix. */
const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function findCode(error: NodeErrorLike | undefined, depth = 0): string | undefined {
  if (!error || depth > 5) return undefined;
  if (error.code !== undefined) return error.code;

  for (const nested of error.errors ?? []) {
    const code = findCode(nested, depth + 1);
    if (code !== undefined) return code;
  }

  return findCode(error.cause, depth + 1);
}

/**
 * Turn whatever fetch threw into an ArrApiError with a code the UI can act on.
 * These are the failures a homelab actually hits: wrong URL base, self-signed
 * certificate behind a reverse proxy, container not up yet, instance asleep.
 */
export function mapTransportError(
  error: unknown,
  context: { method: HttpMethod; url: string; timeoutMs: number; aborted: boolean },
): ArrApiError {
  const nodeError = error as NodeErrorLike | undefined;
  const code = findCode(nodeError);
  const name = nodeError?.name;

  if (name === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
    return new ArrApiError({
      code: 'arr_timeout',
      message: `No response within ${context.timeoutMs}ms`,
      method: context.method,
      url: context.url,
      httpStatus: 504,
    });
  }

  if (name === 'AbortError' || code === 'ABORT_ERR') {
    return new ArrApiError({
      code: context.aborted ? 'arr_cancelled' : 'arr_timeout',
      message: context.aborted ? 'Request cancelled' : `No response within ${context.timeoutMs}ms`,
      method: context.method,
      url: context.url,
      httpStatus: context.aborted ? 499 : 504,
    });
  }

  if (code !== undefined && TLS_CODES.has(code)) {
    return new ArrApiError({
      code: 'arr_tls_untrusted',
      message: `TLS certificate rejected (${code}). Disable "Verify SSL" for this instance if it uses a self-signed certificate.`,
      method: context.method,
      url: context.url,
      httpStatus: 502,
    });
  }

  switch (code) {
    case 'ECONNREFUSED':
      return new ArrApiError({
        code: 'arr_unreachable',
        message: 'Connection refused - is the instance running and the port correct?',
        method: context.method,
        url: context.url,
      });
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new ArrApiError({
        code: 'arr_dns_failure',
        message: 'Hostname could not be resolved',
        method: context.method,
        url: context.url,
      });
    case 'ECONNRESET':
    case 'UND_ERR_SOCKET':
      return new ArrApiError({
        code: 'arr_connection_reset',
        message: 'Connection reset by the instance',
        method: context.method,
        url: context.url,
      });
    default:
      return new ArrApiError({
        code: 'arr_request_failed',
        message: nodeError?.message ?? 'Request failed',
        method: context.method,
        url: context.url,
      });
  }
}

function mapResponseError(params: {
  status: number;
  text: string;
  method: HttpMethod;
  url: string;
}): ArrApiError {
  const detail = describeErrorBody(params.status, params.text);
  const base = { method: params.method, url: params.url, httpStatus: params.status, responseBody: truncate(params.text) };

  if (params.status === 401 || params.status === 403) {
    return new ArrApiError({ ...base, code: 'arr_unauthorized', message: `API key rejected (${detail})` });
  }
  if (params.status === 404) {
    return new ArrApiError({
      ...base,
      code: 'arr_not_found',
      message: `Endpoint not found. Check the base URL - a reverse proxy URL base must be part of it. (${detail})`,
    });
  }
  if (params.status === 400 || params.status === 422) {
    return new ArrApiError({ ...base, code: 'arr_validation_failed', message: detail });
  }
  if (params.status === 409) {
    return new ArrApiError({ ...base, code: 'arr_conflict', message: detail });
  }
  if (params.status >= 500) {
    return new ArrApiError({ ...base, code: 'arr_server_error', message: detail });
  }
  return new ArrApiError({ ...base, code: 'arr_request_failed', message: detail });
}

/**
 * Owns one undici Agent per instance so the TLS opt-out and connection timeouts are
 * applied consistently, and sockets are reused across queue steps.
 */
export class ArrDispatcherPool {
  private readonly dispatchers = new Map<number, Agent>();

  get(instance: InstanceWithKey): Dispatcher {
    const existing = this.dispatchers.get(instance.id);
    if (existing) return existing;

    const agent = new Agent({
      headersTimeout: instance.timeoutMs,
      bodyTimeout: instance.timeoutMs,
      connect: {
        timeout: Math.min(instance.timeoutMs, 10_000),
        // Homelab reality: most instances sit behind a self-signed reverse proxy.
        rejectUnauthorized: instance.verifySsl,
      },
    });
    this.dispatchers.set(instance.id, agent);
    return agent;
  }

  /**
   * Agent for credentials that are not saved yet (the "Test" button on the add form).
   * The caller owns it and must close it - it is deliberately not pooled, because two
   * candidates may differ in exactly the TLS setting being tested.
   */
  createEphemeral(options: { verifySsl: boolean; timeoutMs: number }): Agent {
    return new Agent({
      headersTimeout: options.timeoutMs,
      bodyTimeout: options.timeoutMs,
      connect: {
        timeout: Math.min(options.timeoutMs, 10_000),
        rejectUnauthorized: options.verifySsl,
      },
    });
  }

  /** Called when an instance is edited or deleted - its TLS settings may have changed. */
  async invalidate(instanceId: number): Promise<void> {
    const agent = this.dispatchers.get(instanceId);
    if (!agent) return;
    this.dispatchers.delete(instanceId);
    await agent.close();
  }

  async closeAll(): Promise<void> {
    const agents = [...this.dispatchers.values()];
    this.dispatchers.clear();
    await Promise.all(agents.map((agent) => agent.close()));
  }
}

export interface ArrTransportDeps {
  readonly dispatcher: Dispatcher;
  readonly onTrace?: TraceSink;
}

/** Performs one request against an *Arr instance and returns the parsed JSON body. */
export async function arrRequest<T>(
  instance: InstanceWithKey,
  options: ArrRequestOptions,
  deps: ArrTransportDeps,
): Promise<T> {
  const method = options.method ?? 'GET';
  const timeoutMs = options.timeoutMs ?? instance.timeoutMs;

  const url = new URL(`${instance.baseUrl}/api/v3${options.path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const href = url.toString();

  const requestBody = options.body === undefined ? null : JSON.stringify(options.body);
  const startedAt = performance.now();

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  let status: number | null = null;
  let responseText: string | null = null;
  let traceError: string | null = null;

  try {
    const response = await undiciFetch(href, {
      method,
      headers: {
        'x-api-key': instance.apiKey,
        accept: 'application/json',
        ...(requestBody === null ? {} : { 'content-type': 'application/json' }),
      },
      ...(requestBody === null ? {} : { body: requestBody }),
      signal,
      dispatcher: deps.dispatcher,
    });

    status = response.status;
    responseText = await response.text();

    if (!response.ok) {
      throw mapResponseError({ status, text: responseText, method, url: href });
    }

    if (responseText.trim().length === 0) return undefined as T;

    try {
      return JSON.parse(responseText) as T;
    } catch {
      // A login page or an error page from a proxy in front of the instance.
      throw new ArrApiError({
        code: 'arr_unexpected_response',
        message:
          'Expected JSON but got something else - the base URL probably points at a proxy or web UI rather than the *Arr API',
        method,
        url: href,
        httpStatus: status,
        responseBody: truncate(responseText),
      });
    }
  } catch (error) {
    const mapped =
      error instanceof ArrApiError
        ? error
        : mapTransportError(error, {
            method,
            url: href,
            timeoutMs,
            aborted: options.signal?.aborted === true,
          });
    traceError = `${mapped.code}: ${mapped.message}`;
    throw mapped;
  } finally {
    deps.onTrace?.({
      method,
      url: href,
      status,
      requestBody: truncate(requestBody),
      responseBody: truncate(responseText),
      durationMs: Math.round(performance.now() - startedAt),
      error: traceError,
    });
  }
}
