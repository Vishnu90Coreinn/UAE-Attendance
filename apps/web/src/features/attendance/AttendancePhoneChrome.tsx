import type { ReactNode } from "react";
import { Calendar, Check, CalendarDays, Loader2, Save, Undo2, X } from "lucide-react";
import { phoneButton } from "../../components/phoneUi";
import type { AttendanceFilter } from "./attendanceFilter";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const fullDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const at = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * The top of the phone page: the title with the shift under it, a calendar button for any other date, and a strip of
 * the last seven days to jump between them with one tap. Today is marked, and nothing later than today is offered.
 */
export function PhoneHeader({
  date,
  today,
  subtitle,
  pending,
  onPick,
  menu,
}: {
  date: string;
  today: string;
  subtitle?: string;
  pending: boolean;
  onPick: (value: string) => void;
  /** The "more actions" menu at the right edge. */
  menu?: ReactNode;
}) {
  // The window ends today, or a little after an older chosen day so that day is always on the strip.
  const end = date < addDays(today, -6) ? (addDays(date, 3) > today ? today : addDays(date, 3)) : today;
  const days = Array.from({ length: 7 }, (_, index) => addDays(end, index - 6));
  return (
    <header className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold tracking-tight text-ink-900">Attendance</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-600">{subtitle}</p>}
        </div>
        <div className="relative size-11 shrink-0">
          <label htmlFor="work-date" className="sr-only">
            Work date
          </label>
          <input
            id="work-date"
            type="date"
            value={date}
            max={today}
            disabled={pending}
            onChange={(event) => onPick(event.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none grid size-11 place-items-center rounded-xl border border-line bg-white text-ink-800 shadow-card"
          >
            <Calendar size={20} />
          </span>
        </div>
        {menu}
      </div>
      <div role="group" aria-label="Choose a day" className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const selected = day === date;
          const isToday = day === today;
          return (
            <button
              key={day}
              type="button"
              disabled={pending}
              aria-pressed={selected}
              aria-current={isToday ? "date" : undefined}
              aria-label={`${fullDay.format(at(day))}${isToday ? ", today" : ""}`}
              onClick={() => onPick(day)}
              className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl border transition-colors duration-150 ${focusRing} disabled:opacity-60 ${
                selected
                  ? "border-brand-700 bg-brand-700 text-white"
                  : "border-line bg-white text-ink-900 active:bg-ink-100"
              }`}
            >
              <span aria-hidden="true" className={`text-xs font-medium ${selected ? "text-white/85" : "text-ink-600"}`}>
                {weekday.format(at(day))}
              </span>
              <span aria-hidden="true" className="text-lg font-bold leading-none tabular-nums">
                {at(day).getUTCDate()}
              </span>
              <span
                aria-hidden="true"
                className={`size-1 rounded-full ${isToday ? (selected ? "bg-white" : "bg-brand-600") : "bg-transparent"}`}
              />
            </button>
          );
        })}
      </div>
    </header>
  );
}

const TILES: {
  value: Exclude<AttendanceFilter, "all">;
  label: string;
  badge: string;
  icon: ReactNode;
}[] = [
  { value: "unrecorded", label: "Not marked", badge: "bg-ink-100 text-ink-700", icon: <span className="size-2.5 rounded-full border-2 border-ink-500" /> },
  { value: "present", label: "Present", badge: "bg-brand-100 text-brand-800", icon: <Check size={13} strokeWidth={3.5} /> },
  { value: "absent", label: "Absent", badge: "bg-red-100 text-red-800", icon: <X size={13} strokeWidth={3.5} /> },
  { value: "leave", label: "Leave", badge: "bg-amber-100 text-amber-900", icon: <CalendarDays size={13} strokeWidth={2.5} /> },
];

/**
 * The day at a glance: how many are marked and the four counts, each of which is also a filter for the list below it.
 * While people are still unmarked it offers to mark all of them in one go (the page shows an Undo afterwards).
 */
export function PhoneSummary({
  total,
  present,
  absent,
  leave,
  filter,
  onFilter,
  pay,
  markable,
  onMarkRest,
}: {
  total: number;
  present: number;
  absent: number;
  leave: number;
  filter: AttendanceFilter;
  onFilter: (value: AttendanceFilter) => void;
  /** A Manager's running pay total; undefined for roles that never see pay. */
  pay?: number | null;
  /** How many workers a bulk action would change; 0 hides the bulk row. */
  markable: number;
  onMarkRest: (status: "Present" | "Absent") => void;
}) {
  const recorded = present + absent + leave;
  const counts = { unrecorded: total - recorded, present, absent, leave };
  return (
    <section aria-label="Day summary" className="rounded-3xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-base font-bold text-ink-900">
          {recorded} of {total} marked
        </p>
        {pay != null && <p className="text-sm font-semibold tabular-nums text-ink-800">{pay.toFixed(2)} AED</p>}
      </div>
      <div aria-hidden="true" className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full origin-left rounded-full bg-brand-600 transition-transform duration-300 ease-out"
          style={{ transform: `scaleX(${total ? recorded / total : 0})` }}
        />
      </div>
      <div role="group" aria-label="Show workers" className="mt-4 grid grid-cols-4 gap-2">
        {TILES.map(({ value, label, badge, icon }) => {
          const on = filter === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              aria-label={`${label}: ${counts[value]}`}
              onClick={() => onFilter(on ? "all" : value)}
              className={`flex min-h-20 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border px-1 py-2 transition-colors duration-150 ${focusRing} ${
                on ? "border-brand-600 bg-brand-50" : "border-transparent bg-ink-50 active:bg-ink-100"
              }`}
            >
              <span aria-hidden="true" className={`grid size-6 place-items-center rounded-full ${badge}`}>
                {icon}
              </span>
              <span aria-hidden="true" className="text-xl font-bold leading-none tabular-nums text-ink-900">
                {counts[value]}
              </span>
              <span aria-hidden="true" className="w-full truncate text-center text-xs font-medium text-ink-700">
                {label}
              </span>
            </button>
          );
        })}
      </div>
      {markable > 0 && (
        <div className="mt-4 border-t border-ink-100 pt-4">
          <p className="text-sm text-ink-700">
            {markable === total ? "Mark everyone as" : `Mark the other ${markable} as`}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onMarkRest("Present")}
              aria-label={`Mark ${markable} present`}
              className={phoneButton("primary", "md", "gap-1.5")}
            >
              <Check aria-hidden="true" size={18} strokeWidth={3} />
              Present
            </button>
            <button
              type="button"
              onClick={() => onMarkRest("Absent")}
              aria-label={`Mark ${markable} absent`}
              className={phoneButton("danger", "md", "gap-1.5")}
            >
              <X aria-hidden="true" size={18} strokeWidth={3} />
              Absent
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * A floating card above the tab bar that is only there when it is needed: the unsaved count with Save, and a short
 * Undo after a bulk action. When nothing is pending there is no bar at all.
 */
export function PhoneSaveBar({
  unsaved,
  pending,
  undoLabel,
  onUndo,
  onSave,
}: {
  unsaved: number;
  pending: boolean;
  undoLabel: string | null;
  onUndo: () => void;
  onSave: () => void;
}) {
  if (unsaved === 0 && !pending && undoLabel === null) return null;
  return (
    <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 space-y-2">
      {undoLabel !== null && (
        <p role="status" className="flex items-center justify-between gap-3 rounded-2xl bg-ink-900 py-1 pl-4 pr-1 text-sm font-semibold text-white shadow-pop">
          <span>{undoLabel}</span>
          <button
            type="button"
            onClick={onUndo}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 font-bold text-amber-300 ${focusRing}`}
          >
            <Undo2 aria-hidden="true" size={16} />
            Undo
          </button>
        </p>
      )}
      {(unsaved > 0 || pending) && (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white p-2 pl-4 shadow-pop">
          <p role="status" className="min-w-0 flex-1 text-sm font-semibold text-ink-900">
            {unsaved} unsaved {unsaved === 1 ? "change" : "changes"}
          </p>
          <button
            type="button"
            onClick={onSave}
            disabled={pending}
            aria-busy={pending}
            className={phoneButton("primary", "md")}
          >
            {pending ? <Loader2 aria-hidden="true" size={18} className="animate-spin" /> : <Save aria-hidden="true" size={18} />}
            {pending ? "Saving..." : "Save day"}
          </button>
        </div>
      )}
    </div>
  );
}
