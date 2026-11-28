import { useState, type CSSProperties, type ReactNode } from "react";
import { domAnimation, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { cx } from "./cx";

/*
 * The motion kit for money and chart screens. See "Motion" in docs/design-system.md.
 *
 * Two rules hold everywhere. A figure is never animated through values it does not have (no count-ups), and nothing
 * waits more than a fraction of a second before it can be read. With "reduce motion" on, every piece renders at rest.
 *
 * `data-motion` and `data-mark` let the print stylesheet put everything at rest, whatever frame it was on.
 */

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Siblings arrive one after another, but the last never waits for long. */
const delayFor = (order: number, step: number, max: number) => Math.min(order * step, max);

interface PieceProps {
  as?: "div" | "span" | "li";
  className?: string;
  children?: ReactNode;
  /** Position among siblings, for a short stagger. */
  order?: number;
  style?: CSSProperties;
  id?: string;
  role?: string;
  title?: string;
  "aria-label"?: string;
  "aria-hidden"?: boolean;
}

/** Content taking the place of its loading skeleton: it rises a few pixels into place. */
export function Arrive({ as = "div", order = 0, children, ...rest }: PieceProps) {
  const reduce = useReducedMotion();
  const Element = m[as];
  return (
    <LazyMotion features={domAnimation}>
      <Element
        {...rest}
        data-motion="arrive"
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: EASE, delay: delayFor(order, 0.035, 0.14) }}
      >
        {children}
      </Element>
    </LazyMotion>
  );
}

/**
 * A bar, share strip or plot being drawn on the sheet: it is uncovered from its left edge. The shape underneath is
 * its true size from the start, so a column never shows a height it does not have.
 */
export function Draw({ as = "div", order = 0, children, ...rest }: PieceProps) {
  const reduce = useReducedMotion();
  const Element = m[as];
  return (
    <LazyMotion features={domAnimation}>
      <Element
        {...rest}
        data-motion="draw"
        initial={reduce ? false : { clipPath: "inset(0% 100% 0% 0%)" }}
        // Once drawn the clip is removed, so tooltips and focus rings may overflow again.
        animate={reduce ? undefined : { clipPath: "inset(0% 0% 0% 0%)", transitionEnd: { clipPath: "none" } }}
        transition={{ duration: 0.45, ease: EASE, delay: delayFor(order, 0.045, 0.3) }}
      >
        {children}
      </Element>
    </LazyMotion>
  );
}

interface MarkProps {
  /** The figure's value. A rule is drawn under it each time this changes, not on first show. */
  value: string | number;
  children: ReactNode;
  /** "dark" for figures on the deep teal panels. */
  tone?: "light" | "dark";
  className?: string;
}

/** Points out a figure that has just changed, after saving or voiding, so the eye finds what moved. */
export function Mark({ value, children, tone = "light", className }: MarkProps) {
  const reduce = useReducedMotion();
  const [seen, setSeen] = useState({ value, changes: 0 });
  if (!Object.is(seen.value, value)) setSeen({ value, changes: seen.changes + 1 });

  return (
    <span className={cx("relative inline-block", className)}>
      {children}
      {seen.changes > 0 && !reduce && (
        <LazyMotion features={domAnimation}>
          <m.span
            key={seen.changes}
            data-mark=""
            aria-hidden="true"
            className={cx("pointer-events-none absolute inset-x-0 -bottom-0.5 h-0.5 origin-left rounded-full", tone === "dark" ? "bg-pistachio" : "bg-brand-400")}
            initial={{ scaleX: 0, opacity: 1 }}
            animate={{ scaleX: 1, opacity: [1, 1, 0] }}
            transition={{ scaleX: { duration: 0.35, ease: EASE }, opacity: { duration: 2.4, times: [0, 0.7, 1] } }}
          />
        </LazyMotion>
      )}
    </span>
  );
}

/** Moving between money screens: a short fade. Opacity only, so fixed bars and menus inside are never displaced. */
export function PageEnter({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <LazyMotion features={domAnimation}>
      <m.div data-motion="page" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease: "easeOut" }}>
        {children}
      </m.div>
    </LazyMotion>
  );
}
