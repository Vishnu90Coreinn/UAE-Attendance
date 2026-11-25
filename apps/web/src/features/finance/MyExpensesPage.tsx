import { useCallback, useEffect, useState } from "react";
import { Plus, ReceiptText } from "lucide-react";
import { getFinMyOptions, listMyFinExpenses, type FinEntry, type FinEntryList, type FinMyOptions } from "../../api/finance";
import { ApiError } from "../../api/client";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { Button, Card, EmptyState, LoadingState, PageHeader, StatusBadge, cx } from "../../ui";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { EntryDialog } from "./EntryDialog";
import { ReceiptDialog } from "./ReceiptDialog";
import { formatDay, formatMoney } from "./financeFormat";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; list: FinEntryList; options: FinMyOptions };

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function Row({ entry, onReceipt }: { entry: FinEntry; onReceipt: () => void }) {
  const rejected = entry.status === "Voided";
  return (
    <li className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-5 py-4 sm:flex sm:flex-wrap sm:items-center">
      <div className="min-w-0 sm:flex-1 sm:basis-56">
        <p className={cx("break-words text-[15px] font-semibold", rejected ? "text-ink-500 line-through" : "text-ink-900")}>{entry.party}</p>
        <p className="text-xs text-ink-500"><span className="tabular-nums">{formatDay(entry.entryDate)}</span> · <span className="font-mono">{entry.entryNo}</span> · {entry.categoryName} · {entry.accountName}</p>
        {rejected && entry.voidReason && <p className="mt-1 text-[13px] text-red-700">{entry.voidReason}</p>}
      </div>
      <p className="text-right sm:order-last sm:w-40">
        <span className="mr-1 text-xs font-medium text-ink-500">AED</span>
        <span className={cx("font-display text-xl font-bold tabular-nums", rejected ? "text-ink-500 line-through" : "text-ink-900")}>{formatMoney(entry.amount)}</span>
      </p>
      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1">
        {entry.status === "Pending" && <StatusBadge tone="warning" variant="soft">Waiting for approval</StatusBadge>}
        {entry.status === "Active" && <StatusBadge tone="success" variant="soft">Approved</StatusBadge>}
        {rejected && <StatusBadge tone="danger" variant="soft">Rejected</StatusBadge>}
        {entry.attachments.length > 0 && <Button size="sm" variant="ghost" className="text-brand-700" onClick={onReceipt}>Receipt</Button>}
      </div>
    </li>
  );
}

/** For office staff a Manager has allowed: submit an expense with its receipt, and see whether it was approved. They see only their own and no balances. */
export function MyExpensesPage() {
  const desktop = useIsDesktop();
  const variant = desktop ? "center" : "sheet";
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<FinEntry | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, options] = await Promise.all([listMyFinExpenses(), getFinMyOptions()]);
      setLoad({ status: "ready", list, options });
    } catch (error) {
      setLoad({ status: "error", message: failure(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ready = load.status === "ready" ? load : null;
  const canAdd = (ready?.options.accounts.length ?? 0) > 0;

  return (
    <section className="space-y-5">
      <PageHeader
        title="My Expenses"
        description="Expenses you paid for the company. Attach the receipt; a Manager approves it before it counts."
        actions={ready && <Button icon={Plus} disabled={!canAdd} onClick={() => setAdding(true)}>Add expense</Button>}
      />
      <SuccessRegion message={message} />
      {load.status === "loading" && <LoadingState label="Loading your expenses..." withCards />}
      {load.status === "error" && <LoadError message={load.message} onRetry={() => { setLoad({ status: "loading" }); void refresh(); }} />}
      {ready && !canAdd && <ActionFailure message="No account has been set up for you to pay from yet. Ask a Manager." />}
      {ready && ready.options.accounts.some((a) => a.kind === "Custody") && (
        <Card>
          <div className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Cash you hold</p>
            <p className="font-display text-2xl font-bold tabular-nums text-ink-900">
              <span className="mr-1 text-sm font-medium text-ink-500">AED</span>
              {formatMoney(ready.options.accounts.filter((a) => a.kind === "Custody").reduce((sum, a) => sum + a.balance, 0))}
            </p>
            <p className="text-xs text-ink-500">Petty cash given to you. Each expense you submit from it is taken off once a Manager approves it.</p>
          </div>
        </Card>
      )}
      {ready && (
        <Card>
          {ready.list.items.length === 0 ? (
            <EmptyState icon={ReceiptText} title="No expenses yet" description="Add one when you pay for something for the company." action={canAdd ? <Button icon={Plus} onClick={() => setAdding(true)}>Add expense</Button> : undefined} />
          ) : (
            <ul className="divide-y divide-line">
              {ready.list.items.map((e) => (
                <Row key={e.id} entry={e} onReceipt={() => setViewing(e)} />
              ))}
            </ul>
          )}
        </Card>
      )}
      {adding && ready && (
        <EntryDialog
          kind="Expense"
          accounts={ready.options.accounts}
          categories={ready.options.categories}
          variant={variant}
          submit={{ payees: ready.options.payees }}
          onClose={() => setAdding(false)}
          onSaved={(entry) => {
            setAdding(false);
            setMessage(`${entry.entryNo}: AED ${formatMoney(entry.amount)} to ${entry.party} was sent for approval.`);
            void refresh();
          }}
        />
      )}
      {viewing && <ReceiptDialog title={`Receipt · ${viewing.party}`} files={viewing.attachments} variant={variant} onClose={() => setViewing(null)} mine />}
    </section>
  );
}
