import { cx } from "./cx";

/** Placeholder block shown while data loads; reserves space so the page does not jump. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded-md bg-ink-100", className)} />;
}
