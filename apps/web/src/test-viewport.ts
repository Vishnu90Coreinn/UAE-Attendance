/**
 * Test helper: makes `window.matchMedia` report a phone-width or desktop-width screen, so components that pick a layout
 * by width render the one under test. jsdom has no `matchMedia`, so without this every test runs as desktop.
 */
export function mockViewport(initial: "phone" | "desktop") {
  let desktop = initial === "desktop";
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return desktop;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
  return {
    /** Simulates the window being resized across the phone/desktop breakpoint. */
    resize(kind: "phone" | "desktop") {
      desktop = kind === "desktop";
      listeners.forEach((listener) => listener());
    },
  };
}

export function restoreViewport() {
  Reflect.deleteProperty(window, "matchMedia");
}
