import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronRight, RefreshCw, type LucideIcon } from "lucide-react";
import type { AttendanceSummary } from "../../api/attendance";
import type { LeaveRequest } from "../../api/leave";
import type { InvoiceSummary } from "../../api/invoices";
import type { PayrollReport } from "../../api/payroll";
import type { StaffDashboard, StaffLeave } from "../../api/staff";
import type { Load, TrendDay } from "./useDashboardData";

/**
 * The dashboard is drawn like a fabrication sheet for the glass and aluminium work this company does: one ruled sheet,
 * a title block of figures, dimension-line bars, and a row of glass panes for the week. Colour carries status and is
 * always also written out as a count.
 */
export const STATUS = {
  present: "#1f8a4c",
  late: "#d99a1e",
  leave: "#6d5bd0",
  absent: "#c93c37",
  open: "#9fb0b4",
  office: "#1d7fa8",
} as const;

export const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
/** "2026-11-21" as "Sat 21 Nov", the way people say a date. */
const shortDay = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`)).replace(",", "");
const dayRange = (a: string, b: string) => (a === b ? shortDay(a) : `${shortDay(a)} \u2013 ${shortDay(b)}`);
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const focusClass = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

export interface QuickAction {
  to: string;
  label: string;
  icon: LucideIcon;
}

function Skeleton({ height }: { height: number }) {
  return <div role="status" aria-label="Loading" style={{ height }} className="rounded bg-ink-100 motion-safe:animate-pulse" />;
}

function Failed() {
  return <p className="rounded bg-red-50 p-3 text-sm text-red-800">Could not load this section. Reload the page to try again.</p>;
}

/** A titled region of the sheet: hairline-ruled, no card chrome. */
export function Region({
  title,
  note,
  action,
  className = "",
  children,
}: {
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`flex min-w-0 flex-col p-3 sm:p-4 ${className}`}>
      <header className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className="whitespace-nowrap text-sm font-semibold uppercase tracking-wide text-ink-800">{title}</h2>
        {note ? <p className="min-w-0 truncate text-xs text-ink-600">{note}</p> : null}
        {action}
      </header>
      {children}
    </section>
  );
}

/** A measurement bar in the manner of a dimension line: end ticks, with the measured part drawn over the span. */
function Dimension({ value, color }: { value: number; color: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div aria-hidden="true" className="relative mt-2 h-3">
      <span className="absolute left-0 top-0 h-3 w-px bg-ink-400" />
      <span className="absolute right-0 top-0 h-3 w-px bg-ink-400" />
      <span className="absolute inset-x-0 top-1/2 h-px bg-ink-300" />
      <span className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-r-sm" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/**
 * The one figure the sheet leads with: how many people are on the job today, site and office together, set at twice
 * the scale of anything else so the eye lands here first.
 */
export function LeadFigure({
  trend,
  staff,
}: {
  trend: Load<TrendDay[]>;
  staff: Load<StaffDashboard>;
}) {
  const days = trend.status === "ready" ? trend.value : null;
  const site = days ? days[days.length - 1] : null;
  const officeAll = staff.status === "ready" ? staff.value : null;
  /** On a weekly off or holiday with nobody in, the office is not part of today's head-count. */
  const office = officeAll && !(officeAll.dayType && officeAll.signedIn === 0) ? officeAll : null;
  const failed = trend.status === "error";
  const loading = trend.status === "loading" || staff.status === "loading";
  const present = (site?.present ?? 0) + (office?.signedIn ?? 0);
  const total = (site?.total ?? 0) + (office?.total ?? 0);
  const rate = total > 0 ? Math.round((present / total) * 100) : 0;
  return (
    <Link to="/attendance" className={`group relative block min-w-0 bg-white px-4 py-3 transition-colors hover:bg-brand-50 sm:px-5 ${focusClass}`}>
      <p className="flex items-center justify-between gap-2 text-sm font-semibold text-ink-800">
        On the job today
        <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
      </p>
      {loading && <div className="mt-3"><Skeleton height={96} /></div>}
      {failed && <p className="mt-3 text-sm text-red-800">Could not load.</p>}
      {!loading && !failed && (
        <>
          <p className="mt-0.5 flex items-baseline gap-2 tabular-nums">
            <span className="text-5xl font-semibold leading-none tracking-tight text-ink-900 sm:text-6xl">{present}</span>
            <span className="text-2xl font-medium text-ink-500">/ {total}</span>
            <span className="ml-auto self-end text-sm font-semibold text-brand-700">{rate}%</span>
          </p>
          <Dimension value={rate} color={STATUS.present} />
          <p className="mt-1.5 text-sm text-ink-700">
            <span className="font-medium text-ink-900">{site?.present ?? 0}</span> of {site?.total ?? 0} site workers
            {office ? (
              <>
                {" · "}
                <span className="font-medium text-ink-900">{office.signedIn}</span> of {office.total} office staff
              </>
            ) : officeAll?.dayType ? (
              <> · office closed ({officeAll.dayType.toLowerCase()})</>
            ) : null}
          </p>
        </>
      )}
    </Link>
  );
}

/** What waits on the manager. It inverts to the brand colour when there is something to do, and goes quiet when there is not. */
export function DecisionFigure({ count, detail, to, loading }: { count: number; detail: string; to: string; loading: boolean }) {
  const active = !loading && count > 0;
  return (
    <Link
      to={to}
      className={`group relative flex min-w-0 flex-col justify-between px-4 py-3 transition-colors sm:px-5 ${focusClass} ${
        active ? "bg-brand-700 text-white hover:bg-brand-800" : "bg-white text-ink-900 hover:bg-brand-50"
      }`}
    >
      <p className={`flex items-center justify-between gap-2 text-sm font-semibold ${active ? "text-brand-50" : "text-ink-800"}`}>
        Awaiting your decision
        <ChevronRight aria-hidden="true" size={16} className={`shrink-0 transition-transform group-hover:translate-x-0.5 ${active ? "text-brand-200" : "text-ink-400"}`} />
      </p>
      {loading ? (
        <div className="mt-3"><Skeleton height={64} /></div>
      ) : (
        <div>
          <p className="mt-1 text-4xl font-semibold leading-none tabular-nums">{count}</p>
          <p className={`mt-1.5 text-sm ${active ? "text-brand-100" : "text-ink-600"}`}>{detail}</p>
        </div>
      )}
    </Link>
  );
}

/** Receivables at a glance: what is owed, and how much of it is late. Drawn as a quiet third-tier cell. */
export function ReceivablesFigure({ state }: { state: Load<InvoiceSummary[]> }) {
  const t = state.status === "ready" ? invoiceTotals(state.value) : null;
  return (
    <Link to="/invoices" className={`group relative flex min-w-0 flex-col justify-between bg-white px-4 py-3 transition-colors hover:bg-brand-50 sm:px-5 ${focusClass}`}>
      <p className="flex items-center justify-between gap-2 text-sm font-semibold text-ink-800">
        Invoices outstanding (AED)
        <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
      </p>
      {state.status === "loading" && <div className="mt-3"><Skeleton height={64} /></div>}
      {state.status === "error" && <p className="mt-3 text-sm text-red-800">Could not load.</p>}
      {t && (
        <div>
          <p className="mt-1 truncate text-3xl font-semibold leading-none tabular-nums text-ink-900">{money.format(t.outstanding)}</p>
          <p className={`mt-1.5 text-sm ${t.overdueCount > 0 ? "font-medium text-red-800" : "text-ink-600"}`}>
            {t.overdueCount > 0 ? `${t.overdueCount} overdue · AED ${money.format(t.overdue)}` : t.openCount > 0 ? `${t.openCount} open, none overdue` : "No unpaid invoices"}
          </p>
        </div>
      )}
    </Link>
  );
}

const dubaiToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** Totals over the invoice list: billed this month, still owed, and the late part of what is owed. */
export function invoiceTotals(invoices: InvoiceSummary[]) {
  const today = dubaiToday();
  const month = today.slice(0, 7);
  const open = invoices.filter((i) => i.displayStatus === "Issued" || i.displayStatus === "PartPaid");
  const late = open.filter((i) => i.isOverdue);
  const billed = invoices.filter((i) => i.status === "Issued" && i.invoiceDate.startsWith(month));
  const sum = (list: InvoiceSummary[], pick: (i: InvoiceSummary) => number) => list.reduce((a, i) => a + pick(i), 0);
  return {
    outstanding: sum(open, (i) => i.balanceDue),
    openCount: open.length,
    overdue: sum(late, (i) => i.balanceDue),
    overdueCount: late.length,
    billedThisMonth: sum(billed, (i) => i.total),
    billedCount: billed.length,
    collectedOfBilled: sum(billed, (i) => i.amountPaid),
    unpaid: [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3),
    today,
  };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Tax invoices: billed this month, what is owed, and the next invoices to chase, soonest due first. */
export function Invoices({ state }: { state: Load<InvoiceSummary[]> }) {
  const t = state.status === "ready" ? invoiceTotals(state.value) : null;
  return (
    <Region
      title="Tax invoices"
      note={t ? `${t.billedCount} issued this month` : undefined}
      action={
        <Link to="/invoices" className={`ml-auto rounded px-1.5 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 ${focusClass}`}>
          All invoices
        </Link>
      }
    >
      {state.status === "loading" && <Skeleton height={160} />}
      {state.status === "error" && <Failed />}
      {t && state.status === "ready" && state.value.length === 0 && <p className="text-sm text-ink-600">No invoices yet.</p>}
      {t && state.status === "ready" && state.value.length > 0 && (
        <>
          <dl className="grid grid-cols-3 gap-x-4">
            <div>
              <dt className="text-xs text-ink-600">Billed this month</dt>
              <dd className="text-base font-medium tabular-nums text-ink-900">{money.format(t.billedThisMonth)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-600">Outstanding</dt>
              <dd className="text-base font-medium tabular-nums text-ink-900">{money.format(t.outstanding)}</dd>
            </div>
            <div>
              <dt className={`text-xs ${t.overdueCount > 0 ? "font-semibold text-red-800" : "text-ink-600"}`}>Overdue</dt>
              <dd className={`text-base font-medium tabular-nums ${t.overdueCount > 0 ? "text-red-800" : "text-ink-900"}`}>{money.format(t.overdue)}</dd>
            </div>
          </dl>
          {t.unpaid.length === 0 ? (
            <p className="mt-4 text-sm text-ink-600">Every issued invoice is paid.</p>
          ) : (
            <ol className="mt-3 divide-y divide-ink-200 border-t border-ink-200 text-sm">
              {t.unpaid.map((inv) => {
                const late = daysBetween(inv.dueDate, t.today);
                return (
                  <li key={inv.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate text-ink-900">
                        <span className="font-medium">{inv.number ?? "Draft"}</span> · {inv.clientName}
                      </span>
                      <span className={`block text-xs ${late > 0 ? "font-medium text-red-800" : "text-ink-600"}`}>
                        {late > 0 ? `${late} ${late === 1 ? "day" : "days"} overdue` : late === 0 ? "Due today" : `Due in ${-late} ${late === -1 ? "day" : "days"}`}
                      </span>
                    </span>
                    <span className="tabular-nums text-ink-900">{money.format(inv.balanceDue)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </Region>
  );
}

/** The head of the sheet: who is looking, what day it is, and the one sentence worth knowing. */
export function SheetHeader({
  title,
  date,
  summary,
  actions,
  updatedAt,
  refreshing = false,
  onRefresh,
}: {
  title: string;
  date: string;
  summary: ReactNode;
  actions: QuickAction[];
  updatedAt?: Date | null;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-ink-600">
          {date}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label={updatedAt ? `Refresh figures. Last updated at ${clock.format(updatedAt)}` : "Refresh figures"}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-ink-600 transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:cursor-wait ${focusClass}`}
            >
              <RefreshCw aria-hidden="true" size={13} className={refreshing ? "motion-safe:animate-spin" : ""} />
              {refreshing ? "Updating\u2026" : updatedAt ? `Updated ${clock.format(updatedAt)}` : "Refresh"}
            </button>
          )}
        </p>
        <h1 className="text-balance text-xl font-semibold text-ink-900 sm:text-2xl">{title}</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-ink-700">{summary}</p>
      </div>
      {actions.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {actions.map(({ to, label, icon: Icon }, index) => (
            <li key={label}>
              <Link
                to={to}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded px-3 text-sm font-semibold transition-colors ${focusClass} ${
                  index === 0
                    ? "bg-brand-600 text-white hover:bg-brand-700"
                    : "border border-ink-300 bg-white text-ink-800 hover:border-brand-500 hover:text-brand-700"
                }`}
              >
                <Icon aria-hidden="true" size={16} className="shrink-0" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />;
}

/**
 * The week as a plain bar chart: one bar per day for people present, on a scale from 0 to the head-count. Anything out
 * of the ordinary that day (absent, on leave) is written under the bar, so nothing depends on reading colours.
 */
function Panes({ days }: { days: TrendDay[] }) {
  const max = Math.max(...days.map((d) => d.total), 1);
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
      <div aria-hidden="true" className="relative h-24 text-right text-xs tabular-nums text-ink-500">
        <span className="absolute right-0 top-0 -translate-y-1/2">{max}</span>
        <span className="absolute right-0 top-1/2 -translate-y-1/2">{Math.round(max / 2)}</span>
        <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
      </div>
      <div className="relative">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-24">
          <span className="absolute inset-x-0 top-0 border-t border-dashed border-ink-200" />
          <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-ink-200" />
          <span className="absolute inset-x-0 bottom-0 border-t border-ink-300" />
        </div>
        <ol className="relative grid grid-cols-7 gap-1.5 sm:gap-2">
          {days.map((day, index) => {
            const today = index === days.length - 1;
            const rate = day.total > 0 ? Math.round((day.present / day.total) * 100) : 0;
            const rows = [
              ["Present", day.present, STATUS.present],
              ["On leave", day.onLeave, STATUS.leave],
              ["Absent", day.absent, STATUS.absent],
              ["Not recorded", day.notRecorded, STATUS.open],
            ] as const;
            const tip = index < 2 ? "left-0" : index > days.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2";
            return (
              <li key={day.date} className="group relative min-w-0">
                <button
                  type="button"
                  aria-label={`${day.label} ${day.date}: ${day.present} present, ${day.absent} absent, ${day.onLeave} on leave, ${day.notRecorded} not recorded`}
                  className={`block w-full rounded-[3px] text-center ${today ? "bg-brand-50" : "hover:bg-ink-50"} ${focusClass}`}
                >
                  <span className="flex h-24 items-end justify-center px-1.5">
                    <span
                      className="block w-full max-w-10 rounded-t-[3px]"
                      style={{ height: `${(day.present / max) * 100}%`, background: STATUS.present, opacity: today ? 1 : 0.8 }}
                    />
                  </span>
                  <span className={`mt-1 block text-xs ${today ? "font-semibold text-ink-900" : "text-ink-600"}`}>{today ? "Today" : day.label}</span>
                  <span className="block text-sm font-semibold tabular-nums text-ink-900">{day.present}</span>
                  <span className="flex min-h-9 flex-col items-center justify-start pb-1 text-xs leading-tight">
                    {day.absent > 0 && <span className="font-medium text-red-800">{day.absent} absent</span>}
                    {day.onLeave > 0 && <span className="font-medium text-violet-800">{day.onLeave} leave</span>}
                  </span>
                </button>
                <div
                  role="tooltip"
                  className={`pointer-events-none absolute bottom-full z-20 mb-1 hidden w-48 rounded border border-ink-300 bg-white p-3 text-left text-xs shadow-pop group-focus-within:block group-hover:block ${tip}`}
                >
                  <p className="font-semibold text-ink-900">{shortDay(day.date)}</p>
                  <p className="mb-2 text-ink-600">
                    {day.total} workers · {rate}% present
                  </p>
                  <ul className="space-y-1">
                    {rows.map(([label, value, color]) => (
                      <li key={label} className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-2 text-ink-700">
                          <Swatch color={color} />
                          {label}
                        </span>
                        <span className="font-semibold tabular-nums text-ink-900">{value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

export function WeekPanes({ state, canRecord }: { state: Load<TrendDay[]>; canRecord: boolean }) {
  const days = state.status === "ready" ? state.value : null;
  const empty = days ? days.every((day) => day.present + day.absent + day.onLeave === 0) : false;
  if (empty) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <p className="text-sm font-medium text-ink-700">No attendance recorded in the last 7 days.</p>
        {canRecord && (
          <Link
            to="/attendance"
            className={`inline-flex min-h-11 items-center gap-1.5 rounded bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 ${focusClass}`}
          >
            Record attendance
            <ChevronRight aria-hidden="true" size={16} />
          </Link>
        )}
      </div>
    );
  }
  return (
    <Region
      title="Attendance, last 7 days"
      note="People present each day"
    >
      {state.status === "loading" && <Skeleton height={110} />}
      {state.status === "error" && <Failed />}
      {days && <Panes days={days} />}
    </Region>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded-[3px] border border-ink-300 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink-700">{children}</span>;
}

/** What is waiting on a decision. Empty, it asks for one slim line instead of a box. */
export function Waiting({
  waiting,
  leave,
  staffLeave,
}: {
  waiting: Load<AttendanceSummary>;
  leave: Load<LeaveRequest[]>;
  staffLeave?: Load<StaffLeave[]>;
}) {
  const staff = staffLeave ?? ({ status: "ready", value: [] } as Load<StaffLeave[]>);
  const failed = waiting.status === "error" || leave.status === "error";
  const loading = waiting.status === "loading" || leave.status === "loading" || staff.status === "loading";
  const days = waiting.status === "ready" ? waiting.value.submitted : [];
  const requests = leave.status === "ready" ? leave.value : [];
  const staffRequests = staff.status === "ready" ? staff.value : [];
  const total = days.length + requests.length + staffRequests.length;
  const today = dubaiToday();
  const age = (iso: string) => {
    const n = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);
    return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
  };
  const span = (a: string, b: string, n: number) => `${dayRange(a, b)} (${n} ${n === 1 ? "day" : "days"})`;
  const rows = [
    ...days.slice(0, 4).map((day) => ({ key: `d-${day.date}`, to: "/attendance", tag: "Attendance", title: shortDay(day.date), detail: `${day.count} ${day.count === 1 ? "entry" : "entries"} to approve · ${age(day.date)}`, cta: "Approve" })),
    ...requests.slice(0, 4).map((r) => ({ key: `l-${r.id}`, to: "/leave", tag: "Site leave", title: r.workerName, detail: `${r.leaveType} · ${span(r.startDate, r.endDate, r.days)}`, cta: "Decide" })),
    ...staffRequests.slice(0, 4).map((r) => ({ key: `s-${r.id}`, to: "/staff-leave", tag: "Office leave", title: r.name, detail: `${r.leaveType} · ${span(r.startDate, r.endDate, r.days)}`, cta: "Decide" })),
  ];
  if (!loading && !failed && total === 0) {
    return (
      <section className="flex items-center gap-2.5 px-4 py-3 text-sm sm:px-5">
        <CheckCircle2 aria-hidden="true" size={18} className="shrink-0 text-green-700" />
        <h2 className="font-semibold text-ink-900">Needs your attention</h2>
        <p className="text-ink-600">Nothing is waiting for approval.</p>
      </section>
    );
  }
  return (
    <Region title="Needs your attention" note={loading ? undefined : `${total} waiting`}>
      {loading && <Skeleton height={160} />}
      {failed && <Failed />}
      {!loading && !failed && (
        <ul className="-mx-2 divide-y divide-ink-200">
          {rows.map((row) => (
            <li key={row.key}>
              <Link to={row.to} className={`flex min-h-11 items-center gap-3 rounded px-2 py-1.5 hover:bg-brand-50 ${focusClass}`}>
                <Tag>{row.tag}</Tag>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">{row.title}</span>
                  <span className="line-clamp-2 text-xs text-ink-600">{row.detail}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-brand-700">
                  {row.cta}
                  <ChevronRight aria-hidden="true" size={14} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Region>
  );
}

/** A day's composition as one dimension line split by status, with every count written beneath it. */
function Ruler({ total, parts, aria }: { total: number; parts: { label: string; value: number; color: string }[]; aria: string }) {
  return (
    <>
      <div role="img" aria-label={aria} className="relative mt-1 h-3">
        <span className="absolute left-0 top-0 h-3 w-px bg-ink-400" />
        <span className="absolute right-0 top-0 h-3 w-px bg-ink-400" />
        <span className="absolute inset-x-0 top-1/2 h-px bg-ink-300" />
        <span className="absolute inset-x-px top-1/2 flex h-1.5 -translate-y-1/2 overflow-hidden rounded-sm">
          {parts.filter((p) => p.value > 0).map((p) => (
            <span key={p.label} style={{ width: `${(p.value / Math.max(total, 1)) * 100}%`, background: p.color }} />
          ))}
        </span>
      </div>
      <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
        {parts.map((p) => (
          <div key={p.label} className="flex items-baseline gap-1.5">
            <dt className={`inline-flex items-center gap-1.5 text-xs ${p.value === 0 ? "text-ink-500" : "text-ink-700"}`}>
              <span className={p.value === 0 ? "opacity-40" : ""}><Swatch color={p.color} /></span>
              {p.label}
            </dt>
            <dd className={`text-sm tabular-nums ${p.value === 0 ? "font-normal text-ink-500" : "font-semibold text-ink-900"}`}>{whole.format(p.value)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function SiteToday({ state }: { state: Load<TrendDay[]> }) {
  const today = state.status === "ready" ? state.value[state.value.length - 1] : null;
  const parts = today
    ? [
        { label: "Present", value: today.present, color: STATUS.present },
        { label: "On leave", value: today.onLeave, color: STATUS.leave },
        { label: "Absent", value: today.absent, color: STATUS.absent },
        { label: "Not recorded", value: today.notRecorded, color: STATUS.open },
      ]
    : [];
  return (
    <Region title="Site workers today" note={today ? `${today.total} active` : undefined}>
      {state.status === "loading" && <Skeleton height={110} />}
      {state.status === "error" && <Failed />}
      {today && today.total === 0 && <p className="text-sm text-ink-600">No active site workers.</p>}
      {today && today.total > 0 && (
        <Ruler total={today.total} parts={parts} aria={`Site workers today: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`} />
      )}
    </Region>
  );
}

export function OfficeToday({ state }: { state: Load<StaffDashboard> }) {
  const d = state.status === "ready" ? state.value : null;
  const parts = d
    ? [
        { label: "Signed in", value: d.signedIn, color: STATUS.present },
        { label: "Late", value: d.late, color: STATUS.late },
        { label: "On leave", value: d.onLeave, color: STATUS.leave },
        { label: "Absent", value: d.absent, color: STATUS.absent },
        { label: "Not in yet", value: d.notInYet, color: STATUS.open },
      ]
    : [];
  return (
    <Region
      title="Office today"
      note={
        d?.dayType ? (
          <span className="rounded-[3px] bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">{d.dayType}</span>
        ) : d ? (
          `${d.total} employees`
        ) : undefined
      }
      action={
        <Link to="/staff" className={`ml-auto rounded px-1.5 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 ${focusClass}`}>
          Open
        </Link>
      }
    >
      {state.status === "loading" && <Skeleton height={110} />}
      {state.status === "error" && <Failed />}
      {d && d.total === 0 && <p className="text-sm text-ink-600">No office employees yet.</p>}
      {d && d.total > 0 && (
        <>
          {d.dayType && d.signedIn === 0 && <p className="mb-3 text-sm text-ink-700">No sign-ins expected today.</p>}
          <Ruler total={d.total} parts={parts} aria={`Office today: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`} />
          {d.outsideOffice + d.missingSignOut > 0 && (
            <p className="mt-3 text-xs font-medium text-amber-900">
              {d.outsideOffice > 0 && `${d.outsideOffice} signed in away from the office. `}
              {d.missingSignOut > 0 && `${d.missingSignOut} missing a sign-out.`}
            </p>
          )}
        </>
      )}
    </Region>
  );
}

/** The month's site payroll read left to right as the sum it is, then who earns most. */
export function Payroll({ state }: { state: Load<PayrollReport> }) {
  const report = state.status === "ready" ? state.value : null;
  const earners = report ? [...report.lines].filter((l) => l.netPay > 0).sort((a, b) => b.netPay - a.netPay).slice(0, 3) : [];
  const top = earners[0]?.netPay ?? 1;
  const terms = report
    ? [
        { label: "Basic pay", value: report.totals.basicPay, sign: "" },
        { label: "Overtime", value: report.totals.overtimePay, sign: "+" },
        { label: "Deductions", value: report.totals.totalDeductions, sign: "−" },
      ]
    : [];
  return (
    <Region
      title="Payroll"
      note={report ? `${report.period} · ${report.status}` : undefined}
      action={
        <Link to="/payroll" className={`ml-auto rounded px-1.5 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 ${focusClass}`}>
          Report
        </Link>
      }
    >
      {state.status === "loading" && <Skeleton height={160} />}
      {state.status === "error" && <Failed />}
      {report && report.lines.length === 0 && <p className="text-sm text-ink-600">No payroll lines for this month yet.</p>}
      {report && report.lines.length > 0 && (
        <div className="space-y-3">
          <div>
            <dl className="flex flex-wrap items-end gap-x-3 gap-y-3">
              {terms.map((t) => (
                <div key={t.label} className="flex items-end gap-3">
                  {t.sign && <span aria-hidden="true" className="pb-0.5 text-lg text-ink-400">{t.sign}</span>}
                  <div>
                    <dt className="text-xs text-ink-600">{t.label}</dt>
                    <dd className="text-base font-medium tabular-nums text-ink-800">{money.format(t.value)}</dd>
                  </div>
                </div>
              ))}
              <div className="flex items-end gap-3">
                <span aria-hidden="true" className="pb-0.5 text-lg text-ink-400">=</span>
                <div>
                  <dt className="text-xs font-semibold text-brand-700">Net payroll (AED)</dt>
                  <dd className="text-2xl font-semibold tabular-nums text-ink-900">{money.format(report.totals.netPay)}</dd>
                </div>
              </div>
            </dl>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-600">Highest net pay</p>
            {earners.length === 0 ? (
              <p className="text-sm text-ink-600">No positive net pay yet this month.</p>
            ) : (
              <ol className="space-y-1.5">
                {earners.map((line) => (
                  <li key={line.workerName} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="truncate text-ink-800">{line.workerName}</span>
                    <span aria-hidden="true" className="h-1.5 rounded-sm bg-ink-100">
                      <span className="block h-full rounded-sm bg-brand-500" style={{ width: `${(line.netPay / top) * 100}%` }} />
                    </span>
                    <span className="tabular-nums text-ink-900">{money.format(line.netPay)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Region>
  );
}
