/** Base class for errors that are safe to surface to the UI. */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details: unknown;

  constructor(code: string, message: string, httpStatus = 500, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super('not_found', `${what} not found`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('validation_failed', message, 400, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('conflict', message, 409, details);
  }
}

/**
 * A failed call against a Radarr/Sonarr instance. Carries enough context for the
 * queue's error drawer to show exactly which request broke and why.
 */
export class ArrApiError extends AppError {
  readonly method: string;
  readonly url: string;
  readonly responseBody: string | null;

  constructor(params: {
    code?: string;
    message: string;
    method: string;
    url: string;
    httpStatus?: number;
    responseBody?: string | null;
  }) {
    super(params.code ?? 'arr_request_failed', params.message, params.httpStatus ?? 502);
    this.method = params.method;
    this.url = params.url;
    this.responseBody = params.responseBody ?? null;
  }
}

/**
 * A refused or failed filesystem operation. Carries the path so the UI can point at the
 * exact directory, and a code the storage views can act on.
 */
export class FsError extends AppError {
  readonly path: string | null;

  constructor(params: {
    code: string;
    message: string;
    path?: string | null;
    httpStatus?: number;
    details?: unknown;
  }) {
    super(params.code, params.message, params.httpStatus ?? 400, params.details);
    this.path = params.path ?? null;
  }
}

export interface SerialisedError {
  readonly code: string;
  readonly message: string;
  readonly httpStatus: number;
  readonly details?: unknown;
}

/** Normalise anything thrown into the API's error envelope. */
export function serialiseError(error: unknown): SerialisedError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      httpStatus: error.httpStatus,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  if (error instanceof Error) {
    return { code: 'internal_error', message: error.message, httpStatus: 500 };
  }
  return { code: 'internal_error', message: 'Unknown error', httpStatus: 500 };
}
