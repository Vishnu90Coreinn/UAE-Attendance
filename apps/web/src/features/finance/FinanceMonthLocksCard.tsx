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

  return (
    <Card>
      <CardHeader title="Month lock" description="Lock a month once the accountant has what they need. Nothing dated in a locked month can be added, corrected or voided until it is unlocked, with a reason." />
      <div className="p-5">
        {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
        {!locks && !error && <p className="text-sm text-ink-600">Loading months...</p>}
        {locks && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {recentMonths().map((month) => {
              const row = locks.find((l) => l.month === month);
              const locked = row?.isLocked === true;
              return (
                <li key={month} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="w-36 text-sm font-medium text-ink-900">{label(month)}</span>
                  <span className="min-w-0 flex-1 text-sm text-ink-600">
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
