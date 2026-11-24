import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The phone pages' shared building blocks, so a button, a chip and a title look and size the same on every screen.
 *
 * Spacing: a page is a column of sections 20px apart (`PAGE_GAP`); inside a card, text lines sit 4–6px apart and the
 * actions 12px below them; list rows have 16px of padding. Targets are at least 44px (small), 48px (standard) or 56px
 * (the main action of a sheet).
 */
export const PAGE_GAP = "space-y-5";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

export type PhoneButtonVariant = "primary" | "secondary" | "danger" | "quiet";
export type PhoneButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<PhoneButtonVariant, string> = {
  primary: "bg-brand-700 text-white active:bg-brand-800",
  secondary: "border border-ink-300 bg-white text-ink-900 active:bg-ink-100",
  danger: "border border-red-200 bg-white text-red-700 active:bg-red-50",
  quiet: "text-brand-700 active:bg-brand-50",
};
/** sm is 44px (compact actions in a card), md 48px (the usual button), lg 56px (the main action of a sheet or bar). */
const SIZE: Record<PhoneButtonSize, string> = {
  sm: "min-h-11 rounded-xl px-4 text-sm",
  md: "min-h-12 rounded-xl px-5 text-base",
  lg: "min-h-14 rounded-2xl px-6 text-base",
};

/** The class list for a phone button; use it on a `<button>`, a link or a label. */
export function phoneButton(variant: PhoneButtonVariant = "primary", size: PhoneButtonSize = "md", extra = ""): string {
  return `inline-flex items-center justify-center gap-2 font-bold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${VARIANT[variant]} ${SIZE[size]} ${extra}`.trim();
}

export function PhoneButton({
  variant,
  size,
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: PhoneButtonVariant; size?: PhoneButtonSize }) {
  return <button type={type} className={phoneButton(variant, size, className)} {...rest} />;
}

/** A chip's classes: a 40px pill, filled when chosen. Also used on a `<select>` that sits in a chip row. */
export function chipClass(on: boolean, extra = ""): string {
  return `inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors duration-150 ${focusRing} ${
    on ? "border-brand-700 bg-brand-700 text-white" : "border-ink-300 bg-white text-ink-900 active:bg-ink-100"
  } ${extra}`.trim();
}

/** One filter chip; the count, when given, is a small badge that follows the chip's state. */
export function Chip({ on, count, onClick, children }: { on: boolean; count?: number; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={chipClass(on)}>
      {children}
      {count !== undefined && " "}
      {count !== undefined && (
        <span className={`min-w-5 rounded-full px-1.5 text-center text-xs font-bold tabular-nums ${on ? "bg-white/20 text-white" : "bg-ink-100 text-ink-700"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * A row of chips that scrolls sideways. While more chips are hidden off the right edge the row fades out there, so it is
 * obvious it scrolls; the fade goes once the last chip is in view.
 */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setMore(element.scrollWidth - element.scrollLeft - element.clientWidth > 4);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      onScroll={(event) => {
        const element = event.currentTarget;
        setMore(element.scrollWidth - element.scrollLeft - element.clientWidth > 4);
      }}
      className={`-mx-4 flex gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] ${more ? "[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)]" : ""}`}
    >
      {children}
    </div>
  );
}

/** The title block at the top of a phone page: the page name, an optional line under it, and actions at the right. */
export function PhoneTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-2xl font-bold leading-tight tracking-tight text-ink-900">{title}</h2>
        {subtitle && <div className="mt-1 text-sm text-ink-600">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * The floating main action of a list page, above the tab bar. It starts as a labelled button and shrinks to a plain round
 * one as soon as the page scrolls, so it stops covering the content that is being read.
 */
export function Fab({ label, icon: Icon, onClick, disabled }: { label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean }) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const update = () => setCompact(window.scrollY > 40);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={phoneButton("primary", "lg", `fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-20 rounded-full shadow-pop ${compact ? "size-14 min-h-0 px-0" : "pl-5 pr-6"}`)}
    >
      <Icon aria-hidden="true" size={22} strokeWidth={3} />
      <span className={compact ? "sr-only" : ""}>{label}</span>
    </button>
  );
}
