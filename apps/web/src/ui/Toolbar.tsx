import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/** The row under a page header that holds what the page is showing (a month, filters) and what to do with it. Fields on the left, buttons on the right. */
export function Toolbar({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("flex flex-wrap items-end justify-between gap-3 rounded-card border border-line bg-white p-4 shadow-card", className)} {...rest} />;
}
