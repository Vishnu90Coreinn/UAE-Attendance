import { useEffect, useState } from "react";
import type { StaffDay, StaffStatus } from "../../api/staff";
import { cx } from "../../ui";
import { longDate } from "./staffUi";

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
