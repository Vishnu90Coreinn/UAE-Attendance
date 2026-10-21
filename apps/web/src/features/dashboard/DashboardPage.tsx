import {
  Banknote,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useDashboardData, type TrendDay } from "./useDashboardData";
import type { AttendanceSummary } from "../../api/attendance";
import type { LeaveRequest } from "../../api/leave";
import type { PayrollReport } from "../../api/payroll";
import {
  AttendanceTrend,
  CHART,
  KpiCard,
  NeedsAttention,
  PayrollBreakdown,
  TodayDonut,
  money,
} from "./widgets";

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dubai",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  return hour < 18 ? "Good afternoon" : "Good evening";
}

/** Manager and Administrator home: headline figures, attendance and payroll charts, and what is waiting on them. */
export function DashboardPage() {
  const { user } = useAuth();
  const { trend, waiting, leave, payroll } = useDashboardData();

  return (
    <section className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900 md:text-2xl">
            {greeting()}
            {user ? `, ${user.username}` : ""}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Here is how the team is doing today.
          </p>
        </div>
        <p className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700">
          {new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Dubai",
            dateStyle: "full",
          }).format(new Date())}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard
          to="/attendance"
          icon={ClipboardCheck}
          tone="green"
          label="Present today"
          state={trend}
          summarise={(days: TrendDay[]) => {
            const today = days[days.length - 1];
            const rate =
              today.total > 0
                ? Math.round((today.present / today.total) * 100)
                : 0;
            return {
              value: `${today.present} / ${today.total}`,
              detail: `${rate}% attendance`,
              spark: days.map((day) => day.present),
              sparkColor: CHART.present,
            };
          }}
        />
        <KpiCard
          to="/attendance"
          icon={ClipboardList}
          tone="amber"
          label="Waiting for approval"
          state={waiting}
          summarise={(summary: AttendanceSummary) => ({
            value: summary.submittedTotal,
            detail:
              summary.submittedTotal === 0
                ? "Nothing to approve"
                : `Across ${summary.submitted.length} ${summary.submitted.length === 1 ? "day" : "days"}`,
          })}
        />
        <KpiCard
          to="/leave"
          icon={CalendarDays}
          tone="violet"
          label="Pending leave"
          state={leave}
          summarise={(requests: LeaveRequest[]) => ({
            value: requests.length,
            detail:
              requests.length === 0
                ? "No requests to decide"
                : "Requests to decide",
          })}
        />
        <KpiCard
          to="/payroll"
          icon={Banknote}
          tone="blue"
          label="Payroll this month (AED)"
          state={payroll}
          summarise={(report: PayrollReport) => ({
            value: money.format(report.totals.netPay),
            detail: `${report.lines.length} ${report.lines.length === 1 ? "worker" : "workers"} · ${report.status}`,
          })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AttendanceTrend state={trend} />
        <TodayDonut state={trend} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <PayrollBreakdown state={payroll} />
        <NeedsAttention waiting={waiting} leave={leave} />
      </div>
    </section>
  );
}
