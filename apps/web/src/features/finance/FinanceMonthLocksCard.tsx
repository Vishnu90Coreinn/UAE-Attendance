import { useCallback, useEffect, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { listFinMonthLocks, lockFinMonth, unlockFinMonth, type FinMonthLock } from "../../api/finance";
import { ApiError } from "../../api/client";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { Button, Card, CardHeader, StatusBadge } from "../../ui";
import { todayInUae } from "./financeFormat";
import { VoidDialog } from "./VoidDialog";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The current month and the eleven before it, newest first, as yyyy-MM. */
function recentMonths(): string[] {
  const [year, month] = todayInUae().split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const index = year * 12 + (month - 1) - i;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}

function label(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return `${MONTHS[number - 1]} ${year}`;
}

function day(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" });
}

/** Settings card where a Manager locks a finished month so nothing dated in it can change, and unlocks it with a reason. */
export function FinanceMonthLocksCard() {
  const desktop = useIsDesktop();
  const [locks, setLocks] = useState<FinMonthLock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [through, setThrough] = useState("");
  const [confirmThrough, setConfirmThrough] = useState(false);

  const load = useCallback(() => {
    listFinMonthLocks().then(setLocks).catch((e) => setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again."));
  }, []);
  useEffect(load, [load]);

  async function lock(month: string) {
    setPending(month);
    setError(null);
    try {
      await lockFinMonth(month);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setPending(null);
    }
  }

  const months = recentMonths();
  const lockedNow = new Set((locks ?? []).filter((l) => l.isLocked).map((l) => l.month));
  const newestLocked = months.find((m) => lockedNow.has(m));
  // An open month with a locked month after it: something can still change behind the lock, which is almost always a mistake.
  const gaps = newestLocked ? months.filter((m) => m < newestLocked && !lockedNow.has(m)) : [];
  const target = through || months[1];   // the month that just ended, unless another is chosen
  const toLock = months.filter((m) => m <= target && !lockedNow.has(m)).reverse();   // oldest first

  async function lockThrough() {
    setConfirmThrough(false);
    setError(null);
    for (const month of toLock) {
      setPending(month);
      try {
        await lockFinMonth(month);
      } catch (e) {
        setError(`${label(month)} could not be locked: ${e instanceof ApiError ? e.message : "something went wrong."} The months before it are locked.`);
        break;
      }
    }

    setPending(null);
    load();
  }

  return (
    <Card>
      <CardHeader title="Month lock" description="Lock a month once the accountant has what they need. Nothing dated in a locked month can be added, corrected or voided until it is unlocked, with a reason." />
      <div className="p-5">
        {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
        {!locks && !error && <p className="text-sm text-ink-600">Loading months...</p>}
        {locks && (
          <div className="mb-4 rounded-lg bg-ink-50 p-3">
            <p className="text-sm font-medium text-ink-900">{newestLocked ? `Locked up to ${label(newestLocked)}.` : "No month is locked yet."}</p>
            {gaps.length > 0 && (
              <p role="status" className="mt-1 text-sm text-amber-900">
                {gaps.length === 1 ? `${label(gaps[0])} is still open` : `${gaps.length} months (${label(gaps[gaps.length - 1])} to ${label(gaps[0])}) are still open`} although {label(newestLocked!)} is locked. Lock {gaps.length === 1 ? "it" : "them"} too, so nothing can change behind a locked month.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-sm text-ink-700">
                <span className="block text-xs font-medium text-ink-600">Lock every month up to</span>
                <select value={target} onChange={(e) => setThrough(e.target.value)} className="select-control mt-1 min-h-11 rounded-lg border border-line bg-white px-3 text-sm text-ink-900 md:min-h-10">
                  {months.map((m) => <option key={m} value={m}>{label(m)}</option>)}
                </select>
              </label>
              {confirmThrough ? (
                <>
                  <Button icon={Lock} disabled={pending !== null} onClick={() => void lockThrough()}>Yes, lock {toLock.length} month{toLock.length === 1 ? "" : "s"}</Button>
                  <Button variant="secondary" onClick={() => setConfirmThrough(false)}>Not now</Button>
                </>
              ) : (
                <Button variant="secondary" icon={Lock} disabled={toLock.length === 0 || pending !== null} onClick={() => setConfirmThrough(true)}>
                  {toLock.length === 0 ? "Already locked" : `Lock ${toLock.length} month${toLock.length === 1 ? "" : "s"}`}
                </Button>
              )}
            </div>
            {confirmThrough && <p className="mt-2 text-sm text-ink-700">Nothing dated in {toLock.length === 1 ? label(toLock[0]) : `${label(toLock[0])} to ${label(toLock[toLock.length - 1])}`} can then be added, corrected or voided until it is unlocked, with a reason.</p>}
          </div>
        )}
        {locks && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {months.map((month) => {
              const row = locks.find((l) => l.month === month);
              const locked = row?.isLocked === true;
              return (
                <li key={month} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="w-36 text-[15px] font-semibold text-ink-900">{label(month)}</span>
                  <span className="min-w-0 flex-1 text-[13px] text-ink-500">
                    {locked ? (
                      <><StatusBadge tone="info" icon={Lock} variant="icon">Locked</StatusBadge> <span className="ml-1">by {row.lockedBy} on {day(row.lockedUtc)}</span></>
                    ) : row?.unlockReason ? (
                      <span>Unlocked by {row.unlockedBy} on {day(row.unlockedUtc)}: {row.unlockReason}</span>
                    ) : (
                      "Open"
                    )}
                  </span>
                  {locked ? (
                    <Button size="sm" variant="ghost" icon={LockOpen} onClick={() => setUnlocking(month)} aria-label={`Unlock ${label(month)}`}>Unlock</Button>
                  ) : (
                    <Button size="sm" variant="secondary" icon={Lock} disabled={pending === month} onClick={() => void lock(month)} aria-label={`Lock ${label(month)}`}>Lock</Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {unlocking && (
        <VoidDialog
          title={`Unlock ${label(unlocking)}?`}
          message="Entries and transfers dated in this month can then be added, corrected and voided again. The reason is kept with the month."
          confirmLabel="Unlock"
          confirmIcon={LockOpen}
          danger={false}
          variant={desktop ? "center" : "sheet"}
          onClose={() => setUnlocking(null)}
          onConfirm={async (reason) => {
            await unlockFinMonth(unlocking, reason);
            setUnlocking(null);
            load();
          }}
        />
      )}
    </Card>
  );
}
