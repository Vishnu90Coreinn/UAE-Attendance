import { useCallback, useEffect, useState } from "react";
import { BookOpen, CheckCircle2, XCircle } from "lucide-react";
import {
  getLedgerCheck, getLedgerStatement, getLedgerTrialBalance, listJournals,
  type Journal, type LedgerAccount, type LedgerCheckResult, type LedgerStatement, type LedgerTrialBalance,
} from "../../api/finance";
import { ApiError } from "../../api/client";
import { TextField } from "../../components/TextField";
import { Button, Card, CardHeader, EmptyState, LoadingState, PageHeader, Select, cx } from "../../ui";
import { LoadError } from "../workers/WorkersFeedback";
import { formatDay, formatMoney, quietZero, todayInUae } from "./financeFormat";

type Tab = "trial" | "ledger" | "journals";
type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; trial: LedgerTrialBalance; check: LedgerCheckResult };

const TYPE_ORDER = ["Asset", "Liability", "Equity", "Revenue", "Expense"] as const;
const GROUP_LABEL = { Asset: "Assets", Liability: "Liabilities", Equity: "Equity", Revenue: "Revenue", Expense: "Expenses" } as const;

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/** The ledger agrees with the finance screens, or says exactly where it does not. */
function CheckBanner({ check }: { check: LedgerCheckResult }) {
  const off = check.checks.filter((c) => !c.agrees);
  return (
    <div role="status" className={cx("flex items-start gap-3 rounded-card border px-4 py-3 text-sm", check.allAgree ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-900")}>
      {check.allAgree ? <CheckCircle2 aria-hidden="true" size={18} className="mt-0.5 shrink-0" /> : <XCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0" />}
      <div>
        <p className="font-semibold">{check.allAgree ? "The books agree with the finance screens" : "The books and the finance screens disagree"}</p>
        <p>
          {check.allAgree
            ? `${check.checks.length} checks passed across ${check.journals} journals. Debits and credits are both AED ${formatMoney(check.totalDebit)}.`
            : off.map((c) => `${c.name} (${c.subject}): books ${formatMoney(c.ledger)}, screens ${formatMoney(c.screens)}`).join(" · ")}
        </p>
      </div>
    </div>
  );
}

function TrialBalance({ trial, onOpen }: { trial: LedgerTrialBalance; onOpen: (a: LedgerAccount) => void }) {
  return (
    <Card>
      <CardHeader title="Trial balance" description={`As at ${formatDay(trial.asOf)}. Total debits must equal total credits.`} />
      {trial.accounts.length === 0 ? (
        <EmptyState icon={BookOpen} title="Nothing posted yet" description="Entries, transfers and opening balances post here by themselves." />
      ) : (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">Debit and credit total of every account with activity</caption>
            <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-600">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Code</th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Account</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Debit</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {TYPE_ORDER.flatMap((type) => {
                const rows = trial.accounts.filter((a) => a.type === type);
                if (rows.length === 0) return [];
                return [
                  <tr key={type} className="bg-brand-50/50"><th colSpan={4} scope="colgroup" className="px-4 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-brand-800">{GROUP_LABEL[type]}</th></tr>,
                  ...rows.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{a.code}</td>
                      <td className="px-4 py-2.5"><button type="button" onClick={() => onOpen(a)} className="text-left font-medium text-brand-700 hover:underline">{a.name}</button></td>
                      <td className={cx("px-4 py-2.5 text-right tabular-nums", quietZero(a.debit))}>{formatMoney(a.debit)}</td>
                      <td className={cx("px-4 py-2.5 text-right tabular-nums", quietZero(a.credit))}>{formatMoney(a.credit)}</td>
                    </tr>
                  )),
                ];
              })}
              <tr className="bg-ink-50 font-semibold text-ink-900">
                <td className="px-4 py-2.5" colSpan={2}>Total {trial.balanced ? "" : "(does not balance)"}</td>
                <td className="px-4 py-2.5 text-right font-display tabular-nums">{formatMoney(trial.totalDebit)}</td>
                <td className="px-4 py-2.5 text-right font-display tabular-nums">{formatMoney(trial.totalCredit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function LedgerView({ accounts, accountId, onAccount }: { accounts: LedgerAccount[]; accountId: number | null; onAccount: (id: number | null) => void }) {
  const [from, setFrom] = useState("2000-01-01");
  const [to, setTo] = useState(todayInUae());
  const [statement, setStatement] = useState<LedgerStatement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accountId === null) return;
    let cancelled = false;
    setStatement(null);
    setError(null);
    getLedgerStatement(accountId, from, to)
      .then((s) => !cancelled && setStatement(s))
      .catch((e) => !cancelled && setError(failure(e)));
    return () => {
      cancelled = true;
    };
  }, [accountId, from, to]);

  return (
    <Card>
      <CardHeader title="Ledger" description="Every line that touched one account, with a running balance." />
      <div className="grid gap-3 px-5 pb-4 sm:grid-cols-3">
        <Select label="Account" value={accountId === null ? "" : String(accountId)} onChange={(e) => onAccount(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Choose an account</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </Select>
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} max={todayInUae()} onChange={(e) => setTo(e.target.value)} />
      </div>
      {error && <p role="alert" className="px-5 pb-4 text-sm text-danger">{error}</p>}
      {accountId === null && <p className="border-t border-line px-5 py-6 text-sm text-ink-600">Choose an account, or open one from the trial balance.</p>}
      {statement && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Ledger of {statement.account.name}</caption>
            <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-600">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Date</th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Journal</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Debit</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Credit</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr className="text-ink-600"><td className="px-4 py-2" colSpan={4}>Opening balance on {formatDay(statement.from)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(statement.opening)}</td></tr>
              {statement.lines.map((l, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-700">{formatDay(l.date)}</td>
                  <td className="px-4 py-2.5"><span className="block text-ink-900">{l.description}{l.part === "Reversal" && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">Reversal</span>}</span><span className="font-mono text-xs text-ink-500">{l.journalNumber}</span></td>
                  <td className={cx("px-4 py-2.5 text-right tabular-nums", quietZero(l.debit))}>{formatMoney(l.debit)}</td>
                  <td className={cx("px-4 py-2.5 text-right tabular-nums", quietZero(l.credit))}>{formatMoney(l.credit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-900">{formatMoney(l.balance)}</td>
                </tr>
              ))}
              <tr className="bg-ink-50 font-semibold text-ink-900"><td className="px-4 py-2.5" colSpan={4}>Closing balance on {formatDay(statement.to)}</td><td className="px-4 py-2.5 text-right font-display tabular-nums">{formatMoney(statement.closing)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Journals() {
  const [list, setList] = useState<{ items: Journal[]; count: number; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    listJournals()
      .then((l) => !cancelled && setList(l))
      .catch((e) => !cancelled && setError(failure(e)));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <Card>
      <CardHeader title="Journals" description="Every posting, newest first. A reversal undoes an earlier one; nothing is ever edited or deleted." />
      {error && <p role="alert" className="px-5 pb-4 text-sm text-danger">{error}</p>}
      {!list && !error && <p className="px-5 pb-5 text-sm text-ink-600">Loading...</p>}
      {list && (
        <ul className="divide-y divide-line border-t border-line">
          {list.items.map((j) => (
            <li key={j.id} className="px-5 py-3">
              <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="font-mono text-xs text-ink-500">{j.number}</span>
                <span className="tabular-nums text-ink-700">{formatDay(j.date)}</span>
                <span className="min-w-0 flex-1 break-words font-medium text-ink-900">{j.description}</span>
                {j.part === "Reversal" && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">Reversal</span>}
              </p>
              <table className="mt-1.5 w-full text-[13px]">
                <caption className="sr-only">Lines of {j.number}</caption>
                <tbody>
                  {j.lines.map((l, i) => (
                    <tr key={i} className="text-ink-700">
                      <td className="w-14 font-mono text-xs text-ink-500">{l.accountCode}</td>
                      <td className={cx(l.credit > 0 && "pl-6")}>{l.accountName}{l.memo ? <span className="text-ink-500"> ({l.memo})</span> : null}</td>
                      <td className="w-28 text-right tabular-nums">{l.debit > 0 ? formatMoney(l.debit) : ""}</td>
                      <td className="w-28 text-right tabular-nums">{l.credit > 0 ? formatMoney(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
      {list?.truncated && <p className="border-t border-line px-5 py-3 text-sm text-ink-600">Showing the newest 500 of {list.count}.</p>}
    </Card>
  );
}

/** The books, derived from every finance record: trial balance, ledger per account and journals, with the check that they agree with the finance screens. */
export function BooksPage() {
  const [tab, setTab] = useState<Tab>("trial");
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [accountId, setAccountId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [trial, check] = await Promise.all([getLedgerTrialBalance(), getLedgerCheck()]);
      setLoad({ status: "ready", trial, check });
    } catch (error) {
      setLoad({ status: "error", message: failure(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ready = load.status === "ready" ? load : null;
  return (
    <section className="space-y-5">
      <PageHeader title="Books" description="The double-entry view of the same records: every entry, transfer and opening balance posts a balanced journal by itself. Nothing here is typed twice." actions={ready && <Button variant="secondary" onClick={() => void refresh()}>Check again</Button>} />
      {load.status === "loading" && <LoadingState label="Loading the books..." withCards />}
      {load.status === "error" && <LoadError message={load.message} onRetry={() => { setLoad({ status: "loading" }); void refresh(); }} />}
      {ready && (
        <>
          <CheckBanner check={ready.check} />
          <div role="tablist" aria-label="Books view" className="flex gap-1 border-b border-line">
            {([["trial", "Trial balance"], ["ledger", "Ledger"], ["journals", "Journals"]] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={cx("min-h-11 rounded-t-lg px-4 text-sm font-semibold", tab === key ? "border-b-2 border-brand-600 text-brand-700" : "text-ink-600 hover:bg-ink-50")}>
                {label}
              </button>
            ))}
          </div>
          {tab === "trial" && <TrialBalance trial={ready.trial} onOpen={(a) => { setAccountId(a.id); setTab("ledger"); }} />}
          {tab === "ledger" && <LedgerView accounts={ready.trial.accounts} accountId={accountId} onAccount={setAccountId} />}
          {tab === "journals" && <Journals />}
        </>
      )}
    </section>
  );
}
