import { cx } from "./cx";

/** The box around a row of either/or choices (a period, a grouping). Use with `segmentClass` on each button. */
export const segmentGroupClass = "inline-flex max-w-full flex-wrap rounded-lg border border-line bg-white p-0.5";

export function segmentClass(selected: boolean) {
  return cx(
    "min-h-11 rounded-md px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-9",
    selected ? "bg-sidebar text-white" : "text-ink-700 hover:bg-ink-50",
  );
}
