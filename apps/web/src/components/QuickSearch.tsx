import { useEffect, useId, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cx } from "../ui";
import { NAV_ICONS } from "./navIcons";
import type { NavItem } from "./navItems";

interface QuickSearchProps {
  /** Screens this person may open; the server still enforces access. */
  items: NavItem[];
}

/** Jump-to-screen search in the top bar. Ctrl+K or "/" focuses it; arrows and Enter pick a result. */
export function QuickSearch({ items }: QuickSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const listId = useId();

  const text = query.trim().toLowerCase();
  const results = items
    .filter((item) => item.path && (!text || item.label.toLowerCase().includes(text) || item.shortLabel.toLowerCase().includes(text)))
    .slice(0, 8);

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

  function go(item: NavItem) {
    if (!item.path) return;
    navigate(item.path);
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
        placeholder="Search screens…"
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
          aria-label="Screens"
          className="absolute left-0 right-0 top-12 z-30 overflow-hidden rounded-card border border-line bg-white py-1 shadow-pop"
        >
          {results.length === 0 && <li className="px-4 py-3 text-sm text-ink-600">No matching screens.</li>}
          {results.map((item, index) => {
            const Icon = NAV_ICONS[item.key];
            return (
              <li
                key={item.key}
                role="option"
                aria-selected={index === active}
                // mousedown fires before the input's blur, so the click is not lost when the list closes.
                onMouseDown={(event) => {
                  event.preventDefault();
                  go(item);
                }}
                onMouseEnter={() => setActive(index)}
                className={cx("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm", index === active ? "bg-brand-50 text-brand-800" : "text-ink-800")}
              >
                {Icon && <Icon aria-hidden="true" size={16} className="text-ink-500" />}
                <span className="flex-1 truncate">{item.label}</span>
                {index === active && <CornerDownLeft aria-hidden="true" size={14} className="text-ink-400" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
