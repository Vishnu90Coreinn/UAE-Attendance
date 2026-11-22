import { CalendarPlus, ClipboardCheck, FilePlus2, UserPlus } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useDashboardData } from "./useDashboardData";
import {
  DecisionFigure,
  Invoices,
  LeadFigure,
  OfficeToday,
  Payroll,
  type QuickAction,
  SheetHeader,
  SiteToday,
  ReceivablesFigure,
  Waiting,
  WeekPanes,
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Manager and Administrator home: headline figures, attendance and payroll charts, and what is waiting on them. */
export function DashboardPage() {
  const { user } = useAuth();
  const { trend, waiting, leave, payroll, staff, staffLeave, invoices, updatedAt, refreshing, refresh } = useDashboardData();
  const manager = isManagement(user?.role);
  const waitingCount =
    (waiting.status === "ready" ? waiting.value.submitted.length : 0) +
    (leave.status === "ready" ? leave.value.length : 0) +
    (staffLeave?.status === "ready" ? staffLeave.value.length : 0);
  const today = trend.status === "ready" ? trend.value[trend.value.length - 1] : null;
  const summary = (
    <>
      {today && today.total > 0 ? `${today.present} of ${plural(today.total, "site worker", "site workers")} present today. ` : ""}
      {staff?.status === "ready" && staff.value.total > 0 && !(staff.value.dayType && staff.value.signedIn === 0)
        ? `${staff.value.signedIn} of ${plural(staff.value.total, "office employee", "office employees")} signed in. `
        : ""}
      {waitingCount > 0
        ? `${plural(waitingCount, "item is", "items are")} waiting for your decision.`
        : "Nothing is waiting for your decision."}
    </>
  );
  const actions: QuickAction[] = [
    ...(manager ? [{ to: "/attendance", label: "Mark attendance", icon: ClipboardCheck }] : []),
    ...(manager ? [{ to: "/workers?new=1", label: "Add worker", icon: UserPlus }] : []),
    ...(manager ? [{ to: "/invoices?new=1", label: "New invoice", icon: FilePlus2 }] : []),
    ...(manager ? [{ to: "/leave?new=1", label: "New leave", icon: CalendarPlus }] : []),
  ];

  const waitingKnown = ![waiting.status, leave.status, staffLeave?.status ?? "ready"].includes("loading");
  const hasWaiting = !waitingKnown || waitingCount > 0;
  const submittedDays = waiting.status === "ready" ? waiting.value.submitted.length : 0;
  const decisionDetail =
    waitingCount === 0
      ? "Nothing to approve"
      : [
          submittedDays > 0 ? `Across ${plural(submittedDays, "day", "days")}` : null,
          waitingCount - submittedDays > 0 ? plural(waitingCount - submittedDays, "leave request", "leave requests") : null,
        ]
          .filter(Boolean)
          .join(" · ");
  const week = <WeekPanes state={trend} canRecord={manager} />;
  const attention = <Waiting waiting={waiting} leave={leave} staffLeave={staffLeave} />;

  return (
    <section className="min-w-0">
      <div className="overflow-hidden rounded-md border border-ink-300 bg-white">
        <SheetHeader
          date={new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", dateStyle: "full" }).format(new Date())}
          title={`${greeting()}${user ? `, ${user.username}` : ""}`}
          summary={summary}
          actions={actions}
          updatedAt={updatedAt}
          refreshing={refreshing}
          onRefresh={refresh}
        />

        <div className="grid gap-px border-t border-ink-300 bg-ink-200 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="sm:col-span-2 lg:col-span-1 [&>a]:h-full">
            <LeadFigure trend={trend} staff={staff} />
          </div>
          <DecisionFigure
            to={waitingCount > 0 && waiting.status === "ready" && waiting.value.submitted.length === 0 ? "/leave" : "/attendance"}
            loading={!waitingKnown}
            count={waitingCount}
            detail={decisionDetail}
          />
          <ReceivablesFigure state={invoices} />
        </div>

        {hasWaiting ? (
          <div className="grid gap-px border-t border-ink-300 bg-ink-200 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="bg-white">
              {week}
              <div className="border-t border-ink-200"><SiteToday state={trend} /></div>
            </div>
            <div className="bg-white">{attention}</div>
          </div>
        ) : (
          <div className="border-t border-ink-300">
            {attention}
            <div className="border-t border-ink-200">{week}</div>
            <div className="border-t border-ink-200"><SiteToday state={trend} /></div>
          </div>
        )}

        <div className="grid gap-px border-t border-ink-300 bg-ink-200 md:grid-cols-3">
          <div className="bg-white"><OfficeToday state={staff} /></div>
          <div className="bg-white"><Payroll state={payroll} /></div>
          <div className="bg-white"><Invoices state={invoices} /></div>
        </div>
      </div>
    </section>
  );
}
