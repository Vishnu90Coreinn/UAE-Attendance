import { afterEach, describe, expect, it, vi } from "vitest";
import { getHealth } from "./health";

function respond(body: unknown, status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getHealth", () => {
  it("returns the body when the API and database are healthy", async () => {
    respond({ status: "ok", database: "ok" }, 200);

    await expect(getHealth()).resolves.toEqual({ status: "ok", database: "ok" });
  });

  it("returns the body for a degraded 503 instead of throwing", async () => {
    respond({ status: "degraded", database: "unreachable" }, 503);

    await expect(getHealth()).resolves.toEqual({ status: "degraded", database: "unreachable" });
  });

  it("throws for any other failure", async () => {
    respond({ title: "An unexpected error occurred.", status: 500 }, 500);

    await expect(getHealth()).rejects.toMatchObject({ status: 500 });
  });
});
