import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cx } from "./cx";

/** Scroll container so a wide table scrolls inside its card, never the page. */
export function TableScroll({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("relative w-full overflow-x-auto", className)} {...rest} />;
}

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cx("w-full border-collapse text-left text-sm", className)} {...rest} />;
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cx("bg-ink-50 text-xs uppercase tracking-wide text-ink-600", className)} {...rest} />;
}

export function Th({ className, align, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: "right" }) {
  return (
    <th
      scope="col"
      className={cx("border-b border-line px-4 py-3 font-semibold", align === "right" && "text-right", className)}
      {...rest}
    />
  );
}

export function TRow({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cx("border-b border-line last:border-b-0 hover:bg-ink-50/70", className)} {...rest} />;
}

/** `numeric` right-aligns and uses tabular figures for money and hours. */
export function Td({ className, numeric, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cx("px-4 py-3 text-ink-800", numeric && "text-right tabular-nums", className)} {...rest} />;
}
