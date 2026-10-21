import { expect, it, vi } from "vitest";
import source from "../public/sw.js?raw";

type Listener = (event: any) => void;

/** Runs public/sw.js against stand-ins for the worker globals and returns the handlers it registered. */
function loadWorker(options: { fetch?: () => Promise<Response>; cacheNames?: string[] } = {}) {
  const listeners: Record<string, Listener> = {};
  const cache = { addAll: vi.fn().mockResolvedValue(undefined) };
  const offlinePage = new Response("offline");
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(options.cacheNames ?? []),
    delete: vi.fn().mockResolvedValue(true),
    match: vi.fn().mockResolvedValue(offlinePage),
  };
  const self = {
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
  };
  new Function("self", "caches", "fetch", source)(self, caches, options.fetch ?? vi.fn());
  return { listeners, cache, caches, self, offlinePage };
}

it("caches only the offline page and its icon when it installs", async () => {
  const { listeners, cache, self } = loadWorker();
  const event = { waitUntil: vi.fn() };

  listeners.install(event);
  await event.waitUntil.mock.calls[0][0];

  expect(cache.addAll).toHaveBeenCalledWith(["/offline.html", "/icons/icon-192.png"]);
  expect(self.skipWaiting).toHaveBeenCalled();
});

it("removes caches left by an older version and takes over open pages when it activates", async () => {
  const { listeners, caches, self } = loadWorker({ cacheNames: ["hr-payroll-offline-v0", "hr-payroll-offline-v1"] });
  const event = { waitUntil: vi.fn() };

  listeners.activate(event);
  await event.waitUntil.mock.calls[0][0];

  expect(caches.delete).toHaveBeenCalledTimes(1);
  expect(caches.delete).toHaveBeenCalledWith("hr-payroll-offline-v0");
  expect(self.clients.claim).toHaveBeenCalled();
});

it("lets an online page navigation through untouched", async () => {
  const online = new Response("page");
  const { listeners } = loadWorker({ fetch: () => Promise.resolve(online) });
  const event = { request: { mode: "navigate" }, respondWith: vi.fn() };

  listeners.fetch(event);

  expect(await event.respondWith.mock.calls[0][0]).toBe(online);
});

it("shows the offline page when a page navigation fails for lack of signal", async () => {
  const { listeners, caches, offlinePage } = loadWorker({ fetch: () => Promise.reject(new TypeError("Failed to fetch")) });
  const event = { request: { mode: "navigate" }, respondWith: vi.fn() };

  listeners.fetch(event);

  expect(await event.respondWith.mock.calls[0][0]).toBe(offlinePage);
  expect(caches.match).toHaveBeenCalledWith("/offline.html");
});

it("never intercepts API calls, scripts or other non-navigation requests", () => {
  const { listeners } = loadWorker();
  const event = { request: { mode: "cors", url: "/api/payroll/2026-10" }, respondWith: vi.fn() };

  listeners.fetch(event);

  expect(event.respondWith).not.toHaveBeenCalled();
});
