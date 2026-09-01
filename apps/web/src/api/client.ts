import type { ApiErrorResponse } from '@arrranger/shared';

/** Thrown for any non-2xx /api response, carrying the server's error envelope. */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(params: { code: string; message: string; status: number; details?: unknown }) {
    super(params.message);
    this.name = 'ApiRequestError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
  }
}

const BASE = '/api';

async function request<TResponse>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<TResponse> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) {
    const envelope = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    throw new ApiRequestError({
      code: envelope?.error.code ?? 'http_error',
      message: envelope?.error.message ?? `${method} ${path} failed with ${response.status}`,
      status: response.status,
      details: envelope?.error.details,
    });
  }

  if (response.status === 204) return undefined as TResponse;
  return (await response.json()) as TResponse;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
