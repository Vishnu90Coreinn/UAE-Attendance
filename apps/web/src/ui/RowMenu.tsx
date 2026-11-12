import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, MoreHorizontal, type LucideIcon } from "lucide-react";
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
  /** Shows a labelled button (for example "Export") instead of the "..." icon. */
  triggerText?: string;
  triggerIcon?: LucideIcon;
  /** Disables the whole menu, for example while a request is running. */
  disabled?: boolean;
}

/**
 * A "..." button with a short list of row actions, so risky ones (delete) sit a deliberate click away from the everyday ones.
 * Closes on Escape, on an outside click and after a choice; arrows move between items.
 */
export function RowMenu({ label, items, className, triggerText, triggerIcon: TriggerIcon, disabled }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // The menu is drawn on the page, not inside the table, so a scrolling table cannot clip it.
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = menuRef.current?.offsetHeight ?? 0;
      const below = rect.bottom + 4;
      const top = below + menuHeight > window.innerHeight && rect.top - 4 - menuHeight > 0 ? rect.top - 4 - menuHeight : below;
      setPosition({ top, right: Math.max(8, window.innerWidth - rect.right) });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => {
    if (open && position) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    // Focus once, when the menu first has a position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, position === null]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const enabled = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (at + 1) % enabled.length : (at - 1 + enabled.length) % enabled.length;
    enabled[next]?.focus();
  }

  // Key events from the menu (drawn in a portal) still bubble to this wrapper through React, so it alone handles them.
  return (
    <div ref={rootRef} className={cx("relative inline-block", className)} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={triggerText ? undefined : label}
        title={triggerText ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={
          triggerText
            ? "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-ink-300 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60 md:min-h-10"
            : "inline-flex size-11 items-center justify-center rounded-lg text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50 md:size-9"
        }
      >
        {triggerText ? (
          <>
            {TriggerIcon && <TriggerIcon aria-hidden="true" size={16} />}
            {triggerText}
            <ChevronDown aria-hidden="true" size={14} />
          </>
        ) : (
          <MoreHorizontal aria-hidden="true" size={18} />
        )}
      </button>
      {open &&
        createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          style={{ position: "fixed", top: position?.top ?? 0, right: position?.right ?? 0, visibility: position ? "visible" : "hidden" }}
          className="z-50 min-w-48 overflow-hidden rounded-card border border-line bg-white py-1 shadow-pop"
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
        </div>,
        document.body,
        )}
    </div>
  );
}
