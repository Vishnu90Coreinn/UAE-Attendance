import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, ArrowRight, Landmark, Plus, Power } from "lucide-react";
import { listFinAccounts, listFinCheques, listFinTransfers, setFinAccountActive, voidFinTransfer, type FinAccount, type FinCheque, type FinTransfer } from "../../api/finance";
import { ApiError } from "../../api/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { Button, Card, CardHeader, EmptyState, LoadingState, PageHeader, StatusBadge, cx } from "../../ui";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { AccountCard } from "./AccountCard";
import { AccountDialog } from "./AccountDialog";
import { TransferDialog } from "./TransferDialog";
import { VoidDialog } from "./VoidDialog";
import { formatDay, formatMoney, formatShare, splitShares, sumMoney } from "./financeFormat";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; accounts: FinAccount[]; transfers: FinTransfer[]; cheques: FinCheque[] };

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/** Total balance on a deep panel, split into what is in banks and what is in cash. */
function TotalPanel({ accounts }: { accounts: FinAccount[] }) {
  const active = accounts.filter((a) => a.isActive);
  const total = sumMoney(active.map((a) => a.balance));
  const bank = sumMoney(active.filter((a) => a.kind === "Bank").map((a) => a.balance));
  const cash = sumMoney(active.filter((a) => a.kind !== "Bank").map((a) => a.balance));
  // Shares are of money held: an overdrawn account holds none.
  const holders = active.filter((a) => a.balance > 0);
  const percents = splitShares(holders.map((a) => a.balance), 1);
  const held = (isBank: boolean) => sumMoney(holders.filter((a) => (a.kind === "Bank") === isBank).map((a) => a.balance));
  const [bankShare, cashShare] = splitShares([held(true), held(false)], 1);
  const groups = [
    { name: "Banks", share: bankShare, color: "bg-amber-300" },
    { name: "Cash & petty cash", share: cashShare, color: "bg-teal-400" },
  ];

  return (
    <section aria-labelledby="total-balance" className="fade-up overflow-hidden rounded-card bg-sidebar text-white shadow-card">
      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:p-7">
        <div>
          <p id="total-balance" className="flex items-center gap-2 text-sm font-medium text-white/75">
            <Landmark aria-hidden="true" size={16} />
            Total balance
          </p>
          <p className={cx("mt-2 flex flex-wrap items-baseline gap-x-2 tabular-nums", total < 0 && "text-red-200")}>
            <span className="text-lg font-medium text-white/70">AED</span>
            <span className="font-display text-4xl font-bold tracking-tight md:text-5xl">{formatMoney(total)}</span>
          </p>
          <p className="mt-3 text-sm text-white/70">
            {active.length === 1 ? "1 account" : `${active.length} accounts`} · worked out from every entry and transfer
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-white/60">In banks</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">AED {formatMoney(bank)}</dd>
            </div>
            <div>
              <dt className="text-white/60">In cash</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">AED {formatMoney(cash)}</dd>
            </div>
          </dl>
        </div>
        <div className="self-end">
          {holders.length > 0 ? (
            <>
              <p className="text-sm font-medium text-white/75">Where the money sits</p>
              <div role="img" aria-label={`Banks ${formatShare(bankShare)}, cash and petty cash ${formatShare(cashShare)}`} className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full">
                {groups.filter((g) => g.share > 0).map((g) => (
                  <span key={g.name} style={{ width: `${Math.max(g.share, 1.5)}%` }} className={cx("block h-full", g.color)} />
                ))}
              </div>
              <ul className="mt-3 grid gap-1.5 text-sm">
                {groups.map((g) => (
                  <li key={g.name} className="flex items-center gap-2">
                    <span aria-hidden="true" className={cx("size-2.5 shrink-0 rounded-sm", g.color)} />
                    <span className="min-w-0 flex-1">{g.name}</span>
                    <span className="font-semibold tabular-nums">{formatShare(g.share)}</span>
                  </li>
                ))}
              </ul>
              <details className="mt-1 text-sm">
                <summary className="flex min-h-11 w-fit cursor-pointer items-center font-medium text-white/80 hover:text-white">Per account</summary>
                <ul className="grid gap-1.5">
                  {holders.map((a, index) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <span aria-hidden="true" className={cx("size-2.5 shrink-0 rounded-sm", a.kind === "Bank" ? "bg-amber-300" : "bg-teal-400")} />
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      <span className="font-semibold tabular-nums">{formatShare(percents[index])}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <p className="text-sm text-white/70">No money is held yet. Balances appear here as soon as an account has an opening balance or entries.</p>
          )}
        </div>
      </div>
    </section>
  );
}

const TRANSFERS_SHOWN = 8;

function RecentTransfers({ transfers, canEdit, onVoid }: { transfers: FinTransfer[]; canEdit: boolean; onVoid: (t: FinTransfer) => void }) {
  const [all, setAll] = useState(false);
  const rows = all ? transfers : transfers.slice(0, TRANSFERS_SHOWN);
  return (
    <Card>
      <CardHeader title={all ? "All transfers" : "Recent transfers"} description="Money moved between the company's own accounts. Not counted as an expense or income." />
      {transfers.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="No transfers yet" description="When money moves between two accounts it is listed here." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((t) => {
            const voided = t.status !== "Active";
            return (
              <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 md:grid-cols-[7rem_8rem_minmax(0,1fr)_11rem_5.5rem]">
                <p className="text-[13px] font-medium tabular-nums text-ink-700">{formatDay(t.transferDate)}</p>
                <p className="font-mono text-[13px] tabular-nums text-ink-500 max-md:text-right">{t.transferNo}</p>
                <p className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-800 md:col-span-1">
                  <span className="text-[15px] font-semibold">{t.fromAccountName}</span>
                  <ArrowRight aria-label="to" size={14} className="shrink-0 text-ink-500" />
                  <span className="text-[15px] font-semibold">{t.toAccountName}</span>
                  {(t.reference || t.notes) && <span className="w-full text-[13px] text-ink-500">{[t.reference, t.notes].filter(Boolean).join(" · ")}</span>}
                </p>
                <p className="tabular-nums md:text-right">
                  <span className="mr-1 text-xs font-medium text-ink-500">AED</span>
                  <span className={cx("font-display text-lg font-bold", voided ? "text-ink-500 line-through" : "text-ink-900")}>{formatMoney(t.amount)}</span>
                </p>
                <div className="flex justify-end">
                  {voided ? (
                    <StatusBadge tone="neutral" variant="soft">Voided</StatusBadge>
                  ) : canEdit ? (
                    <Button variant="ghost" className="text-ink-600" onClick={() => onVoid(t)} aria-label={`Void transfer ${t.transferNo}`}>Void</Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {transfers.length > TRANSFERS_SHOWN && (
        <div className="border-t border-line px-5 py-1">
          <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
            {all ? "Show recent transfers only" : `View all transfers (${transfers.length})`}
          </button>
        </div>
      )}
    </Card>
  );
}

/** Bank and cash accounts with live balances, the total, transfers between them, and who may change any of it. */
export function AccountsPage() {
  const { user } = useAuth();
  const canEdit = isManagement(user?.role);
  const desktop = useIsDesktop();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [showOff, setShowOff] = useState(false);
  const [editing, setEditing] = useState<FinAccount | "new" | null>(null);
  const [transferFrom, setTransferFrom] = useState<number | "any" | null>(null);
  const [switching, setSwitching] = useState<FinAccount | null>(null);
  const [voidingTransfer, setVoidingTransfer] = useState<FinTransfer | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // The cheques only say how many are pending: if they cannot be read the accounts still show.
      const [accounts, transfers, cheques] = await Promise.all([
        listFinAccounts(),
        listFinTransfers(true),
        Promise.resolve(listFinCheques({ openOnly: true })).then((list) => list?.items ?? []).catch(() => [] as FinCheque[]),
      ]);
      setLoad({ status: "ready", accounts, transfers, cheques });
    } catch (error) {
      setLoad({ status: "error", message: failure(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ready = load.status === "ready" ? load : null;
  const active = useMemo(() => ready?.accounts.filter((a) => a.isActive) ?? [], [ready]);
  const off = useMemo(() => ready?.accounts.filter((a) => !a.isActive) ?? [], [ready]);
  const variant = desktop ? "center" : "sheet";

  async function confirmSwitch() {
    if (!switching) return;
    setPending(true);
    setProblem(null);
    try {
      await setFinAccountActive(switching.id, !switching.isActive);
      setMessage(`${switching.name} was ${switching.isActive ? "deactivated" : "reactivated"}.`);
      setSwitching(null);
      await refresh();
    } catch (error) {
      setProblem(failure(error));
      setSwitching(null);
    } finally {
      setPending(false);
    }
  }

  const shownAccounts = showOff ? [...active, ...off] : active;
  const sections = [
    { title: "Bank accounts", accounts: shownAccounts.filter((a) => a.kind === "Bank") },
    { title: "Cash & petty cash", accounts: shownAccounts.filter((a) => a.kind !== "Bank") },
  ].filter((group) => group.accounts.length > 0);
  // Cheques tied to an entry are the ones that make the bank differ from the books.
  const pendingCheques = (id: number) => ready?.cheques.filter((c) => c.accountId === id && c.entryId != null).length ?? 0;
  const quiet = (a: FinAccount) => a.entryCount === 0 && !(ready?.transfers.some((t) => t.status === "Active" && (t.fromAccountId === a.id || t.toAccountId === a.id)) ?? false);

  return (
    <section className="space-y-5">
      <PageHeader
        title="Accounts"
        description="Bank and cash balances, calculated from opening balances, entries and transfers."
        actions={
          canEdit && ready && (
            <>
              {active.length > 1 && (
                <Button variant="secondary" icon={ArrowLeftRight} onClick={() => setTransferFrom("any")}>
                  Transfer
                </Button>
              )}
              <Button icon={Plus} onClick={() => setEditing("new")}>
                Add account
              </Button>
            </>
          )
        }
      />
      <SuccessRegion message={message} />
      {problem && <ActionFailure message={problem} />}

      {load.status === "loading" && <LoadingState label="Loading accounts..." withCards />}
      {load.status === "error" && <LoadError message={load.message} onRetry={() => { setLoad({ status: "loading" }); void refresh(); }} />}

      {ready && ready.accounts.length === 0 && (
        <Card>
          <EmptyState
            icon={Landmark}
            title="No accounts yet"
            description={canEdit ? "Add the company's bank and cash accounts, each with its opening balance, to start tracking expenses and income." : "A Manager adds the company's accounts. They will appear here."}
            action={canEdit ? <Button icon={Plus} onClick={() => setEditing("new")}>Add the first account</Button> : undefined}
          />
        </Card>
      )}

      {ready && ready.accounts.length > 0 && (
        <>
          <TotalPanel accounts={ready.accounts} />
          {off.length > 0 && (
            <label className="flex h-11 w-fit cursor-pointer items-center gap-2 text-sm font-medium text-ink-700">
              <input type="checkbox" className="size-5" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
              Show inactive ({off.length})
            </label>
          )}
          {sections.map((group) => (
            <div key={group.title} style={{ "--i": 1 } as React.CSSProperties} className="fade-up">
              <h3 className="mb-3 font-display text-base font-semibold text-ink-900">{group.title}</h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.accounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    quiet={quiet(account)}
                    chequeCount={pendingCheques(account.id)}
                    canEdit={canEdit}
                    onEdit={() => setEditing(account)}
                    onTransfer={() => setTransferFrom(account.id)}
                    onSwitch={() => setSwitching(account)}
                  />
                ))}
              </div>
            </div>
          ))}
          <RecentTransfers transfers={ready.transfers} canEdit={canEdit} onVoid={setVoidingTransfer} />
        </>
      )}

      {editing && (
        <AccountDialog
          account={editing === "new" ? null : editing}
          variant={variant}
          onClose={() => setEditing(null)}
          onSaved={(_saved, text) => {
            setEditing(null);
            setMessage(text);
            setProblem(null);
            void refresh();
          }}
        />
      )}
      {transferFrom !== null && ready && (
        <TransferDialog
          accounts={active}
          fromId={transferFrom === "any" ? undefined : transferFrom}
          variant={variant}
          onClose={() => setTransferFrom(null)}
          onSaved={(t) => {
            setTransferFrom(null);
            setMessage(`${t.transferNo}: AED ${formatMoney(t.amount)} moved from ${t.fromAccountName} to ${t.toAccountName}.`);
            setProblem(null);
            void refresh();
          }}
        />
      )}
      {voidingTransfer && (
        <VoidDialog
          title={`Void ${voidingTransfer.transferNo}?`}
          message={`AED ${formatMoney(voidingTransfer.amount)} moved from ${voidingTransfer.fromAccountName} to ${voidingTransfer.toAccountName} will be reversed in both balances. This can't be undone. The record stays, with who voided it and why.`}
          minReason={3}
          confirmLabel="Void"
          variant={variant}
          onClose={() => setVoidingTransfer(null)}
          onConfirm={async (reason) => {
            await voidFinTransfer(voidingTransfer.id, reason);
            setMessage(`${voidingTransfer.transferNo} was voided.`);
            setVoidingTransfer(null);
            await refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={switching !== null}
        title={switching?.isActive ? "Deactivate this account?" : "Reactivate this account?"}
        message={
          switching?.isActive
            ? `${switching.name} will no longer be offered for new entries. Its past entries and balance history stay. An account can only be deactivated when it holds AED 0.00.`
            : `${switching?.name ?? "This account"} will be offered for new entries again.`
        }
        confirmLabel={switching?.isActive ? "Deactivate account" : "Reactivate account"}
        confirmIcon={Power}
        pending={pending}
        onConfirm={() => void confirmSwitch()}
        onCancel={() => setSwitching(null)}
      />
    </section>
  );
}
