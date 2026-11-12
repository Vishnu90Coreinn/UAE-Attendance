import { Skeleton } from "./Skeleton";

interface LoadingStateProps {
  /** Read out to screen readers, for example "Loading workers...". */
  label: string;
  /** Placeholder rows to draw. */
  rows?: number;
  /** "cards" draws a strip of summary cards above the rows. */
  withCards?: boolean;
}

/** Skeleton rows (and optionally summary cards) with the same footprint as a loaded list, so the page does not jump. */
export function LoadingState({ label, rows = 6, withCards = false }: LoadingStateProps) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {withCards && (
        <div aria-hidden="true" className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-card" />
          ))}
        </div>
      )}
      <div aria-hidden="true" className="overflow-hidden rounded-card border border-line bg-white shadow-card">
        <Skeleton className="h-10 rounded-none" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-t border-line px-4 py-3.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-32 sm:block" />
            <Skeleton className="hidden h-4 w-20 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
