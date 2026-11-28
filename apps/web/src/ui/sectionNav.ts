import { cx } from "./cx";

/** Links that jump to the parts of one long page (Settings, Finance setup). */
export const sectionNavClass = "flex flex-wrap gap-1 border-b border-line text-sm";

export function sectionLinkClass(active: boolean) {
  return cx(
    "-mb-px inline-flex min-h-11 items-center border-b-2 px-3 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-500 md:min-h-10",
    active ? "border-brand-600 text-brand-700" : "border-transparent text-ink-600 hover:border-brand-300 hover:text-ink-900",
  );
}
