import { useCallback, useEffect, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { ApiError } from "../../api/client";
import { closeFinYear, listFinYears, reopenFinYear, type FinYear } from "../../api/finance";
import { TextField } from "../../components/TextField";
import { Button, Card, CardHeader } from "../../ui";
import { formatDay, formatMoney } from "./financeFormat";

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/**
 * The financial year runs 1 January to 31 December. Closing a finished year locks its months and moves its income and expenses into
 * retained earnings, so the next year starts from zero. An Administrator can reopen the latest closed year, with a reason.
 */
export function YearEndTab({ canClose, canReopen, onChanged }: { canClose: boolean; canReopen: boolean; onChanged: () => void }) {
  const [years, setYears] = useState<FinYear[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [reopening, setReopening] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      setYears(await listFinYears());
    } catch (e) {
      setError(failure(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(year: number, action: () => Promise<FinYear>, done: string) {
    setBusy(year);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      setConfirming(null);
      setReopening(null);
      setReason("");
      await load();
      onChanged();
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
        The financial year runs 1 January to 31 December. Closing a year locks its twelve months and moves its income and expenses into retained earnings in one journal dated 31 December.
        Its Profit &amp; Loss still reads the same. Years are closed in order.
      </p>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">{notice}</p>}
      {!years && !error && <p className="text-sm text-ink-600">Loading...</p>}
      {years?.length === 0 && <p className="text-sm text-ink-600">There are no books yet, so there is no year to close.</p>}
      {years && [...years].reverse().map((y) => (
        <Card key={y.year}>
          <CardHeader
            title={`Year ${y.year}`}
            description={y.status === "Closed" ? `Closed by ${y.closedBy ?? "a user"}${y.closedUtc ? ` on ${formatDay(y.closedUtc.slice(0, 10))}` : ""} (${y.journalNumber})` : `1 January to 31 December ${y.year}`}
            actions={<span className={y.status === "Closed" ? "inline-flex items-center gap-1 text-sm font-semibold text-green-800" : "text-sm font-semibold text-ink-600"}>{y.status === "Closed" ? <><Lock className="size-4" aria-hidden /> Closed</> : "Open"}</span>}
          />
          <dl className="grid grid-cols-3 gap-3 border-t border-line px-5 py-3 text-sm">
            <div><dt className="text-ink-500">Income</dt><dd className="tabular-nums text-ink-900">AED {formatMoney(y.revenue)}</dd></div>
            <div><dt className="text-ink-500">Expenses</dt><dd className="tabular-nums text-ink-900">AED {formatMoney(y.expenses)}</dd></div>
            <div><dt className="text-ink-500">{y.netResult >= 0 ? "Profit" : "Loss"}</dt><dd className="font-display tabular-nums text-ink-900">AED {formatMoney(Math.abs(y.netResult))}</dd></div>
          </dl>
          {y.status === "Open" && y.blocker && <p className="border-t border-line px-5 py-3 text-sm text-ink-600">{y.blocker}</p>}
          {y.canClose && canClose && (
            <div className="border-t border-line px-5 py-3">
              {confirming === y.year ? (
                <div className="space-y-2">
                  <p className="text-sm text-ink-800">Close {y.year}? Every month of {y.year} will be locked and {y.netResult >= 0 ? "a profit" : "a loss"} of AED {formatMoney(Math.abs(y.netResult))} moves to retained earnings.</p>
                  <div className="flex gap-2">
                    <Button disabled={busy === y.year} onClick={() => void run(y.year, () => closeFinYear(y.year), `${y.year} is closed.`)}>Yes, close {y.year}</Button>
                    <Button variant="secondary" onClick={() => setConfirming(null)}>Not now</Button>
                  </div>
                </div>
              ) : (
                <Button icon={Lock} onClick={() => setConfirming(y.year)}>Close {y.year}</Button>
              )}
            </div>
          )}
          {y.canReopen && canReopen && (
            <div className="border-t border-line px-5 py-3">
              {reopening === y.year ? (
                <div className="space-y-2">
                  <TextField label="Reason for reopening" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
                  <div className="flex gap-2">
                    <Button disabled={busy === y.year || reason.trim() === ""} onClick={() => void run(y.year, () => reopenFinYear(y.year, reason.trim()), `${y.year} is reopened. Its months are still locked; unlock the month you need to change.`)}>Reopen {y.year}</Button>
                    <Button variant="secondary" onClick={() => { setReopening(null); setReason(""); }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button variant="secondary" icon={LockOpen} onClick={() => setReopening(y.year)}>Reopen {y.year}</Button>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
