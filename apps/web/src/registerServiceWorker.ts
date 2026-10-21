/**
 * Registers the service worker that lets phones install the app to the home screen and shows an offline page.
 * Production builds only: in development a worker would get in the way of hot reloading.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener(
    "load",
    () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // The app works fine without it; the phone just will not offer to install it.
      });
    },
    { once: true },
  );
}
