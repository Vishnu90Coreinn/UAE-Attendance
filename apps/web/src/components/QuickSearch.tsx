import { useEffect, useId, useRef, useState } from "react";
import { CornerDownLeft, FileText, Search } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { searchFinance, type FinSearchHit } from "../api/finance";
import { formatDay, formatMoney } from "../features/finance/financeFormat";
import { cx } from "../ui";
import { NAV_ICONS } from "./navIcons";
import type { NavItem } from "./navItems";

interface QuickSearchProps {
  /** Screens this person may open; the server still enforces access. */
  items: NavItem[];
  /** Also look for finance records (entries, bills, cheques, invoices) by number, name or amount. */
  records?: boolean;
}

type Result = { kind: "screen"; item: NavItem } | { kind: "record"; hit: FinSearchHit };

const WHERE: Record<FinSearchHit["type"], string> = { Expense: "/finance/expenses", Income: "/finance/income", Bill: "/finance/bills", Cheque: "/finance/cheques", Invoice: "/invoices" };

/** Jump-to search in the top bar: screens, and for finance roles the records themselves. Ctrl+K or "/" focuses it; arrows and Enter pick a result. */
export function QuickSearch({ items, records = false }: QuickSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<{ q: string; hits: FinSearchHit[] }>({ q: "", hits: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const listId = useId();

  const typed = query.trim();
  const text = typed.toLowerCase();
  const screens = items
    .filter((item) => item.path && (!text || item.label.toLowerCase().includes(text) || item.shortLabel.toLowerCase().includes(text)))
    .slice(0, 8);
  const lookUp = records && typed.length >= 2;
  const hits = lookUp && found.q === typed ? found.hits : [];
  const searching = lookUp && found.q !== typed;
  const results: Result[] = [...screens.map((item) => ({ kind: "screen" as const, item })), ...hits.map((hit) => ({ kind: "record" as const, hit }))];

  useEffect(() => {
    if (!lookUp) return;
    let cancelled = false;
    // Wait for a pause in typing, so one request is made for the word rather than one for each letter.
    const timer = window.setTimeout(() => {
      Promise.resolve(searchFinance(typed))
        .then((r) => !cancelled && setFound({ q: typed, hits: r?.hits ?? [] }))
        .catch(() => !cancelled && setFound({ q: typed, hits: [] }));   // the screen results still work
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lookUp, typed]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = (event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]");
      if ((event.key === "k" && (event.ctrlKey || event.metaKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(result: Result) {
    if (result.kind === "screen") {
      if (!result.item.path) return;
      navigate(result.item.path);
    } else {
      const to = `${WHERE[result.hit.type]}?q=${encodeURIComponent(result.hit.number)}`;
      // The invoice list reads its search only when it opens, so reopen it when it is already on screen.
      if (result.hit.type === "Invoice" && pathname === "/invoices") window.location.assign(to);
      else navigate(to);
    }
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      go(results[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const option = (result: Result, index: number) => {
    const Icon = result.kind === "screen" ? NAV_ICONS[result.item.key] : FileText;
    return (
      <li
        key={result.kind === "screen" ? result.item.key : `${result.hit.type}-${result.hit.id}`}
        role="option"
        aria-selected={index === active}
        // mousedown fires before the input's blur, so the click is not lost when the list closes.
        onMouseDown={(event) => {
          event.preventDefault();
          go(result);
        }}
        onMouseEnter={() => setActive(index)}
        className={cx("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm", index === active ? "bg-brand-50 text-brand-800" : "text-ink-800")}
      >
        {Icon && <Icon aria-hidden="true" size={16} className="shrink-0 text-ink-500" />}
        {result.kind === "screen" ? (
          <span className="flex-1 truncate">{result.item.label}</span>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="block truncate">{result.hit.name}</span>
            <span className="block truncate text-xs text-ink-500">{result.hit.type} {result.hit.number} · {formatDay(result.hit.date)}{result.hit.status === "Voided" || result.hit.status === "Cancelled" ? ` · ${result.hit.status}` : ""}</span>
          </span>
        )}
        {result.kind === "record" && <span className="shrink-0 tabular-nums">{formatMoney(result.hit.amount)}</span>}
        {index === active && <CornerDownLeft aria-hidden="true" size={14} className="shrink-0 text-ink-400" />}
      </li>
    );
  };

  return (
    <div className="relative hidden w-full max-w-sm md:block">
      <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search screens"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        placeholder={records ? "Search screens, entries, bills…" : "Search screens…"}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-lg border border-transparent bg-ink-100 pl-9 pr-14 text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-ink-300 bg-white px-1.5 text-[0.6875rem] font-medium text-ink-500">
        Ctrl K
      </kbd>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-12 z-30 max-h-[70dvh] overflow-y-auto rounded-card border border-line bg-white py-1 shadow-pop"
        >
          {results.length === 0 && <li className="px-4 py-3 text-sm text-ink-600">{searching ? "Searching…" : lookUp ? "Nothing matches." : "No matching screens."}</li>}
          {screens.map((item, i) => option({ kind: "screen", item }, i))}
          {hits.length > 0 && <li role="presentation" className="border-t border-line px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Records</li>}
          {hits.map((hit, i) => option({ kind: "record", hit }, screens.length + i))}
        </ul>
      )}
    </div>
  );
}
