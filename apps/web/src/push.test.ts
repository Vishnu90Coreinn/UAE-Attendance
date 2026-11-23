import { afterEach, expect, it, vi } from "vitest";
import { forgetDeviceOnSignOut, pushSupported, readPushState } from "./push";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("reports push as unavailable where the browser has no Push API", async () => {
  expect(pushSupported()).toBe(false);
  expect(await readPushState("someone")).toBe("unavailable");
});

it("tells the server to forget this device as the person signs out, and does nothing when none was registered", () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);

  forgetDeviceOnSignOut();
  expect(fetchMock).not.toHaveBeenCalled();

  localStorage.setItem("hrpayroll.pushEndpoint", "https://push.example.com/abc");
  forgetDeviceOnSignOut();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/push/unsubscribe");
  expect(String(fetchMock.mock.calls[0][1].body)).toContain("https://push.example.com/abc");
  vi.unstubAllGlobals();
});
