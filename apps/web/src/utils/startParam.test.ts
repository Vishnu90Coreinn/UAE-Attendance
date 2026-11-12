import { afterEach, describe, expect, it } from "vitest";
import { clearNewParam, hasNewParam } from "./startParam";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("new-form start parameter", () => {
  it("is false without ?new=1", () => {
    window.history.replaceState(null, "", "/workers");
    expect(hasNewParam()).toBe(false);
  });
  it("is true with ?new=1 and is removed by clearNewParam, keeping other parameters", () => {
    window.history.replaceState(null, "", "/workers?new=1&q=ali");
    expect(hasNewParam()).toBe(true);
    clearNewParam();
    expect(hasNewParam()).toBe(false);
    expect(window.location.search).toBe("?q=ali");
  });
});
