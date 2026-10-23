import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CheckCircle2, ChevronRight, type LucideIcon } from "lucide-react";
import type { AttendanceSummary } from "../../api/attendance";
import type { LeaveRequest } from "../../api/leave";
import type { PayrollReport } from "../../api/payroll";
import type { Load, TrendDay } from "./useDashboardData";

/** Chart colours. Status is always also written out (legend, counts), never carried by colour alone. */
export const CHART = {
  present: "#16a34a",
  absent: "#dc2626",
  onLeave: "#f59e0b",
  notRecorded: "#94a3b8",
  basic: "#2563eb",
  overtime: "#38bdf8",
  deductions: "#ef4444",
  grid: "#e2e8f0",
  axis: "#64748b",
} as const;

export const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const tooltipStyle = {
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
  fontSize: 13,
};

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

/** Reserves the widget's space while it loads, so nothing jumps when the figures arrive. */
function Skeleton({ height }: { height: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{ height }}
      className="rounded-lg bg-slate-100 motion-safe:animate-pulse"
    />
  );
}

function Failed() {
  return (
    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
      Could not load this section. Reload the page to try again.
    </p>
  );
}

/** The shared card chrome: title, optional hint and action on the right, then the body. */
export function Panel({
  title,
  hint,
  action,
  className = "",
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-slate-600">{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

const TONES = {
  blue: "bg-blue-50 text-blue-700",
  green: "bg-green-50 text-green-700",
  amber: "bg-amber-50 text-amber-700",
  violet: "bg-violet-50 text-violet-700",
} as const;

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const data = values.map((value, index) => ({ index, value }));
  const id = `spark-${color.replace("#", "")}`;
  return (
    <div aria-hidden="true" className="hidden h-10 w-24 shrink-0 sm:block">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${id})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A headline figure: icon chip, label, big value, a one-line detail and an optional 7-day sparkline. */
export function KpiCard<T>({
  to,
  icon: Icon,
  tone,
  label,
  state,
  summarise,
}: {
  to: string;
  icon: LucideIcon;
  tone: keyof typeof TONES;
  label: string;
  state: Load<T>;
  summarise: (value: T) => {
    value: ReactNode;
    detail: ReactNode;
    spark?: number[];
    sparkColor?: string;
  };
}) {
  const body = state.status === "ready" ? summarise(state.value) : null;
  return (
    <Link
      to={to}
      className={`group block min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md sm:p-5 ${focusClass}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={`inline-flex size-10 items-center justify-center rounded-xl ${TONES[tone]}`}
        >
          <Icon aria-hidden="true" size={20} />
        </span>
        <ChevronRight
          aria-hidden="true"
          size={18}
          className="text-slate-400 transition-transform group-hover:translate-x-0.5"
        />
      </div>
      <p className="mt-2 text-sm font-medium text-slate-600 sm:mt-3">{label}</p>
      {state.status === "loading" && <Skeleton height={56} />}
      {state.status === "error" && (
        <p className="mt-1 text-sm text-red-800">Could not load.</p>
      )}
      {body && (
        <div className="mt-1 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-3xl font-bold tabular-nums text-slate-900">
              {body.value}
            </p>
            <p className="mt-0.5 text-sm text-slate-600">{body.detail}</p>
          </div>
          {body.spark && (
            <Sparkline
              values={body.spark}
              color={body.sparkColor ?? CHART.basic}
            />
          )}
        </div>
      )}
    </Link>
  );
}

function Legend({
  items,
}: {
  items: { label: string; color: string; value?: ReactNode }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ background: item.color }}
          />
          {item.label}
          {item.value !== undefined && (
            <span className="font-semibold tabular-nums text-slate-900">
              {item.value}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AttendanceTrend({ state }: { state: Load<TrendDay[]> }) {
  return (
    <Panel
      title="Attendance, last 7 days"
      hint="Workers present, absent, on leave and not yet recorded each day"
      className="lg:col-span-2"
    >
      {state.status === "loading" && <Skeleton height={240} />}
      {state.status === "error" && <Failed />}
      {state.status === "ready" &&
        (state.value.every((day) => day.present + day.absent + day.onLeave === 0) ? (
          <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-600">
            No attendance has been recorded in the last 7 days.
          </p>
        ) : (
          <>
            <div
              role="img"
              aria-label={`Attendance for the last 7 days. ${state.value
                .map(
                  (day) =>
                    `${day.label}: ${day.present} present, ${day.absent} absent, ${day.onLeave} on leave, ${day.notRecorded} not recorded`,
                )
                .join(". ")}.`}
              className="h-56 sm:h-64"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={state.value}
                  margin={{ top: 8, right: 4, bottom: 0, left: -20 }}
                >
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: CHART.axis, fontSize: 12 }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: CHART.axis, fontSize: 12 }}
                  />
                  <Tooltip
                    cursor={{ fill: "#f1f5f9" }}
                    contentStyle={tooltipStyle}
                  />
                  <Bar
                    name="Present"
                    dataKey="present"
                    stackId="a"
                    fill={CHART.present}
                    maxBarSize={36}
                    isAnimationActive={false}
                  />
                  <Bar
                    name="Absent"
                    dataKey="absent"
                    stackId="a"
                    fill={CHART.absent}
                    maxBarSize={36}
                    isAnimationActive={false}
                  />
                  <Bar
                    name="On leave"
                    dataKey="onLeave"
                    stackId="a"
                    fill={CHART.onLeave}
                    maxBarSize={36}
                    isAnimationActive={false}
                  />
                  <Bar
                    name="Not recorded"
                    dataKey="notRecorded"
                    stackId="a"
                    fill={CHART.notRecorded}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3">
              <Legend
                items={[
                  { label: "Present", color: CHART.present },
                  { label: "Absent", color: CHART.absent },
                  { label: "On leave", color: CHART.onLeave },
                  { label: "Not recorded", color: CHART.notRecorded },
                ]}
              />
            </div>
          </>
        ))}
    </Panel>
  );
}

export function TodayDonut({ state }: { state: Load<TrendDay[]> }) {
  const today =
    state.status === "ready" ? state.value[state.value.length - 1] : null;
  const rate =
    today && today.total > 0
      ? Math.round((today.present / today.total) * 100)
      : 0;
  const slices = today
    ? [
        { name: "Present", value: today.present, color: CHART.present },
        { name: "Absent", value: today.absent, color: CHART.absent },
        { name: "On leave", value: today.onLeave, color: CHART.onLeave },
        {
          name: "Not recorded",
          value: today.notRecorded,
          color: CHART.notRecorded,
        },
      ]
    : [];
  /** Zero-sized slices are left out of the ring so they do not leave stray gaps. */
  const ring =
    today && today.total > 0
      ? slices.filter((slice) => slice.value > 0)
      : [{ name: "No workers", value: 1, color: CHART.grid }];
  return (
    <Panel title="Today" hint="Attendance rate across active workers">
      {state.status === "loading" && <Skeleton height={240} />}
      {state.status === "error" && <Failed />}
      {today && (
        <>
          <div
            role="img"
            aria-label={`${rate}% present today: ${today.present} present, ${today.absent} absent, ${today.onLeave} on leave, ${today.notRecorded} not recorded.`}
            className="relative mx-auto h-44 w-44"
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={ring}
                  dataKey="value"
                  innerRadius="68%"
                  outerRadius="100%"
                  paddingAngle={ring.length > 1 ? 2 : 0}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {ring.map((slice, index) => (
                    <Cell key={index} fill={slice.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold tabular-nums text-slate-900">
                {rate}%
              </span>
              <span className="text-xs font-medium text-slate-600">
                present
              </span>
            </div>
          </div>
          <div className="mt-4 justify-center">
            <Legend
              items={slices.map((slice) => ({
                label: slice.name,
                color: slice.color,
                value: whole.format(slice.value),
              }))}
            />
          </div>
        </>
      )}
    </Panel>
  );
}

export function PayrollBreakdown({ state }: { state: Load<PayrollReport> }) {
  const report = state.status === "ready" ? state.value : null;
  const earners = report
    ? [...report.lines]
        .filter((line) => line.netPay > 0)
        .sort((a, b) => b.netPay - a.netPay)
        .slice(0, 5)
    : [];
  const parts = report
    ? [
        {
          label: "Basic pay",
          value: report.totals.basicPay,
          color: CHART.basic,
        },
        {
          label: "Overtime",
          value: report.totals.overtimePay,
          color: CHART.overtime,
        },
        {
          label: "Deductions",
          value: report.totals.totalDeductions,
          color: CHART.deductions,
        },
      ]
    : [];
  const gross = report ? report.totals.basicPay + report.totals.overtimePay : 0;
  return (
    <Panel
      title="Payroll this month"
      hint={report ? `${report.period} · ${report.status}` : undefined}
      className="lg:col-span-2"
      action={
        <Link
          to="/payroll"
          className={`shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50 ${focusClass}`}
        >
          View report
        </Link>
      }
    >
      {state.status === "loading" && <Skeleton height={220} />}
      {state.status === "error" && <Failed />}
      {report &&
        (report.lines.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-600">
            No payroll lines for this month yet.
          </p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-600">
                Net payroll (AED)
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
                {money.format(report.totals.netPay)}
              </p>
              {gross > 0 && (
                <div
                  role="img"
                  aria-label={`Composition: ${parts.map((part) => `${part.label} ${money.format(part.value)}`).join(", ")}`}
                  className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100"
                >
                  {parts.slice(0, 2).map((part) => (
                    <div
                      key={part.label}
                      style={{
                        width: `${(part.value / gross) * 100}%`,
                        background: part.color,
                      }}
                    />
                  ))}
                </div>
              )}
              <dl className="mt-4 space-y-2 text-sm">
                {parts.map((part) => (
                  <div
                    key={part.label}
                    className="flex items-center justify-between gap-3"
                  >
                    <dt className="inline-flex items-center gap-2 text-slate-700">
                      <span
                        aria-hidden="true"
                        className="size-2.5 rounded-full"
                        style={{ background: part.color }}
                      />
                      {part.label}
                    </dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {money.format(part.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-600">
                Highest net pay
              </p>
              {earners.length === 0 ? (
                <p className="mt-2 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                  No positive net pay yet this month.
                </p>
              ) : (
                <div
                  role="img"
                  aria-label={`Highest net pay: ${earners.map((line) => `${line.workerName} ${money.format(line.netPay)}`).join(", ")}`}
                  style={{ height: Math.max(earners.length, 2) * 44 }}
                  className="mt-2"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={earners}
                      layout="vertical"
                      margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                    >
                      <XAxis type="number" hide domain={[0, "dataMax"]} />
                      <YAxis
                        type="category"
                        dataKey="workerName"
                        width={110}
                        interval={0}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(name: string) =>
                          name.length > 16 ? `${name.slice(0, 15)}…` : name
                        }
                        tick={{ fill: "#334155", fontSize: 12 }}
                      />
                      <Tooltip
                        cursor={{ fill: "#f1f5f9" }}
                        contentStyle={tooltipStyle}
                        formatter={(value) => [
                          money.format(Number(value)),
                          "Net pay (AED)",
                        ]}
                      />
                      <Bar
                        dataKey="netPay"
                        fill={CHART.basic}
                        radius={[0, 6, 6, 0]}
                        barSize={18}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        ))}
    </Panel>
  );
}

function AttentionRow({
  to,
  title,
  detail,
  badge,
}: {
  to: string;
  title: string;
  detail: string;
  badge: ReactNode;
}) {
  return (
    <li>
      <Link
        to={to}
        className={`flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-slate-50 ${focusClass}`}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900">
            {title}
          </span>
          <span className="block truncate text-xs text-slate-600">
            {detail}
          </span>
        </span>
        {badge}
      </Link>
    </li>
  );
}

export function NeedsAttention({
  waiting,
  leave,
}: {
  waiting: Load<AttendanceSummary>;
  leave: Load<LeaveRequest[]>;
}) {
  const failed = waiting.status === "error" || leave.status === "error";
  const loading = waiting.status === "loading" || leave.status === "loading";
  const days = waiting.status === "ready" ? waiting.value.submitted : [];
  const requests = leave.status === "ready" ? leave.value : [];
  const empty =
    !loading && !failed && days.length === 0 && requests.length === 0;
  return (
    <Panel title="Needs your attention" hint="Waiting on a manager's decision">
      {loading && <Skeleton height={160} />}
      {failed && <Failed />}
      {empty && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-green-50 p-6 text-center">
          <CheckCircle2
            aria-hidden="true"
            className="text-green-700"
            size={28}
          />
          <p className="text-sm font-medium text-green-900">
            You're all caught up. Nothing is waiting for approval.
          </p>
        </div>
      )}
      {!loading && !failed && !empty && (
        <ul className="-mx-1 space-y-1">
          {days.slice(0, 4).map((day) => (
            <AttentionRow
              key={day.date}
              to="/attendance"
              title={`Attendance for ${day.date}`}
              detail={`${day.count} ${day.count === 1 ? "entry" : "entries"} to approve`}
              badge={
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                  Approve
                </span>
              }
            />
          ))}
          {requests.slice(0, 4).map((request) => (
            <AttentionRow
              key={request.id}
              to="/leave"
              title={request.workerName}
              detail={`${request.leaveType} · ${request.startDate} to ${request.endDate} (${request.days} ${request.days === 1 ? "day" : "days"})`}
              badge={
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-900">
                  Decide
                </span>
              }
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
