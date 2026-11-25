import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, ArrowRight, Ban, Landmark, Plus, Power, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { listFinAccounts, listFinTransfers, setFinAccountActive, voidFinTransfer, type FinAccount, type FinTransfer } from "../../api/finance";
import { ApiError } from "../../api/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { Button, Card, CardHeader, EmptyState, LoadingState, PageHeader, StatusBadge, cx } from "../../ui";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { AccountDialog } from "./AccountDialog";
import { TransferDialog } from "./TransferDialog";
import { VoidDialog } from "./VoidDialog";
import { formatDay, formatMoney, sharePercent, sumMoney } from "./financeFormat";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; accounts: FinAccount[]; transfers: FinTransfer[] };

/** Segment colours for the composition bar. The legend names every segment, so colour is never the only cue. */
const SEGMENTS = ["bg-brand-200", "bg-brand-400", "bg-amber-300", "bg-sky-300", "bg-ink-300"];

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/** Total balance on a deep panel, with how it is split across the accounts. */
function TotalPanel({ accounts }: { accounts: FinAccount[] }) {
  const active = accounts.filter((a) => a.isActive);
  const total = sumMoney(active.map((a) => a.balance));
  const positive = sumMoney(active.filter((a) => a.balance > 0).map((a) => a.balance));
  const bank = sumMoney(active.filter((a) => a.kind === "Bank").map((a) => a.balance));
  const cash = sumMoney(active.filter((a) => a.kind === "Cash").map((a) => a.balance));
  const split = active.filter((a) => a.balance > 0).map((a, index) => ({ account: a, percent: sharePercent(a.balance, positive), color: SEGMENTS[index % SEGMENTS.length] }));

  return (
    <section aria-labelledby="total-balance" className="overflow-hidden rounded-card bg-sidebar text-white shadow-card">
      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:p-7">
        <div>
          <p id="total-balance" className="flex items-center gap-2 text-sm font-medium text-white/75">
            <Landmark aria-hidden="true" size={16} />
            Total balance
          </p>
          <p className={cx("mt-2 flex flex-wrap items-baseline gap-x-2 tabular-nums", total < 0 && "text-red-200")}>
            <span className="text-lg font-medium text-white/70">AED</span>
            <span className="text-4xl font-semibold tracking-tight md:text-5xl">{formatMoney(total)}</span>
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
          {split.length > 0 ? (
            <>
              <p className="text-sm font-medium text-white/75">Where the money sits</p>
              <div
                role="img"
                aria-label={`Share of the total by account: ${split.map((s) => `${s.account.name} ${s.percent}%`).join(", ")}`}
                className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full"
              >
                {split.map((s) => (
                  <span key={s.account.id} style={{ width: `${Math.max(s.percent, 2)}%` }} className={cx("block h-full", s.color)} />
                ))}
              </div>
              <ul className="mt-3 grid gap-1.5 text-sm">
                {split.map((s) => (
                  <li key={s.account.id} className="flex items-center gap-2">
                    <span aria-hidden="true" className={cx("size-2.5 shrink-0 rounded-sm", s.color)} />
                    <span className="min-w-0 flex-1 truncate">{s.account.name}</span>
                    <span className="font-semibold tabular-nums">{s.percent}%</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-white/70">No money is held yet. Balances appear here as soon as an account has an opening balance or entries.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function AccountCard({ account, share, canEdit, onEdit, onTransfer, onSwitch }: {
  account: FinAccount;
  share: number;
  canEdit: boolean;
  onEdit: () => void;
  onTransfer: () => void;
  onSwitch: () => void;
}) {
  const Icon = account.kind === "Cash" ? Wallet : Landmark;
  const overdrawn = account.balance < 0;
  return (
    <article aria-label={account.name} className={cx("flex flex-col rounded-card border border-line bg-white p-5 shadow-card", !account.isActive && "bg-ink-50")}>
      <header className="flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-semibold leading-snug text-ink-900">{account.name}</h3>
          <p className="mt-0.5 text-sm text-ink-600">{[account.kind === "Cash" ? "Cash" : "Bank account", account.bankName].filter(Boolean).join(" · ")}</p>
        </div>
        {!account.isActive && <StatusBadge tone="neutral" variant="soft">Switched off</StatusBadge>}
        {overdrawn && account.isActive && <StatusBadge tone="danger">Overdrawn</StatusBadge>}
      </header>

      <p className={cx("mt-5 flex items-baseline gap-2 tabular-nums", overdrawn ? "text-danger" : "text-ink-900")}>
        <span className="text-sm font-medium text-ink-500">AED</span>
        <span className="text-3xl font-semibold tracking-tight">{formatMoney(account.balance)}</span>
      </p>
      {account.isActive && share > 0 && (
        <div className="mt-3" aria-hidden="true">
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${share}%` }} />
          </div>
        </div>
      )}
      {account.isActive && share > 0 && <p className="mt-1 text-xs text-ink-600">{share}% of the total</p>}

      <dl className="mb-4 mt-4 grid gap-1.5 border-t border-line pt-4 text-sm">
        {account.accountNumber && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-600">Account no.</dt>
            <dd className="font-mono text-ink-900">{account.accountNumber}</dd>
          </div>
        )}
        {account.iban && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-600">IBAN</dt>
            <dd className="break-all text-right font-mono text-ink-900">{account.iban}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-ink-600">Opening</dt>
          <dd className="tabular-nums text-ink-900">
            AED {formatMoney(account.openingBalance)} <span className="text-ink-500">on {formatDay(account.openingDate)}</span>
          </dd>
        </div>
      </dl>

      <p className="mt-auto flex flex-wrap gap-x-4 text-sm font-medium text-brand-700">
        <Link to={`/finance/expenses?account=${account.id}&period=all`} className="inline-flex min-h-11 items-center gap-1 hover:underline md:min-h-9" aria-label={`Expenses paid from ${account.name}`}>
          Expenses <ArrowRight aria-hidden="true" size={14} />
        </Link>
        <Link to={`/finance/income?account=${account.id}&period=all`} className="inline-flex min-h-11 items-center gap-1 hover:underline md:min-h-9" aria-label={`Income received into ${account.name}`}>
          Income <ArrowRight aria-hidden="true" size={14} />
        </Link>
      </p>

      {canEdit && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {account.isActive && (
            <Button size="sm" variant="secondary" icon={ArrowLeftRight} onClick={onTransfer} aria-label={`Transfer from ${account.name}`}>
              Transfer
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${account.name}`}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" icon={Power} onClick={onSwitch} aria-label={`${account.isActive ? "Switch off" : "Switch on"} ${account.name}`}>
            {account.isActive ? "Switch off" : "Switch on"}
          </Button>
        </div>
      )}
    </article>
  );
}

function RecentTransfers({ transfers, canEdit, onVoid }: { transfers: FinTransfer[]; canEdit: boolean; onVoid: (t: FinTransfer) => void }) {
  const recent = transfers.filter((t) => t.status === "Active").slice(0, 8);
  return (
    <Card>
      <CardHeader title="Recent transfers" description="Money moved between the company's own accounts. Not counted as an expense or income." />
      {recent.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="No transfers yet" description="When money moves between two accounts it is listed here." />
      ) : (
        <ul className="divide-y divide-line">
          {recent.map((t) => (
            <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 px-5 py-3.5 sm:flex sm:items-center">
              <div className="sm:w-28 sm:shrink-0">
                <p className="text-sm font-medium tabular-nums text-ink-900">{formatDay(t.transferDate)}</p>
                <p className="font-mono text-xs text-ink-500">{t.transferNo}</p>
              </div>
              <p className="text-right text-base font-semibold tabular-nums text-ink-900 sm:order-last">
                <span className="mr-1 text-xs font-medium text-ink-500">AED</span>
                {formatMoney(t.amount)}
              </p>
              {canEdit && (
                <p className="sm:order-last">
                  <Button size="sm" variant="ghost" icon={Ban} onClick={() => onVoid(t)} aria-label={`Void ${t.transferNo}`}>Void</Button>
                </p>
              )}
              <p className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-800 sm:flex-1">
                <span className="font-medium">{t.fromAccountName}</span>
                <ArrowRight aria-label="to" size={14} className="shrink-0 text-ink-500" />
                <span className="font-medium">{t.toAccountName}</span>
                {(t.reference || t.notes) && <span className="w-full text-ink-600">{[t.reference, t.notes].filter(Boolean).join(" · ")}</span>}
              </p>
            </li>
          ))}
        </ul>
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
      const [accounts, transfers] = await Promise.all([listFinAccounts(), listFinTransfers()]);
      setLoad({ status: "ready", accounts, transfers });
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
  const positive = sumMoney(active.filter((a) => a.balance > 0).map((a) => a.balance));
  const variant = desktop ? "center" : "sheet";

  async function confirmSwitch() {
    if (!switching) return;
    setPending(true);
    setProblem(null);
    try {
      await setFinAccountActive(switching.id, !switching.isActive);
      setMessage(`${switching.name} was ${switching.isActive ? "switched off" : "switched on"}.`);
      setSwitching(null);
      await refresh();
    } catch (error) {
      setProblem(failure(error));
      setSwitching(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Accounts"
        description="The company's bank and cash accounts. Balances are worked out from the opening balance, every entry and every transfer."
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
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {active.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                share={sharePercent(account.balance, positive)}
                canEdit={canEdit}
                onEdit={() => setEditing(account)}
                onTransfer={() => setTransferFrom(account.id)}
                onSwitch={() => setSwitching(account)}
              />
            ))}
          </div>
          {off.length > 0 && (
            <div>
              <Button variant="ghost" onClick={() => setShowOff((v) => !v)} aria-expanded={showOff}>
                {showOff ? "Hide" : "Show"} switched-off accounts ({off.length})
              </Button>
              {showOff && (
                <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {off.map((account) => (
                    <AccountCard key={account.id} account={account} share={0} canEdit={canEdit} onEdit={() => setEditing(account)} onTransfer={() => {}} onSwitch={() => setSwitching(account)} />
                  ))}
                </div>
              )}
            </div>
          )}
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
          message={`AED ${formatMoney(voidingTransfer.amount)} moved from ${voidingTransfer.fromAccountName} to ${voidingTransfer.toAccountName} will be reversed in both balances. The record stays, with who voided it and why.`}
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
        title={switching?.isActive ? "Switch off this account?" : "Switch this account on?"}
        message={
          switching?.isActive
            ? `${switching.name} will no longer be offered for new entries. Its past entries and balance history stay. An account can only be switched off when it holds AED 0.00.`
            : `${switching?.name ?? "This account"} will be offered for new entries again.`
        }
        confirmLabel={switching?.isActive ? "Switch off" : "Switch on"}
        confirmIcon={Power}
        pending={pending}
        onConfirm={() => void confirmSwitch()}
        onCancel={() => setSwitching(null)}
      />
    </section>
  );
}
