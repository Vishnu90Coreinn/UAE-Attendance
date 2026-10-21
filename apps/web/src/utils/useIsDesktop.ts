import { useSyncExternalStore } from "react";

/** Tailwind's `md` breakpoint: from here up the app keeps its desktop layout. */
const DESKTOP_QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void) {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP_QUERY) : null;
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function currentlyDesktop() {
  return typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP_QUERY).matches : true;
}

/**
 * True on screens at or above the desktop breakpoint. Used where the phone layout is a different arrangement of the
 * page, not just a restyle, so only one of the two is ever in the DOM. Assumes desktop when the width is unknown.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, currentlyDesktop, () => true);
}
