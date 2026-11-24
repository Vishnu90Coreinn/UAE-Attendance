import { Camera, LogIn, LogOut, WifiOff } from "lucide-react";
import type { StaffDay, StaffMe } from "../../api/staff";
import { PAGE_GAP, phoneButton } from "../../components/phoneUi";
import { Card, CardHeader } from "../../ui";
import { DayStrip, greeting, LiveDot, ShiftBar, useOnline } from "./staffKit";
import { DayFlags, hoursText, longDate, shortDate, StaffStatusBadge, todayInUae } from "./staffUi";
import { Timeline } from "./MyAttendanceTimeline";

interface Totals {
  hours: number;
  present: number;
  late: number;
  absent: number;
}

/**
 * My Attendance on a phone. The top card says where the employee stands today; the one action (sign in or sign out)
 * is a bar pinned above the tab bar, so it is under the thumb however far the page has scrolled.
 */
export function MyAttendancePhone({
  me,
  days,
  totals,
  clock,
  onAction,
}: {
  me: StaffMe;
  days: StaffDay[];
  totals: Totals;
  clock: { time: string; minutes: number };
  onAction: () => void;
}) {
  const online = useOnline();
  const signingIn = me.nextKind === "In";
  const first = me.name.split(" ")[0];
  return (
    <section className={PAGE_GAP}>
      <div className="rounded-3xl bg-sidebar p-5 text-white shadow-pop">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-brand-100">
            {greeting(clock.minutes)}, {first}
          </p>
          <time className="font-mono text-lg font-medium tabular-nums text-white" dateTime={clock.time} title="Time in the UAE">
            {clock.time}
          </time>
        </div>
        <p className="text-sm text-brand-200">{longDate(todayInUae())}</p>
        <p className="mt-4 flex items-center gap-2.5 text-2xl font-bold" role="status">
          {me.nextKind === "Out" ? (
            <>
              <LiveDot /> In since {me.today.firstIn}
            </>
          ) : me.punches.length > 0 ? (
            <>
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-brand-300" /> Signed out at {me.today.lastOut ?? me.punches[me.punches.length - 1].time.slice(0, 5)}
            </>
          ) : (
            <>
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full border-2 border-brand-300" /> Not signed in yet
            </>
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <StaffStatusBadge status={me.today.status} />
          <DayFlags day={me.today} onDark />
          <span className="text-sm text-brand-100">{hoursText(me.today.hours)} worked today</span>
        </div>
        <div className="mt-5">
          <ShiftBar start={me.shiftStart} end={me.shiftEnd} nowMinutes={clock.minutes} />
        </div>
      </div>

      <Card>
        <CardHeader title="Today" description={me.punches.length ? `${me.punches.length} record${me.punches.length === 1 ? "" : "s"}` : undefined} />
        <Timeline punches={me.punches} />
      </Card>

      <Card>
        <CardHeader title="Last 30 days" description="Your month at a glance." />
        <div className="space-y-5 p-5">
          <dl className="grid grid-cols-2 gap-4">
            <Figure label="Hours" value={hoursText(totals.hours)} />
            <Figure label="Days in" value={String(totals.present)} />
            <Figure label="Late" value={String(totals.late)} />
            <Figure label="Absent" value={String(totals.absent)} />
          </dl>
          <DayStrip days={days} />
        </div>
        <details className="group border-t border-line">
          <summary className="flex min-h-12 cursor-pointer items-center px-5 text-sm font-semibold text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-500">
            <span className="group-open:hidden">Show the day-by-day list</span>
            <span className="hidden group-open:inline">Hide the day-by-day list</span>
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {[...days].reverse().map((d) => (
              <li key={d.date} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900">{shortDate(d.date)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StaffStatusBadge status={d.status} />
                    <DayFlags day={d} />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm tabular-nums text-ink-800">
                    {d.firstIn ?? "-"} to {d.lastOut ?? "-"}
                  </p>
                  <p className="text-sm tabular-nums text-ink-600">{d.hours ? `${d.hours.toFixed(2)} h` : "-"}</p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      </Card>

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 rounded-3xl border border-line bg-white p-2 shadow-pop">
        <button type="button" onClick={onAction} disabled={!online} className={phoneButton("primary", "lg", `w-full text-lg ${signingIn ? "" : "bg-ink-900! active:bg-ink-800!"}`)}>
          {signingIn ? <LogIn aria-hidden="true" size={22} /> : <LogOut aria-hidden="true" size={22} />}
          {signingIn ? "Sign in" : "Sign out"}
        </button>
        {online ? (
          <p className="mt-1.5 flex items-center justify-center gap-1.5 pb-1 text-sm text-ink-700">
            <Camera aria-hidden="true" size={14} /> Takes a selfie and records where you are.
          </p>
        ) : (
          <p role="alert" className="mt-1.5 flex items-center justify-center gap-1.5 pb-1 text-sm font-medium text-amber-800">
            <WifiOff aria-hidden="true" size={14} /> No connection. Reconnect to sign {signingIn ? "in" : "out"}.
          </p>
        )}
      </div>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-600">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums text-ink-900">{value}</dd>
    </div>
  );
}
