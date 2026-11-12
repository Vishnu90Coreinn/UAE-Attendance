import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { cx } from "./cx";

export interface RowMenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** Red text: for actions that remove or cannot be undone. */
  danger?: boolean;
  disabled?: boolean;
  /** Why the item is disabled; shown as a tooltip. */
  disabledReason?: string;
}

interface RowMenuProps {
  /** Names the row for assistive technology, for example "Actions for Ahmed Khan". */
  label: string;
  items: RowMenuItem[];
  className?: string;
}

/**
 * A "..." button with a short list of row actions, so risky ones (delete) sit a deliberate click away from the everyday ones.
 * Closes on Escape, on an outside click and after a choice; arrows move between items.
 */
export function RowMenu({ label, items, className }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => {
    if (open) rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const enabled = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (at + 1) % enabled.length : (at - 1 + enabled.length) % enabled.length;
    enabled[next]?.focus();
  }

  return (
    <div ref={rootRef} className={cx("relative inline-block", className)} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-11 items-center justify-center rounded-lg text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 md:size-9"
      >
        <MoreHorizontal aria-hidden="true" size={18} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-30 mt-1 min-w-48 overflow-hidden rounded-card border border-line bg-white py-1 shadow-pop"
        >
          {items.map(({ label: itemLabel, icon: Icon, onSelect, danger, disabled, disabledReason }) => (
            <button
              key={itemLabel}
              type="button"
              role="menuitem"
              disabled={disabled}
              title={disabled ? disabledReason : undefined}
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
                onSelect();
              }}
              className={cx(
                "flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-9",
                danger ? "text-danger hover:bg-red-50" : "text-ink-800 hover:bg-ink-50",
              )}
            >
              {Icon && <Icon aria-hidden="true" size={16} />}
              {itemLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
