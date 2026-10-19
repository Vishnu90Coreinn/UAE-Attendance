/** Error thrown for any failed API call. `status` is 0 when the server could not be reached. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly correlationId?: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
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

function toApiError(response: Response, body: unknown): ApiError {
  const problem = isRecord(body) ? body : undefined;
  const message =
    typeof problem?.title === "string" ? problem.title : `Request failed (${response.status})`;
  const correlationId =
    typeof problem?.correlationId === "string"
      ? problem.correlationId
      : (response.headers.get("X-Correlation-ID") ?? undefined);

  return new ApiError(response.status, message, correlationId, body);
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: "GET", headers: { Accept: "application/json" }, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(0, "Unable to reach the server.");
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw toApiError(response, body);
  }
  return body as T;
}
