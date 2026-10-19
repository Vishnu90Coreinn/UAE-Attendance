import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet } from "./client";

function respond(body: BodyInit | null, init: ResponseInit) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, init)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiGet", () => {
  it("returns the parsed JSON body on success", async () => {
    respond(JSON.stringify({ hello: "world" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(apiGet<{ hello: string }>("/api/thing")).resolves.toEqual({ hello: "world" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/thing",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
  });

  it("throws an ApiError carrying the problem title, status and correlation id", async () => {
    respond(
      JSON.stringify({ title: "An unexpected error occurred.", status: 500, correlationId: "abc-123" }),
      { status: 500, headers: { "Content-Type": "application/problem+json" } },
    );

    const error = await apiGet("/api/thing").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 500,
      message: "An unexpected error occurred.",
      correlationId: "abc-123",
    });
  });

  it("throws a generic ApiError when the failure body is not JSON", async () => {
    respond("Bad gateway", { status: 502, headers: { "Content-Type": "text/plain" } });

    const error = await apiGet("/api/thing").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, message: "Request failed (502)" });
  });

  it("throws an ApiError with status 0 when the network request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await apiGet("/api/thing").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, message: "Unable to reach the server." });
  });
});
