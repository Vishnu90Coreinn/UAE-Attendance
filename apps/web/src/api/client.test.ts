import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiDelete,
  apiDeleteJson,
  apiGet,
  apiGetBlob,
  apiPost,
  apiPut,
  setAuthToken,
  setUnauthorizedHandler,
} from "./client";

function respond(body: BodyInit | null, init: ResponseInit) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, init)));
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(null);
  setUnauthorizedHandler(null);
});

function sentHeaders(): Record<string, string> {
  const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
  return init.headers as Record<string, string>;
}

it("sends an authenticated DELETE reason and reads the returned report", async () => {
  setAuthToken("reopen-token");
  respond(JSON.stringify({ status: "Draft" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  await expect(
    apiDeleteJson("/api/payroll/2026-10/finalise", { reason: "Correction" }),
  ).resolves.toEqual({ status: "Draft" });
  expect(fetch).toHaveBeenCalledWith(
    "/api/payroll/2026-10/finalise",
    expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ reason: "Correction" }),
    }),
  );
  expect(sentHeaders()).toMatchObject({
    Authorization: "Bearer reopen-token",
    "Content-Type": "application/json",
  });
});

describe("apiGetBlob", () => {
  it("downloads a PDF with the same bearer authentication", async () => {
    setAuthToken("pdf-token");
    respond("%PDF-1.7 sample", {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    });
    const blob = await apiGetBlob("/api/payroll/pdf?month=2026-10");
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("application/pdf");
    expect(sentHeaders()).toMatchObject({
      Authorization: "Bearer pdf-token",
      Accept: "application/pdf",
    });
  });
  it("parses problem details and signs out on 401", async () => {
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    respond(
      JSON.stringify({
        title: "Session expired",
        correlationId: "pdf-request",
      }),
      { status: 401, headers: { "Content-Type": "application/problem+json" } },
    );
    await expect(apiGetBlob("/api/payroll/pdf")).rejects.toMatchObject({
      status: 401,
      message: "Session expired",
      correlationId: "pdf-request",
    });
    expect(unauthorized).toHaveBeenCalledOnce();
  });
  it("preserves conflict errors for stale payroll", async () => {
    respond(
      JSON.stringify({
        title: "Payroll changed. Reload the report before exporting.",
      }),
      { status: 409, headers: { "Content-Type": "application/problem+json" } },
    );
    await expect(apiGetBlob("/api/payroll/pdf")).rejects.toMatchObject({
      status: 409,
      message: "Payroll changed. Reload the report before exporting.",
    });
  });
  it("rejects a successful response that is not a PDF", async () => {
    respond("<html>Sign in</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
    await expect(apiGetBlob("/api/payroll/pdf")).rejects.toMatchObject({
      message: "The server did not return a PDF. Please try again.",
    });
  });
  it("handles network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(apiGetBlob("/api/payroll/pdf")).rejects.toMatchObject({
      status: 0,
      message: "Unable to reach the server.",
    });
  });
});

describe("apiGet", () => {
  it("returns the parsed JSON body on success", async () => {
    respond(JSON.stringify({ hello: "world" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(apiGet<{ hello: string }>("/api/thing")).resolves.toEqual({
      hello: "world",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/thing",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    );
  });

  it("throws an ApiError carrying the problem title, status and correlation id", async () => {
    respond(
      JSON.stringify({
        title: "An unexpected error occurred.",
        status: 500,
        correlationId: "abc-123",
      }),
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
    respond("Bad gateway", {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });

    const error = await apiGet("/api/thing").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 502,
      message: "Request failed (502)",
    });
  });

  it("throws an ApiError with status 0 when the network request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const error = await apiGet("/api/thing").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 0,
      message: "Unable to reach the server.",
    });
  });
});

describe("apiGet authentication", () => {
  it("sends no Authorization header without a token", async () => {
    respond("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await apiGet("/api/thing");

    expect(sentHeaders()).not.toHaveProperty("Authorization");
  });

  it("sends the bearer token once one is set", async () => {
    setAuthToken("abc.def");
    respond("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await apiGet("/api/thing");

    expect(sentHeaders()).toMatchObject({ Authorization: "Bearer abc.def" });
  });

  it("stops sending the token after it is cleared", async () => {
    setAuthToken("abc.def");
    setAuthToken(null);
    respond("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await apiGet("/api/thing");

    expect(sentHeaders()).not.toHaveProperty("Authorization");
  });

  it("calls the unauthorized handler on a 401 and still throws", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    respond(JSON.stringify({ title: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/problem+json" },
    });

    const error = await apiGet("/api/thing").catch((e: unknown) => e);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ status: 401 });
  });

  it("does not call the unauthorized handler for other failures", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    respond(JSON.stringify({ title: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/problem+json" },
    });

    await apiGet("/api/thing").catch(() => undefined);

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("apiPost", () => {
  it("sends a JSON body with the content type and token, and returns the parsed response", async () => {
    setAuthToken("tok");
    respond(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(
      apiPost<{ ok: boolean }>("/api/thing", { a: 1 }),
    ).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledWith(
      "/api/thing",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ a: 1 }),
      }),
    );
    expect(sentHeaders()).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer tok",
    });
  });

  it("returns undefined for 204 No Content", async () => {
    respond(null, { status: 204 });

    await expect(apiPost("/api/thing", { a: 1 })).resolves.toBeUndefined();
  });

  it("parses validation errors into fieldErrors and uses the first field error as the message", async () => {
    respond(
      JSON.stringify({
        title: "One or more validation errors occurred.",
        status: 400,
        errors: {
          newPassword: ["Password is too short.", "Other"],
          currentPassword: ["Wrong."],
        },
      }),
      { status: 400, headers: { "Content-Type": "application/problem+json" } },
    );

    const error = await apiPost("/api/thing", {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      message: "Password is too short.",
      fieldErrors: {
        newPassword: ["Password is too short.", "Other"],
        currentPassword: ["Wrong."],
      },
    });
  });

  it("keeps the title when a validation response has no field errors", async () => {
    respond(JSON.stringify({ title: "Bad request.", errors: {} }), {
      status: 400,
      headers: { "Content-Type": "application/problem+json" },
    });

    const error = await apiPost("/api/thing", {}).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 400, message: "Bad request." });
  });

  it("calls the unauthorized handler on 401 unless told to skip it", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    const unauthorized = () =>
      new Response(JSON.stringify({ title: "Invalid username or password." }), {
        status: 401,
        headers: { "Content-Type": "application/problem+json" },
      });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthorized()));
    await apiPost("/api/thing", {}).catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unauthorized()));
    const error = await apiPost("/api/thing", {}, undefined, {
      skipUnauthorizedHandler: true,
    }).catch((e: unknown) => e);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({
      status: 401,
      message: "Invalid username or password.",
    });
  });

  it("throws an ApiError with status 0 when the network request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const error = await apiPost("/api/thing", {}).catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 0,
      message: "Unable to reach the server.",
    });
  });
});

describe("apiPut", () => {
  it("sends a PUT with a JSON body, the content type and the token, and returns the parsed response", async () => {
    setAuthToken("tok");
    respond(JSON.stringify({ id: 7 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(
      apiPut<{ id: number }>("/api/thing/7", { a: 1 }),
    ).resolves.toEqual({ id: 7 });

    expect(fetch).toHaveBeenCalledWith(
      "/api/thing/7",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ a: 1 }),
      }),
    );
    expect(sentHeaders()).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer tok",
    });
  });

  it("parses validation errors into fieldErrors", async () => {
    respond(
      JSON.stringify({
        title: "Invalid.",
        errors: { workerCode: ["Worker ID already exists."] },
      }),
      { status: 400, headers: { "Content-Type": "application/problem+json" } },
    );

    const error = await apiPut("/api/thing/7", {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      message: "Worker ID already exists.",
      fieldErrors: { workerCode: ["Worker ID already exists."] },
    });
  });

  it("calls the unauthorized handler on a 401", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    respond(JSON.stringify({ title: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/problem+json" },
    });

    await apiPut("/api/thing/7", {}).catch(() => undefined);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("throws an ApiError with status 0 when the network request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const error = await apiPut("/api/thing/7", {}).catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 0,
      message: "Unable to reach the server.",
    });
  });
});

describe("apiDelete", () => {
  it("sends a DELETE with the token and no body or content type, and returns undefined for 204", async () => {
    setAuthToken("tok");
    respond(null, { status: 204 });

    await expect(apiDelete("/api/thing/7")).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledWith(
      "/api/thing/7",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(sentHeaders()).toMatchObject({ Authorization: "Bearer tok" });
    expect(sentHeaders()).not.toHaveProperty("Content-Type");
  });

  it("throws an ApiError carrying the problem title and status (409)", async () => {
    respond(
      JSON.stringify({
        title: "This worker has records and cannot be deleted.",
        status: 409,
      }),
      {
        status: 409,
        headers: { "Content-Type": "application/problem+json" },
      },
    );

    const error = await apiDelete("/api/thing/7").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      message: "This worker has records and cannot be deleted.",
    });
  });

  it("calls the unauthorized handler on a 401", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    respond(JSON.stringify({ title: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/problem+json" },
    });

    await apiDelete("/api/thing/7").catch(() => undefined);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("throws an ApiError with status 0 when the network request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const error = await apiDelete("/api/thing/7").catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 0,
      message: "Unable to reach the server.",
    });
  });
});
