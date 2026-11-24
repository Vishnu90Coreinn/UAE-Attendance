import { useState } from "react";
import { Search } from "lucide-react";
import type { Worker } from "../api/workers";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : ""}`.toUpperCase();
}

/**
 * Choosing one worker on a phone: search by name or ID in a short scrolling list, then the choice shows as a card with a
 * Change button. Better than a drop-down of fifty names, where nothing can be typed to narrow it down.
 */
export function WorkerPicker({
  workers,
  value,
  onChange,
  error,
  disabled = false,
  loading = false,
}: {
  /** The workers that may be chosen; the caller decides who is eligible. */
  workers: Worker[];
  /** The chosen worker's id as a string, or "" for nobody yet. */
  value: string;
  onChange: (id: string) => void;
  error?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [query, setQuery] = useState("");
  const chosen = workers.find((w) => String(w.id) === value);
  const term = query.trim().toLowerCase();
  const matches = workers
    .filter((w) => !term || w.fullName.toLowerCase().includes(term) || w.workerCode.toLowerCase().includes(term))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return (
    <fieldset disabled={disabled} className="space-y-1.5">
      <legend className="text-sm font-bold text-ink-800">Worker</legend>
      {chosen ? (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-ink-50 px-3 py-2.5">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
            {initials(chosen.fullName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-base font-semibold text-ink-900">{chosen.fullName}</span>
            <span className="block text-[0.8125rem] text-ink-600">{chosen.workerCode}</span>
          </span>
          <button
            type="button"
            aria-label="Change worker"
            onClick={() => {
              onChange("");
              setQuery("");
            }}
            className={`min-h-11 rounded-xl px-3 text-sm font-bold text-brand-700 active:bg-brand-50 ${focusRing}`}
          >
            Change
          </button>
        </div>
      ) : (
        <div>
          <div className="relative">
            <label htmlFor="worker-picker-search" className="sr-only">
              Search workers
            </label>
            <Search aria-hidden="true" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500" />
            <input
              id="worker-picker-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={loading ? "Loading workers..." : "Search name or ID"}
              autoComplete="off"
              aria-invalid={!!error}
              className={`block min-h-12 w-full rounded-xl border bg-white pl-10 pr-3 text-base text-ink-900 placeholder:text-ink-500 ${focusRing} ${error ? "border-red-500" : "border-ink-300"}`}
            />
          </div>
          <ul aria-label="Workers" className="mt-2 max-h-44 divide-y divide-ink-100 overflow-y-auto rounded-2xl border border-line bg-white">
            {matches.length === 0 && (
              <li className="px-4 py-3 text-sm text-ink-600">{loading ? "Loading workers..." : `No worker matches "${query.trim()}".`}</li>
            )}
            {matches.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => onChange(String(w.id))}
                  className={`flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left active:bg-ink-50 ${focusRing}`}
                >
                  <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-100 text-xs font-bold text-ink-700">
                    {initials(w.fullName)}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-base font-medium text-ink-900">{w.fullName}</span>
                  <span className="shrink-0 text-xs text-ink-600">{w.workerCode}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </fieldset>
  );
}
