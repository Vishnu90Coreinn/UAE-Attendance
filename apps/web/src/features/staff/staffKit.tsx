import { useEffect, useState } from "react";
import type { StaffDay, StaffStatus } from "../../api/staff";
import { cx } from "../../ui";
import { longDate } from "./staffUi";
import { Check } from "lucide-react";

/** Initials in a quiet teal disc. The tint comes from the name so a list of people is easy to scan. */
const AVATAR_TINTS = [
  "bg-brand-100 text-brand-800",
  "bg-ink-200 text-ink-800",
  "bg-sky-100 text-sky-900",
  "bg-amber-100 text-amber-900",
  "bg-green-100 text-green-900",
];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const tint = AVATAR_TINTS[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % AVATAR_TINTS.length];
  const dimension = size === "sm" ? "size-8 text-xs" : size === "lg" ? "size-14 text-lg" : "size-10 text-sm";
  return (
    <span aria-hidden="true" className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", dimension, tint)}>
      {initials}
    </span>
  );
}

/** Time in the company's zone (UAE), ticking every second. */
export function useUaeNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function uaeClock(now: Date): { time: string; seconds: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { time: `${get("hour")}:${get("minute")}`, seconds: get("second"), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function greeting(minutes: number): string {
  return minutes < 12 * 60 ? "Good morning" : minutes < 17 * 60 ? "Good afternoon" : "Good evening";
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** The working day as a bar: how much of the shift has passed, with the start and end labelled. */
export function ShiftBar({ start, end, nowMinutes }: { start: string; end: string; nowMinutes: number }) {
  const from = toMinutes(start);
  const to = toMinutes(end);
  const done = Math.min(100, Math.max(0, ((nowMinutes - from) / (to - from)) * 100));
  const label = nowMinutes < from ? "Shift has not started" : nowMinutes >= to ? "Shift is over" : `${Math.round(done)}% of the shift`;
  return (
    <div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(done)}
        aria-label={label}
        className="relative h-2 overflow-hidden rounded-full bg-white/15"
      >
        <div className="h-full rounded-full bg-brand-300 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${done}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-brand-100">
        <span className="tabular-nums">{start}</span>
        <span>{label}</span>
        <span className="tabular-nums">{end}</span>
      </div>
    </div>
  );
}

interface StripStyle {
  letter: string;
  cls: string;
  name: string;
}

const STRIP: Record<StaffStatus, StripStyle> = {
  Present: { letter: "P", cls: "bg-green-600 text-white", name: "Present" },
  Late: { letter: "L", cls: "bg-amber-500 text-ink-900", name: "Late" },
  "Early Leave": { letter: "E", cls: "bg-amber-500 text-ink-900", name: "Early leave" },
  Absent: { letter: "A", cls: "bg-red-700 text-white", name: "Absent" },
  "Weekly Off": { letter: "-", cls: "bg-ink-200 text-ink-600", name: "Weekly off" },
  "Public Holiday": { letter: "H", cls: "bg-sky-200 text-sky-900", name: "Public holiday" },
  "Missing Sign-out": { letter: "!", cls: "bg-red-700 text-white", name: "Missing sign-out" },
  "On Leave": { letter: "V", cls: "bg-sky-600 text-white", name: "On leave" },
  "Not In Yet": { letter: "·", cls: "bg-ink-100 text-ink-500", name: "Not in yet" },
};

/** One square per day, oldest to newest. Every square carries a letter and a label, so colour is never the only signal. */
export function DayStrip({ days }: { days: StaffDay[] }) {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const used = [...new Set(ordered.map((d) => d.status))];
  return (
    <div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1.5" aria-label="Daily attendance, oldest first">
        {ordered.map((d) => {
          const style = STRIP[d.status] ?? STRIP.Present;
          const detail = `${longDate(d.date)}: ${style.name}${d.firstIn ? `, in ${d.firstIn}` : ""}${d.lastOut ? `, out ${d.lastOut}` : ""}`;
          return (
            <li
              key={d.date}
              title={detail}
              aria-label={detail}
              className={cx("flex aspect-square items-center justify-center rounded-md text-xs font-semibold", style.cls)}
            >
              {style.letter}
            </li>
          );
        })}
      </ul>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
        {used.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cx("inline-flex size-4 items-center justify-center rounded text-[10px] font-semibold", STRIP[status].cls)}>
              {STRIP[status].letter}
            </span>
            {STRIP[status].name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Used (solid), waiting for approval (striped) and left (empty) as one bar. */
export function BalanceBar({ used, pending, total }: { used: number; pending: number; total: number }) {
  const safe = Math.max(total, 1);
  const usedPct = Math.min(100, (used / safe) * 100);
  const pendingPct = Math.min(100 - usedPct, (pending / safe) * 100);
  return (
    <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-ink-100">
      <div className="bg-brand-600" style={{ width: `${usedPct}%` }} />
      <div
        className="bg-amber-400"
        style={{ width: `${pendingPct}%`, backgroundImage: "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.5) 0 3px, transparent 3px 6px)" }}
      />
    </div>
  );
}

export interface Segment {
  label: string;
  value: number;
  cls: string;
}

/** The roll call: one bar split by status, with counts underneath. */
export function SegmentBar({ segments, total }: { segments: Segment[]; total: number }) {
  const sum = Math.max(total, 1);
  return (
    <div>
      <div role="img" aria-label={segments.map((s) => `${s.value} ${s.label}`).join(", ")} className="flex h-3 overflow-hidden rounded-full bg-ink-100">
        {segments.filter((s) => s.value > 0).map((s) => (
          <div key={s.label} className={cx("transition-[width] duration-500 motion-reduce:transition-none", s.cls)} style={{ width: `${(s.value / sum) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className={cx("size-2.5 shrink-0 rounded-full", s.cls)} />
            <span className="text-ink-600">{s.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-ink-900">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A small green dot that pulses (unless motion is reduced) for "in the office right now". */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cx("relative inline-flex size-2.5", className)}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2.5 rounded-full bg-green-500" />
    </span>
  );
}

/** Buttons that act like one choice (a radio group): clearer than a dropdown for three or four options. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-ink-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "min-h-9 rounded-md px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
            value === o.value ? "bg-white text-brand-800 shadow-card" : "text-ink-600 hover:text-ink-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A percentage as a thin bar with the number beside it. Colour tracks the value but the number is always there. */
export function RateBar({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-ink-500">-</span>;
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const tone = pct >= 95 ? "bg-green-600" : pct >= 85 ? "bg-amber-500" : "bg-red-700";
  return (
    <div className="flex items-center justify-end gap-2" title={label}>
      <div aria-hidden="true" className="h-1.5 w-14 overflow-hidden rounded-full bg-ink-100">
        <div className={cx("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right tabular-nums text-ink-800">{pct}%</span>
    </div>
  );
}

/** Where a request is in its journey. Finished steps get a tick, the current one is outlined. */
export function Stepper({ steps, current, note }: { steps: readonly string[]; current: number; note?: string }) {
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Progress">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={cx(
                "inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold",
                done ? "bg-brand-600 text-white" : active ? "border-2 border-brand-600 text-brand-700" : "border border-ink-300 text-ink-500",
              )}
            >
              {done ? <Check aria-hidden="true" size={12} /> : index + 1}
            </span>
            <span className={cx(done || active ? "font-medium text-ink-800" : "text-ink-500")}>{step}</span>
            {index < steps.length - 1 && <span aria-hidden="true" className={cx("h-px w-5", done ? "bg-brand-600" : "bg-ink-300")} />}
          </li>
        );
      })}
      {note && <span className="sr-only">{note}</span>}
    </ol>
  );
}
