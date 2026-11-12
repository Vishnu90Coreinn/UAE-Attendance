/** True when the page was opened with ?new=1 (the dashboard's quick actions). Pure, so it is safe in a state initialiser. */
export function hasNewParam(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1";
}

/** Removes ?new=1 so a refresh or the back button does not open the form again. Call from an effect. */
export function clearNewParam(): void {
  if (!hasNewParam()) return;
  const params = new URLSearchParams(window.location.search);
  params.delete("new");
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}
