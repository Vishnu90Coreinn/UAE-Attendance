import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

/** Applies "?q=…" to a list's own search, on arrival and each time the top bar sends a new one to the page already open. */
export function useUrlSearch(apply: (q: string) => void): void {
  const [params] = useSearchParams();
  const q = params.get("q");
  useEffect(() => {
    if (q !== null) apply(q);
  }, [q]);   // apply is a fresh function each render; only a new search should run it
}
