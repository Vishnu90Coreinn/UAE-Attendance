import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, CalendarOff, LogIn, LogOut, MapPinOff } from "lucide-react";
import { ApiError } from "../../api/client";
import { getMyDays, getMyStaff, punch, type Punch, type StaffDay, type StaffMe } from "../../api/staff";
import { Dialog } from "../../components/Dialog";
import { Button, Card, CardHeader, LoadingState, PageHeader } from "../../ui";
import { LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { SelfieDialog } from "./SelfieDialog";
import type { PlaceResult } from "./selfie";
import { DayStrip, greeting, LiveDot, ShiftBar, uaeClock, useUaeNow } from "./staffKit";
import { addDays, DayFlags, errorText, hoursText, longDate, StaffStatusBadge, todayInUae } from "./staffUi";

/** Sign-in and sign-out pairs as a vertical timeline, with the time spent between them. */
function Timeline({ punches }: { punches: Punch[] }) {
  if (punches.length === 0) {
    return <p className="px-5 py-6 text-sm text-ink-600">Nothing yet. Your first sign-in will appear here.</p>;
  }
  return (
    <ol className="px-5 py-4">
      {punches.map((p, index) => {
        const next = punches[index + 1];
        const gap = next && p.kind === "In" ? minutesBetween(p.time, next.time) : null;
        const isIn = p.kind === "In";
        return (
          <li key={p.id} className="relative flex gap-4 pb-5 last:pb-0">
            {index < punches.length - 1 && <span aria-hidden="true" className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-ink-200" />}
            <span
              aria-hidden="true"
              className={`relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full ${isIn ? "bg-brand-600 text-white" : "bg-ink-200 text-ink-800"}`}
            >
              {isIn ? <LogIn size={15} /> : <LogOut size={15} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-semibold text-ink-900">{isIn ? "Signed in" : "Signed out"}</span>
                <span className="font-mono text-sm tabular-nums text-ink-700">{p.time.slice(0, 5)}</span>
              </p>
              {gap !== null && <p className="text-sm text-ink-600">{hoursText(gap / 60)} at work</p>}
              {p.outsideOffice && (
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-amber-800">
                  <MapPinOff aria-hidden="true" size={14} /> Outside the office area. Your manager will see this.
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return bh * 60 + bm - (ah * 60 + am);
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-600">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums text-ink-900">{value}</dd>
    </div>
  );
}

export function MyAttendancePage() {
  const [me, setMe] = useState<StaffMe | null>(null);
  const [days, setDays] = useState<StaffDay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [dayOffWarning, setDayOffWarning] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const now = useUaeNow();
  const clock = uaeClock(now);

  const loadDays = useCallback(async () => {
    const today = todayInUae();
    setDays(await getMyDays(addDays(today, -29), today));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [mine] = await Promise.all([getMyStaff(), loadDays()]);
      setMe(mine);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "No employee record is linked to your login. Ask HR to link it." : errorText(e));
    }
  }, [loadDays]);
  useEffect(() => {
    void load();
  }, [load]);

  async function confirm(selfie: string, place: PlaceResult) {
    try {
      const updated = await punch({
        selfieBase64: selfie,
        latitude: place.ok ? place.place.latitude : null,
        longitude: place.ok ? place.place.longitude : null,
        accuracyMeters: place.ok ? place.place.accuracyMeters : null,
      });
      setMe(updated);
      setCapturing(false);
      setSuccess(updated.nextKind === "Out" ? "You are signed in. Have a good day." : "You are signed out. See you next time.");
      void loadDays().catch(() => undefined);
    } catch (e) {
      throw new Error(errorText(e));
    }
  }

  const totals = useMemo(
    () => ({
      hours: days.reduce((sum, d) => sum + d.hours, 0),
      present: days.filter((d) => d.punchCount > 0).length,
      late: days.filter((d) => d.isLate).length,
      absent: days.filter((d) => d.status === "Absent").length,
    }),
    [days],
  );

  if (error) return <LoadError message={error} onRetry={() => void load()} />;
  if (!me) return <LoadingState label="Loading..." />;

  const signingIn = me.nextKind === "In";
  const first = me.name.split(" ")[0];
  return (
    <section>
      <PageHeader title="My Attendance" description={`${me.name} · ${me.code}${me.department ? ` · ${me.department}` : ""}`} />
      <SuccessRegion message={success} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-6">
          {/* The punch clock: the one dark surface on the page, so the main action is unmistakable. */}
          <div className="overflow-hidden rounded-card bg-sidebar text-white shadow-pop">
            <div className="px-6 pb-6 pt-7">
              <p className="text-sm text-brand-100">
                {greeting(clock.minutes)}, {first}
              </p>
              <p className="mt-1 text-sm text-brand-200">{longDate(todayInUae())}</p>
              <p className="mt-4 flex items-baseline gap-1 font-mono tabular-nums" aria-label={`Time in the UAE, ${clock.time}`}>
                <span className="text-6xl font-medium leading-none tracking-tight sm:text-7xl">{clock.time}</span>
                <span className="text-2xl text-brand-300">:{clock.seconds}</span>
              </p>
              <p className="mt-5 flex items-center gap-2 text-base font-medium" role="status">
                {me.nextKind === "Out" ? (
                  <>
                    <LiveDot /> In the office since {me.today.firstIn}
                  </>
                ) : me.punches.length > 0 ? (
                  <>
                    <span aria-hidden="true" className="size-2.5 rounded-full bg-brand-300" /> Signed out at {me.today.lastOut ?? me.punches[me.punches.length - 1].time.slice(0, 5)}
                  </>
                ) : (
                  <>
                    <span aria-hidden="true" className="size-2.5 rounded-full border border-brand-300" /> Not signed in yet
                  </>
                )}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <StaffStatusBadge status={me.today.status} />
                <DayFlags day={me.today} onDark />
                <span className="text-sm text-brand-100">{hoursText(me.today.hours)} worked today</span>
              </div>
              <div className="mt-6">
                <ShiftBar start={me.shiftStart} end={me.shiftEnd} nowMinutes={clock.minutes} />
              </div>
            </div>
            <div className="border-t border-white/10 bg-black/15 p-4">
              <button
                type="button"
                onClick={() => {
                  setSuccess(null);
                  // A first sign-in on a weekly off or a public holiday asks first; they may still carry on.
                  if (signingIn && me.dayType && me.punches.length === 0) setDayOffWarning(true);
                  else setCapturing(true);
                }}
                className={`group flex min-h-16 w-full items-center justify-center gap-3 rounded-lg text-lg font-semibold transition-transform duration-150 active:scale-[0.99] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                  signingIn ? "bg-white text-brand-800 hover:bg-brand-50" : "bg-brand-500 text-white hover:bg-brand-400"
                }`}
              >
                {signingIn ? <LogIn aria-hidden="true" size={22} /> : <LogOut aria-hidden="true" size={22} />}
                {signingIn ? "Sign in" : "Sign out"}
                <Camera aria-hidden="true" size={18} className="opacity-60" />
              </button>
              <p className="mt-2 text-center text-xs text-brand-200">A selfie and your location are recorded. The time comes from the server.</p>
            </div>
          </div>

          <Card>
            <CardHeader title="Today" description={me.punches.length ? `${me.punches.length} record${me.punches.length === 1 ? "" : "s"}` : undefined} />
            <Timeline punches={me.punches} />
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader title="Last 30 days" description="Your month at a glance." />
          <div className="space-y-5 p-5">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Figure label="Hours" value={hoursText(totals.hours)} />
              <Figure label="Days in" value={String(totals.present)} />
              <Figure label="Late" value={String(totals.late)} />
              <Figure label="Absent" value={String(totals.absent)} />
            </dl>
            <DayStrip days={days} />
          </div>
          <details className="border-t border-line">
            <summary className="flex min-h-11 cursor-pointer items-center px-5 text-sm font-medium text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-500">
              Show the day-by-day list
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-ink-50 text-xs uppercase text-ink-600">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">In</th>
                    <th className="px-4 py-2">Out</th>
                    <th className="px-4 py-2 text-right">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {[...days].reverse().map((d) => (
                    <tr key={d.date} className="border-t border-line">
                      <td className="whitespace-nowrap px-4 py-2">{longDate(d.date)}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <StaffStatusBadge status={d.status} />
                          <DayFlags day={d} />
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums">{d.firstIn ?? "-"}</td>
                      <td className="px-4 py-2 font-mono tabular-nums">{d.lastOut ?? "-"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{d.hours ? d.hours.toFixed(2) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>
      </div>

      <Dialog open={dayOffWarning} title="Today is not a working day" onClose={() => setDayOffWarning(false)}>
        <div className="mt-3 flex gap-3">
          <CalendarOff aria-hidden="true" size={22} className="mt-0.5 shrink-0 text-amber-700" />
          <div className="space-y-2 text-base text-ink-800">
            <p>
              {me.dayType === "Weekly off" ? "Today is your weekly off." : `Today is a public holiday: ${me.dayType}.`} You are not expected to work.
            </p>
            <p>Do you still want to sign in? Your sign-in will be recorded for your manager to see.</p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setDayOffWarning(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setDayOffWarning(false);
              setCapturing(true);
            }}
          >
            Sign in anyway
          </Button>
        </div>
      </Dialog>

      {capturing && <SelfieDialog kind={me.nextKind} onCancel={() => setCapturing(false)} onConfirm={confirm} />}
    </section>
  );
}
