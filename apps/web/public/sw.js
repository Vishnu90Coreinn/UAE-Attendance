// Minimal service worker: it makes the app installable and shows a friendly page when the phone has no signal.
//
// It deliberately caches nothing but that offline page. Pages, scripts and API responses (which include wages) always
// come from the network, so a deployment reaches every phone straight away and no pay data is stored by the worker.
//
// Hosting note: serve this file with `Cache-Control: no-cache` so browsers pick up a changed worker promptly.
const CACHE = "hr-payroll-offline-v1";
const OFFLINE_URL = "/offline.html";
const OFFLINE_ASSETS = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Only page navigations fall back to the offline page; every other request is left to the browser.
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
