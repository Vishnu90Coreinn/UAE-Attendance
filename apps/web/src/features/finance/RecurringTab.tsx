import { useCallback, useEffect, useState } from "react";
import { Play, Plus, Repeat } from "lucide-react";
import { ApiError } from "../../api/client";
import { listRecurringJournals, postDueRecurringJournals, stopRecurringJournal, type LedgerAccount, type RecurringJournal } from "../../api/finance";
import { Button, Card, CardHeader, EmptyState } from "../../ui";
import { formatMoney } from "./financeFormat";
import { ManualJournalDialog } from "./ManualJournalDialog";

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function monthWords(key: string): string {
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Journals the accountant wants every month: prepaid rent or insurance spread over its term, depreciation, a regular accrual. Nothing posts in the background.
 * "Post due months" posts every month that has come due as an ordinary journal; a locked month is left and reported.
 */
export function RecurringTab({ accounts, canEdit, variant, onChanged }: { accounts: LedgerAccount[]; canEdit: boolean; variant: "center" | "sheet"; onChanged: () => void }) {
  const [items, setItems] = useState<RecurringJournal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listRecurringJournals());
    } catch (e) {
      setError(failure(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const due = (items ?? []).reduce((sum, r) => sum + r.due, 0);

  async function postDue() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await postDueRecurringJournals();
      setNotice(result.posted === 0 ? "Nothing was due." : `${result.posted} journal${result.posted === 1 ? "" : "s"} posted.`);
      setSkipped(result.skipped.map((s) => `${s.description}, ${monthWords(s.month)}: ${s.reason}`));
      await load();
      onChanged();
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop(r: RecurringJournal) {
    setError(null);
    try {
      await stopRecurringJournal(r.id);
      setNotice(`"${r.description}" is stopped. The months already posted stay.`);
      await load();
    } catch (e) {
      setError(failure(e));
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
        A monthly journal is set up once and posts itself each month you run it: prepaid rent or insurance spread over its term, depreciation, a regular accrual. Nothing posts in the background; you press <strong>Post due months</strong>, so a locked month or a mistake is seen, not hidden.
      </p>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">{notice}</p>}
      {skipped.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Left for later:</p>
          <ul className="list-disc pl-5">{skipped.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button icon={Play} disabled={busy || due === 0} onClick={() => void postDue()}>Post due months{due > 0 ? ` (${due})` : ""}</Button>
          <Button variant="secondary" icon={Plus} onClick={() => setCreating(true)}>New monthly journal</Button>
        </div>
      )}
      {!items && !error && <p className="text-sm text-ink-600">Loading...</p>}
      {items?.length === 0 && <Card><EmptyState icon={Repeat} title="No monthly journals yet" description="Set one up for anything that should post every month, such as insurance paid for a year." /></Card>}
      {items?.map((r) => (
        <Card key={r.id}>
          <CardHeader
            title={r.description}
            description={`AED ${formatMoney(r.amount)} on day ${r.dayOfMonth}, from ${monthWords(r.startMonth)}${r.endMonth ? ` to ${monthWords(r.endMonth)}` : " until stopped"}`}
            actions={<span className="text-sm font-semibold text-ink-600">{r.isActive ? (r.nextMonth ? `Next: ${monthWords(r.nextMonth)}` : "Finished") : "Stopped"}</span>}
          />
          <ul className="divide-y divide-line border-t border-line text-sm">
            {r.lines.map((l, i) => (
              <li key={i} className="flex items-baseline gap-3 px-5 py-2">
                <span className="w-14 font-mono text-xs text-ink-500">{l.accountCode}</span>
                <span className="min-w-0 flex-1 break-words text-ink-900">{l.accountName}</span>
                <span className="w-24 text-right tabular-nums">{l.debit > 0 ? formatMoney(l.debit) : ""}</span>
                <span className="w-24 text-right tabular-nums">{l.credit > 0 ? formatMoney(l.credit) : ""}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3 text-sm text-ink-700">
            <span>{r.posted} month{r.posted === 1 ? "" : "s"} posted</span>
            {r.due > 0 && <span className="font-medium text-brand-700">{r.due} due now</span>}
            {canEdit && r.isActive && <Button size="sm" variant="ghost" className="ml-auto text-red-700 hover:bg-red-50" onClick={() => void stop(r)} aria-label={`Stop ${r.description}`}>Stop</Button>}
          </div>
        </Card>
      ))}
      {creating && <ManualJournalDialog recurring accounts={accounts} variant={variant} onClose={() => setCreating(false)} onPosted={(label) => { setCreating(false); setNotice(`"${label}" is set up. Press Post due months to post any month that has already come due.`); void load(); }} />}
    </div>
  );
}
