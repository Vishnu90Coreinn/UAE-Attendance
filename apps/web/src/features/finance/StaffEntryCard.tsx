import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { listFinSubmitters, setFinSubmitter, type FinSubmitter } from "../../api/finance";
import { Card, CardHeader } from "../../ui";
import { roleLabel } from "../../permissions";

/** Settings: which office staff may submit expenses. Their expenses wait for a Manager and show no balances. */
export function StaffEntryCard() {
  const [staff, setStaff] = useState<FinSubmitter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFinSubmitters()
      .then((list) => !cancelled && setStaff(list))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "The list could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(user: FinSubmitter) {
    setBusy(user.userId);
    setError(null);
    try {
      const saved = await setFinSubmitter(user.userId, !user.canSubmit);
      setStaff((list) => list?.map((u) => (u.userId === saved.userId ? saved : u)) ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader title="Staff who can enter expenses" description="They add an expense with its receipt. It waits for a Manager to approve it and counts in nothing until then. Mark the accounts they may pay from on the Accounts page." />
      <div className="px-5 pb-5">
        {error && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {staff === null && !error && <p className="text-sm text-ink-600">Loading...</p>}
        {staff?.length === 0 && <p className="text-sm text-ink-600">There are no office staff logins yet. Add them in User Manager.</p>}
        <ul className="divide-y divide-line">
          {staff?.map((u) => (
            <li key={u.userId} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-ink-900">{u.username}</span>
                <span className="text-xs text-ink-500">{roleLabel(u.role)}</span>
              </span>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-800">
                <input type="checkbox" className="size-5" checked={u.canSubmit} disabled={busy === u.userId} onChange={() => void toggle(u)} aria-label={`${u.username} can enter expenses`} />
                Can enter expenses
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
