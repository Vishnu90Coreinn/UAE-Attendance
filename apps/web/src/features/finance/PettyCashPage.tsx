import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, HandCoins, Plus } from "lucide-react";
import { listFinAccounts, listFinEntries, type FinAccount, type FinEntry } from "../../api/finance";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { Button, Card, EmptyState, LoadingState, PageHeader, StatusBadge, cx } from "../../ui";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { AccountDialog } from "./AccountDialog";
import { TransferDialog } from "./TransferDialog";
import { formatMoney, quietZero } from "./financeFormat";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; accounts: FinAccount[]; waiting: FinEntry[] };

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/** Cash given to staff to spend for the company: what each person holds, what they have submitted that waits for approval, and giving or taking back cash. */
export function PettyCashPage() {
  const { user } = useAuth();
  const canEdit = isManagement(user?.role);
  const desktop = useIsDesktop();
  const variant = desktop ? "center" : "sheet";
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<{ fromId?: number; toId?: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [accounts, list] = await Promise.all([listFinAccounts(), listFinEntries("Expense", {})]);
      setLoad({ status: "ready", accounts, waiting: list.items.filter((e) => e.status === "Pending") });
    } catch (error) {
      setLoad({ status: "error", message: failure(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ready = load.status === "ready" ? load : null;
  const holders = useMemo(() => ready?.accounts.filter((a) => a.kind === "Custody" && a.isActive) ?? [], [ready]);
  const funding = useMemo(() => ready?.accounts.filter((a) => a.kind !== "Custody" && a.isActive) ?? [], [ready]);
  const total = holders.reduce((sum, a) => sum + a.balance, 0);

  return (
    <section className="space-y-5">
      <PageHeader
        title="Petty Cash"
        description="Cash you give to staff to spend for the company. Giving cash is a transfer, so it is not an expense. Their approved expenses are what they have spent, and what is left they still hold."
        actions={canEdit && ready && <Button icon={Plus} onClick={() => setAdding(true)}>Add petty-cash account</Button>}
      />
      <SuccessRegion message={message} />
      {problem && <ActionFailure message={problem} />}
      {load.status === "loading" && <LoadingState label="Loading petty cash..." withCards />}
      {load.status === "error" && <LoadError message={load.message} onRetry={() => { setLoad({ status: "loading" }); void refresh(); }} />}

      {ready && holders.length === 0 && (
        <Card>
          <EmptyState
            icon={HandCoins}
            title="No petty cash given out"
            description={canEdit ? "Add a petty-cash account for each person who holds cash. Then give them cash with a transfer, and let them enter what they spend." : "A Manager sets up petty cash. It will appear here."}
            action={canEdit ? <Button icon={Plus} onClick={() => setAdding(true)}>Add petty-cash account</Button> : undefined}
          />
        </Card>
      )}

      {ready && holders.length > 0 && (
        <>
          <p className="text-sm text-ink-600">Staff hold <span className="font-display text-base font-bold tabular-nums text-ink-900">AED {formatMoney(total)}</span> in total. It is still the company's money and is part of the total on the Accounts page.</p>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {holders.map((a) => {
              const waiting = ready.waiting.filter((e) => e.accountId === a.id);
              const waitingTotal = waiting.reduce((sum, e) => sum + e.amount, 0);
              return (
                <li key={a.id}>
                  <article aria-label={a.name} className="flex h-full flex-col rounded-card border border-line bg-white p-5 shadow-card">
                    <header className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="break-words font-display text-lg font-bold leading-snug text-ink-900">{a.holderName ?? a.name}</h3>
                        <p className="text-xs text-ink-500">{a.name}</p>
                      </div>
                      {a.balance < 0 && <StatusBadge tone="danger">Overspent</StatusBadge>}
                    </header>
                    <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-500">Holds now</p>
                    <p className={cx("font-display text-3xl font-bold tracking-tight tabular-nums", a.balance < 0 ? "text-danger" : "text-ink-900", quietZero(a.balance))}>
                      <span className="mr-1 text-sm font-medium text-ink-500">AED</span>
                      {formatMoney(a.balance)}
                    </p>
                    <p className="mt-2 text-[13px] text-ink-600">
                      {waiting.length === 0 ? "Nothing waiting for approval." : `${waiting.length === 1 ? "1 expense" : `${waiting.length} expenses`} waiting for approval (AED ${formatMoney(waitingTotal)}). Not yet taken from what they hold.`}
                    </p>
                    {canEdit && (
                      <div className="mt-auto flex flex-wrap gap-2 pt-4">
                        <Button size="sm" icon={ArrowDownToLine} disabled={funding.length === 0} onClick={() => setMoving({ toId: a.id })}>Give cash</Button>
                        <Button size="sm" variant="secondary" icon={ArrowUpFromLine} disabled={a.balance <= 0} onClick={() => setMoving({ fromId: a.id })}>Take back</Button>
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {ready && adding && (
        <AccountDialog
          account={null}
          defaultKind="Custody"
          variant={variant}
          onClose={() => setAdding(false)}
          onSaved={(_saved, text) => {
            setAdding(false);
            setProblem(null);
            setMessage(text);
            void refresh();
          }}
        />
      )}
      {ready && moving && (
        <TransferDialog
          accounts={ready.accounts.filter((a) => a.isActive)}
          fromId={moving.fromId}
          toId={moving.toId}
          variant={variant}
          onClose={() => setMoving(null)}
          onSaved={(t) => {
            setMoving(null);
            setProblem(null);
            setMessage(`${t.transferNo}: AED ${formatMoney(t.amount)} moved from ${t.fromAccountName} to ${t.toAccountName}.`);
            void refresh();
          }}
        />
      )}
    </section>
  );
}
