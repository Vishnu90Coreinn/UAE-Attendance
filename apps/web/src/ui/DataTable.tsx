import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "./cx";

export type SortDir = "asc" | "desc";
export type SortValue = string | number | boolean | null | undefined;

export interface SortState {
  key: string;
  dir: SortDir;
}

function compare(a: SortValue, b: SortValue): number {
  // Empty values always sort last, whichever the direction is applied to the rest.
  if (a == null || a === "") return b == null || b === "" ? 0 : 1;
  if (b == null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Click-to-sort for a list. `accessors` maps a column key to the value to sort by; the first click sorts
 * ascending, the second descending, the third returns to the original order.
 */
export function useSort<T>(rows: T[], accessors: Record<string, (row: T) => SortValue>) {
  const [sort, setSort] = useState<SortState | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const get = accessors[sort.key];
    if (!get) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((x, y) => {
      const a = get(x);
      const b = get(y);
      const emptyA = a == null || a === "";
      const emptyB = b == null || b === "";
      if (emptyA || emptyB) return compare(a, b);
      return compare(a, b) * factor;
    });
    // accessors are defined once per table, so they are intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  function toggle(key: string) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, dir: "asc" };
      return current.dir === "asc" ? { key, dir: "desc" } : null;
    });
  }
  return { sorted, sort, toggle };
}

interface SortThProps {
  label: string;
  sortKey: string;
  sort: SortState | null;
  onToggle: (key: string) => void;
  className?: string;
  align?: "right";
}

/** Column heading that sorts when pressed and tells assistive technology the current order. */
export function SortTh({ label, sortKey, sort, onToggle, className, align }: SortThProps) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={className}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={cx(
          "group inline-flex items-center gap-1 rounded uppercase tracking-[inherit] hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        <Icon aria-hidden="true" size={12} className={cx(active ? "text-brand-600" : "text-ink-300 group-hover:text-ink-500")} />
      </button>
    </th>
  );
}

/** Splits a list into pages. The page number is kept in range when the list shrinks (a filter, a deletion). */
export function usePaging<T>(rows: T[], pageSize = 25) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  return { pageRows: rows.slice(start, start + pageSize), page: current, pages, setPage, total: rows.length, start, pageSize };
}

interface PagerProps {
  page: number;
  pages: number;
  total: number;
  start: number;
  pageSize: number;
  onPage: (page: number) => void;
  className?: string;
  children?: ReactNode;
}

const pagerButton =
  "inline-flex size-9 items-center justify-center rounded-lg border border-ink-300 bg-white text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

/** "Showing 1-25 of 61" with Previous and Next. Renders nothing when everything fits on one page. */
export function Pager({ page, pages, total, start, pageSize, onPage, className }: PagerProps) {
  if (pages <= 1) return null;
  const end = Math.min(start + pageSize, total);
  return (
    <nav aria-label="Pagination" className={cx("flex items-center justify-between gap-3 px-1 pt-3 text-sm text-ink-600", className)}>
      <p>
        Showing {start + 1}-{end} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className={pagerButton} aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft aria-hidden="true" size={16} />
        </button>
        <span className="tabular-nums">
          Page {page} of {pages}
        </span>
        <button type="button" className={pagerButton} aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </div>
    </nav>
  );
}
