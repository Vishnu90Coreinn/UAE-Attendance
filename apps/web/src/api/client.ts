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

let tokenRenewedHandler: ((token: string) => void) | null = null;
let renewal: Promise<void> | null = null;

/** Registers the callback run when the server replaces the signed-in token, so it can be kept for the next page load. */
export function setTokenRenewedHandler(handler: ((token: string) => void) | null): void {
  tokenRenewedHandler = handler;
}

/** Runs a request that ends the current token and answers with its replacement (a password change). */
export function renewingToken(request: () => Promise<{ token: string } | undefined>): Promise<void> {
  const run = request().then((response) => {
    if (response?.token) {
      authToken = response.token;
      tokenRenewedHandler?.(response.token);
    }
  });
  const settled: Promise<void> = run
    .catch(() => undefined)
    .then(() => {
      if (renewal === settled) renewal = null;
    });
  renewal = settled;
  return run;
}

/** A 401 ends the session only if it answers the token still in use: one sent just before the token was replaced says nothing about the new one. */
function sessionRejected(sentToken: string | null): void {
  const check = () => {
    if (sentToken === authToken) unauthorizedHandler?.();
  };
  if (renewal) void renewal.then(check);
  else check();
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
  /** true expects a PDF; a string expects a download of that content type. */
  pdf: boolean | string = false,
): Promise<T> {
  const sentToken = authToken;
  const headers: Record<string, string> = {
    Accept: pdf ? (typeof pdf === "string" ? pdf : "application/pdf") : "application/json",
    // A FormData body gets its multipart content type (with the boundary) from the browser.
    ...(init.body !== undefined && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
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
        .toLowerCase() !== (typeof pdf === "string" ? pdf : "application/pdf")
    ) {
      throw new ApiError(
        502,
        typeof pdf === "string"
          ? "The server did not return the file. Please try again."
          : "The server did not return a PDF. Please try again.",
      );
    }
    return (await response.blob()) as T;
  }

  const body = await readJson(response);
  if (!response.ok) {
    if (response.status === 401 && !options?.skipUnauthorizedHandler) {
      sessionRejected(sentToken);
    }
    throw toApiError(response, body);
  }
  return body as T;
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return send<T>(path, { method: "GET", signal });
}

/** Authenticated file download of a given content type, for example an Excel workbook. */
export function apiGetFile(path: string, contentType: string, signal?: AbortSignal): Promise<Blob> {
  return send<Blob>(path, { method: "GET", signal }, undefined, contentType);
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

/** POST a multipart form (fields and files), with the same auth and problem handling as JSON requests. */
export function apiPostForm<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
  return send<T>(path, { method: "POST", body: form, signal });
}

/** Authenticated download of any file type (for example a receipt that may be a PDF or an image). */
export async function apiGetAnyFile(path: string, signal?: AbortSignal): Promise<Blob> {
  const sentToken = authToken;
  let response: Response;
  try {
    response = await fetch(path, { method: "GET", signal, headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Unable to reach the server.");
  }
  if (!response.ok) {
    if (response.status === 401) sessionRejected(sentToken);
    throw toApiError(response, await readJson(response));
  }
  return response.blob();
}

/** PUT a multipart form (fields and files), with the same auth and problem handling as JSON requests. */
export function apiPutForm<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
  return send<T>(path, { method: "PUT", body: form, signal });
}
