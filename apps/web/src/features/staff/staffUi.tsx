import { StatusBadge, type StatusTone } from "../../ui";
import type { StaffDay, StaffStatus } from "../../api/staff";
import { ApiError } from "../../api/client";

const TONES: Record<StaffStatus, StatusTone> = {
  Present: "success",
  Late: "warning",
  "Early Leave": "warning",
  Absent: "danger",
  "Weekly Off": "neutral",
  "Public Holiday": "info",
  "Missing Sign-out": "danger",
  "On Leave": "info",
  "Not In Yet": "neutral",
};

export function StaffStatusBadge({ status }: { status: StaffStatus }) {
  return (
    <StatusBadge tone={TONES[status] ?? "neutral"} variant="soft">
      {status}
    </StatusBadge>
  );
}

/** The small warnings that sit beside a day's status. */
export function DayFlags({ day, onDark = false }: { day: StaffDay; onDark?: boolean }) {
  const flags = [
    day.isLate ? `${day.lateMinutes} min late` : null,
    day.isEarlyLeave ? `${day.earlyLeaveMinutes} min early` : null,
    day.outsideOffice ? "Outside office" : null,
  ].filter((flag): flag is string => flag !== null);
  if (flags.length === 0) return null;
  return <span className={onDark ? "text-xs font-medium text-amber-300" : "text-xs text-amber-800"}>{flags.join(" · ")}</span>;
}

export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon 16 Nov 2026" from a yyyy-MM-dd date, without time-zone surprises. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}

export function toIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today in the company's time zone (UAE), whatever the device's own zone is. */
export function todayInUae(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toIso(new Date(y, m - 1, d + days));
}

export function hoursText(hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return `${whole}h ${String(minutes).padStart(2, "0")}m`;
}

const MONEY = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 13,500.00: amounts with thousands separators so long figures read at a glance. */
export function formatMoney(value: number): string {
  return MONEY.format(value);
}
