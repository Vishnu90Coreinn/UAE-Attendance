import {
  Banknote,
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  ClipboardList,
  FilePlus2,
  UserPlus,
} from "lucide-react";
import { PageHeader } from "../../ui";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useDashboardData, type TrendDay } from "./useDashboardData";
import type { AttendanceSummary } from "../../api/attendance";
import type { LeaveRequest } from "../../api/leave";
import type { PayrollReport } from "../../api/payroll";
import {
  AttendanceTrend,
  CHART,
  KpiCard,
  NeedsAttention,
  NoAttendanceNotice,
  PayrollBreakdown,
  QuickActions,
  type QuickAction,
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
  const manager = isManagement(user?.role);
  const actions: QuickAction[] = [
    ...(manager ? [{ to: "/attendance", label: "Mark attendance", icon: ClipboardCheck }] : []),
    ...(manager || user?.role === "HR" ? [{ to: "/workers?new=1", label: "Add worker", icon: UserPlus }] : []),
    ...(manager ? [{ to: "/invoices?new=1", label: "New invoice", icon: FilePlus2 }] : []),
    ...(manager ? [{ to: "/leave?new=1", label: "New leave", icon: CalendarPlus }] : []),
  ];
  const noAttendance =
    trend.status === "ready" && trend.value.every((day) => day.present + day.absent + day.onLeave === 0);

  return (
    <section className="min-w-0 space-y-5">
      <PageHeader
        title={`${greeting()}${user ? `, ${user.username}` : ""}`}
        description="Here is how the team is doing today."
        actions={
          <p className="rounded-full border border-line bg-white px-3 py-1 text-sm font-medium text-ink-700">
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: "Asia/Dubai",
              dateStyle: "full",
            }).format(new Date())}
          </p>
        }
      />

      <div className={`grid gap-4 ${actions.length > 0 ? "lg:grid-cols-3" : ""}`}>
        <div className={actions.length > 0 ? "lg:col-span-2" : ""}>
          <NeedsAttention waiting={waiting} leave={leave} />
        </div>
        {actions.length > 0 && <QuickActions actions={actions} />}
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

      {noAttendance ? (
        <NoAttendanceNotice canRecord={manager} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <AttendanceTrend state={trend} />
          <TodayDonut state={trend} />
        </div>
      )}

      <PayrollBreakdown state={payroll} />
    </section>
  );
}
