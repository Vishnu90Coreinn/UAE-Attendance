/** Error thrown for any failed API call. `status` is 0 when the server could not be reached. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly correlationId?: string,
    public readonly body?: unknown,
    /** Validation errors from a ValidationProblemDetails response, keyed by (camelCase) field name. */
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  /** Do not treat a 401 as an expired session (used by the login call itself). */
  skipUnauthorizedHandler?: boolean;
}

let authToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

/** Sets (or clears, with null) the bearer token sent with every request. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Registers the callback run when the API answers 401 (session expired or token rejected). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("json")) {
    return undefined;
  }
  return response.json().catch(() => undefined);
}

function parseFieldErrors(
  problem: Record<string, unknown> | undefined,
): Record<string, string[]> | undefined {
  if (!isRecord(problem?.errors)) {
    return undefined;
  }
  const result: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(problem.errors)) {
    if (Array.isArray(messages)) {
      const texts = messages.filter((m): m is string => typeof m === "string");
      if (texts.length > 0) {
        result[field] = texts;
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function toApiError(response: Response, body: unknown): ApiError {
  const problem = isRecord(body) ? body : undefined;
  const fieldErrors = parseFieldErrors(problem);
  const firstFieldError = fieldErrors
    ? Object.values(fieldErrors)[0][0]
    : undefined;
  const message =
    firstFieldError ??
    (typeof problem?.title === "string"
      ? problem.title
      : `Request failed (${response.status})`);
  const correlationId =
    typeof problem?.correlationId === "string"
      ? problem.correlationId
      : (response.headers.get("X-Correlation-ID") ?? undefined);

  return new ApiError(
    response.status,
    message,
    correlationId,
    body,
    fieldErrors,
  );
}

async function send<T>(
  path: string,
  init: RequestInit,
  options?: RequestOptions,
  pdf = false,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: pdf ? "application/pdf" : "application/json",
    ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(0, "Unable to reach the server.");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (response.ok && pdf) {
    if (
      response.headers
        .get("Content-Type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/pdf"
    ) {
      throw new ApiError(
        502,
        "The server did not return a PDF. Please try again.",
      );
    }
    return (await response.blob()) as T;
  }

  const body = await readJson(response);
  if (!response.ok) {
    if (response.status === 401 && !options?.skipUnauthorizedHandler) {
      unauthorizedHandler?.();
    }
    throw toApiError(response, body);
  }
  return body as T;
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return send<T>(path, { method: "GET", signal });
}

/** Authenticated PDF download; failures use the same problem parser and 401 handler as JSON requests. */
export function apiGetBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  return send<Blob>(path, { method: "GET", signal }, undefined, true);
}

export function apiPost<T = void>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  options?: RequestOptions,
): Promise<T> {
  return send<T>(
    path,
    { method: "POST", body: JSON.stringify(body), signal },
    options,
  );
}

export function apiPut<T = void>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  options?: RequestOptions,
): Promise<T> {
  return send<T>(
    path,
    { method: "PUT", body: JSON.stringify(body), signal },
    options,
  );
}

export function apiDelete(
  path: string,
  signal?: AbortSignal,
  options?: RequestOptions,
): Promise<void> {
  return send<void>(path, { method: "DELETE", signal }, options);
}

/** DELETE with a required JSON payload and a JSON result, using the same auth/problem handling. */
export function apiDeleteJson<T>(path: string, body: unknown): Promise<T> {
  return send<T>(path, { method: "DELETE", body: JSON.stringify(body) });
}
