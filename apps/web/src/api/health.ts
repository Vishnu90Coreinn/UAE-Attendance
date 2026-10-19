import { ApiError, apiGet } from "./client";

export interface HealthResponse {
  status: "ok" | "degraded";
  database: "ok" | "unreachable";
}

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "database" in value
  );
}

/** The API answers 503 with a normal health body when the database is down; treat that as data, not an error. */
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  try {
    return await apiGet<HealthResponse>("/api/health", signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 503 && isHealthResponse(error.body)) {
      return error.body;
    }
    throw error;
  }
}
