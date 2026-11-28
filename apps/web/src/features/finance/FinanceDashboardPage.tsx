import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, HandCoins, Landmark, ReceiptText, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { getFinChequeSummary, getFinDashboard, listFinCategories, type FinCategory, type FinChequeSummary, type FinDashboard, type FinEntryKind, type FinWindow } from "../../api/finance";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { AttentionCard } from "./AttentionCard";
import { GetStartedCard } from "./GetStartedCard";
import { Arrive, Button, Card, CardHeader, Draw, EmptyState, LoadingState, Mark, PageHeader, cx, notify, segmentClass, segmentGroupClass } from "../../ui";
import { LoadError } from "../workers/WorkersFeedback";
import { EntryDialog } from "./EntryDialog";
import { changeWords, formatCompact, formatDay, formatMoney, formatShare, splitShares, sumMoney } from "./financeFormat";

const WINDOWS: { days: FinWindow; label: string; long: string }[] = [
  { days: 7, label: "7 days", long: "last 7 days" },
  { days: 30, label: "30 days", long: "last 30 days" },
  { days: 365, label: "1 year", long: "last 365 days" },
];

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: FinDashboard };

const KIND_WORDS: Record<string, string> = { Income: "Income", Expense: "Expense", Capital: "Capital added", CapitalOut: "Capital returned" };
const moneyIn = (kind: string) => kind === "Income" || kind === "Capital";

function Aed({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx("tabular-nums", className)}>
      <span className="mr-1 text-[0.7em] font-medium opacity-70">AED</span>
      {formatMoney(value)}
    </span>
  );
}

/** One line saying how this period compares with the one before it, in words and sign, not colour alone. */
function comparison(data: FinDashboard): string {
  const { current, previous, days } = data;
  if (previous.income === 0 && previous.expense === 0) return `Nothing was recorded in the ${days} days before, so there is nothing to compare with.`;
  const diff = sumMoney([current.net, -previous.net]);
  if (diff === 0) return `Same as the ${days} days before.`;
  return `AED ${formatMoney(Math.abs(diff))} ${diff > 0 ? "better" : "worse"} than the ${days} days before (${previous.net < 0 ? "−" : ""}AED ${formatMoney(Math.abs(previous.net))}).`;
}

function PeriodPicker({ value, onChange }: { value: FinWindow; onChange: (days: FinWindow) => void }) {
  return (
    <div role="radiogroup" aria-label="Period" className={segmentGroupClass}>
      {WINDOWS.map((w) => (
        <button
          key={w.days}
          type="button"
          role="radio"
          aria-checked={value === w.days}
          onClick={() => onChange(w.days)}
          className={segmentClass(value === w.days)}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

/** The period's net result, with income and expense drawn to the same scale so the gap reads at a glance. */
function ResultPanel({ data }: { data: FinDashboard }) {
  const { current } = data;
  const scale = Math.max(current.income, current.expense, 1);
  const label = WINDOWS.find((w) => w.days === data.days)?.long ?? `last ${data.days} days`;
  const bars = [
    { key: "Income", value: current.income, before: data.previous.income, color: "bg-brand-300", icon: TrendingUp },
    { key: "Expenses", value: current.expense, before: data.previous.expense, color: "bg-amber-300", icon: TrendingDown },
  ];
  return (
    <section aria-labelledby="net-result" className="overflow-hidden rounded-card bg-sidebar text-white shadow-card">
      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:p-7">
        <div>
          <p id="net-result" className="text-sm font-medium text-white/75">
            Net receipts less payments · {label}
          </p>
          <p className={cx("mt-2 font-display text-4xl font-bold tracking-tight tabular-nums md:text-5xl", current.net < 0 && "text-red-200")}>
            <Mark value={current.net} tone="dark">
              {current.net < 0 && <span aria-label="minus">−</span>}
              <span className="mr-2 text-lg font-medium text-white/70">AED</span>
              {formatMoney(Math.abs(current.net))}
            </Mark>
          </p>
          <p className="mt-3 text-sm text-white/70">{comparison(data)}</p>
          <p className="mt-1 text-xs text-white/60">
            {formatDay(data.from)} to {formatDay(data.to)} · includes VAT where recorded. This is cash movement, not accounting profit; see the profit and loss statement under Books.
          </p>
          <p className="mt-4 border-t border-white/15 pt-3 text-sm text-white/70">
            In the accounts today{" "}
            <Mark value={data.totalBalance} tone="dark" className="font-display text-base font-semibold tabular-nums text-white">AED {formatMoney(data.totalBalance)}</Mark>
            <span className="text-white/60"> · {data.accounts.length === 1 ? "1 account" : `${data.accounts.length} accounts`}</span>
          </p>
        </div>
        <ul className="grid content-end gap-4">
          {bars.map((b, index) => (
            <li key={b.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 font-medium text-white/85">
                  <b.icon aria-hidden="true" size={16} />
                  {b.key}
                </span>
                <Mark value={b.value} tone="dark"><Aed value={b.value} className="text-lg font-semibold" /></Mark>
              </div>
              <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                <Draw order={index} className={cx("h-full rounded-full", b.color)} style={{ width: `${b.value > 0 ? Math.max((b.value / scale) * 100, 1.5) : 0}%` }} />
              </div>
              <p className="mt-1 text-xs text-white/65 tabular-nums">
                Before: AED {formatMoney(b.before)}
                {changeWords(b.value, b.before) && <> · <span className="font-medium text-white/85">{changeWords(b.value, b.before)}</span></>}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Income against expenses per day (or month). Bars are labelled at the ends; the full figures sit in each bar's title and the table below it for screen readers. */
function TrendCard({ data }: { data: FinDashboard }) {
  const { buckets } = data;
  const peak = Math.max(...buckets.flatMap((b) => [b.income, b.expense]), 1);
  const unit = data.granularity === "day" ? "day" : "month";
  const busy = buckets.some((b) => b.income > 0 || b.expense > 0);
  // The figures for one pair of bars, chosen by pointing at it or tapping it: a tooltip alone is no use on a phone.
  const [picked, setPicked] = useState<string | null>(null);
  const shown = buckets.find((b) => b.start === picked);
  return (
    <Card>
      <CardHeader title={`Income and expenses by ${unit}`} description={`Each pair of bars is one ${unit}. Exact figures are on the Reports page.`} />
      <div className="px-5 pb-5">
        {!busy ? (
          <p className="py-8 text-center text-sm text-ink-600">Nothing was recorded in this period.</p>
        ) : (
          <>
            <div className="relative">
              {[1, 0.5, 0].map((fraction) => (
                <div key={fraction} aria-hidden="true" className="pointer-events-none absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${fraction * 100}%`, transform: "translateY(50%)" }}>
                  <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-ink-500">{formatCompact(peak * fraction)}</span>
                  <span className={cx("h-px flex-1", fraction === 0 ? "bg-ink-300" : "bg-ink-100")} />
                </div>
              ))}
            <Draw className="ml-14 flex h-40 items-end gap-px sm:gap-0.5" role="img" aria-label={`Income and expenses for each ${unit}, ${formatDay(data.from)} to ${formatDay(data.to)}. Figures are in the table below.`}>
              {buckets.map((b) => (
                <div key={b.start} data-bucket={b.start} title={`${b.label}: income AED ${formatMoney(b.income)}, expenses AED ${formatMoney(b.expense)}`} onClick={() => setPicked(b.start)} onMouseEnter={() => setPicked(b.start)} className={cx("flex h-full min-w-0 flex-1 cursor-pointer items-end justify-center gap-px", picked === b.start && "bg-ink-100")}>
                  <span className="block w-1/2 rounded-t-sm bg-brand-500" style={{ height: `${(b.income / peak) * 100}%`, minHeight: b.income > 0 ? 2 : 0 }} />
                  <span className="block w-1/2 rounded-t-sm bg-amber-400" style={{ height: `${(b.expense / peak) * 100}%`, minHeight: b.expense > 0 ? 2 : 0 }} />
                </div>
              ))}
            </Draw>
            </div>
            <div className="ml-14 mt-2 flex justify-between text-[13px] text-ink-600">
              <span>{buckets[0]?.label}</span>
              <span>{buckets[buckets.length - 1]?.label}</span>
            </div>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-800">
              <span className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-brand-500" />Income (left bar)</span>
              <span className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-amber-400" />Expenses (right bar)</span>
            </p>
            <p aria-live="polite" className="mt-1 min-h-5 text-sm tabular-nums text-ink-700">{shown ? `${shown.label}: income AED ${formatMoney(shown.income)}, expenses AED ${formatMoney(shown.expense)}` : "Point at or tap a pair of bars for its figures."}</p>
            <table className="sr-only">
              <caption>Income and expenses by {unit}</caption>
              <thead><tr><th>{unit}</th><th>Income</th><th>Expenses</th></tr></thead>
              <tbody>
                {buckets.filter((b) => b.income > 0 || b.expense > 0).map((b) => (
                  <tr key={b.start}><td>{b.label}</td><td>{formatMoney(b.income)}</td><td>{formatMoney(b.expense)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Card>
  );
}

function BalancesCard({ data }: { data: FinDashboard }) {
  const shares = splitShares(data.accounts.map((a) => a.balance), 1);
  return (
    <Card>
      <CardHeader title="Balances today" description={`AED ${formatMoney(data.totalBalance)} across ${data.accounts.length} ${data.accounts.length === 1 ? "account" : "accounts"}`} />
      {data.accounts.length === 0 ? (
        <EmptyState icon={Landmark} title="No accounts yet" description="Accounts and their balances appear here." />
      ) : (
        <ul className="divide-y divide-line">
          {data.accounts.map((a, index) => {
            const Icon = a.kind === "Cash" ? Wallet : Landmark;
            return (
              <li key={a.id} className="px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <Icon aria-hidden="true" size={18} className="shrink-0 text-brand-700" />
                  <span className="min-w-0 flex-1 break-words text-sm font-medium text-ink-900">{a.name}</span>
                  <Mark value={a.balance} className={cx("text-base font-semibold tabular-nums", a.balance < 0 ? "text-danger" : "text-ink-900")}>
                    {a.balance < 0 && "−"}AED {formatMoney(Math.abs(a.balance))}
                  </Mark>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
                  <Draw order={index} className="h-full rounded-full bg-brand-500" style={{ width: `${shares[index]}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="border-t border-line px-5 py-3">
        <Link to="/finance/accounts" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:underline sm:min-h-0">
          Manage accounts <ArrowRight aria-hidden="true" size={14} />
        </Link>
      </div>
    </Card>
  );
}

function SpendingCard({ data }: { data: FinDashboard }) {
  const label = WINDOWS.find((w) => w.days === data.days)?.long ?? "";
  return (
    <Card>
      <CardHeader title="Where the money went" description={`Expenses by category, ${label}. A bar is that category's share of all spending.`} />
      {data.spending.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No expenses in this period" description="Spending appears here, biggest category first." />
      ) : (
        <ol className="grid grid-cols-1 gap-4 px-5 pb-5">
          {data.spending.map((s, index) => (
            <li key={s.categoryId ?? "rest"}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1 break-words font-medium text-ink-900">{s.name}</span>
                <span className="font-semibold tabular-nums text-ink-900">AED {formatMoney(s.amount)}</span>
                <span className="w-14 text-right tabular-nums text-ink-600">{formatShare(s.share)}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
                <Draw order={index} className="h-full rounded-full bg-amber-400" style={{ width: `${Math.max(s.share, 1)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

const CAPITAL_COLORS = ["bg-brand-500", "bg-amber-400", "bg-sky-500", "bg-rose-400", "bg-ink-400"];

/** Whose money it is: the partners' capital and each one's exact share, apart from what the business earned. */
/** Cheques not yet cleared: what is due in the next 30 days, what is overdue, and the post-dated ones further out. Hidden while there is nothing open. */
function ChequesCard() {
  const [summary, setSummary] = useState<FinChequeSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(getFinChequeSummary())
      .then((s) => !cancelled && setSummary(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (!summary || (summary.next.length === 0 && summary.overdueCount === 0 && summary.laterIssuedCount === 0)) return null;
  return (
    <Arrive>
      <Card>
        <CardHeader title="Cheques" description="Cheques that have not cleared yet. They change no balance until the money moves." />
        <div className="grid gap-4 px-5 pb-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Due in {summary.days} days</p>
            <p className={cx("font-display text-xl font-bold tabular-nums", summary.dueSoonIssued === 0 ? "text-ink-400" : "text-ink-900")}>AED {formatMoney(summary.dueSoonIssued)}</p>
            <p className="text-[13px] text-ink-500">{summary.dueSoonIssuedCount === 1 ? "1 cheque to pay" : `${summary.dueSoonIssuedCount} cheques to pay`}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Overdue</p>
            <p className={cx("font-display text-xl font-bold tabular-nums", summary.overdueCount === 0 ? "text-ink-400" : "text-danger")}>AED {formatMoney(summary.overdueAmount)}</p>
            <p className="text-[13px] text-ink-500">{summary.overdueCount === 1 ? "1 cheque past its date" : `${summary.overdueCount} cheques past their date`}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Post-dated, later</p>
            <p className={cx("font-display text-xl font-bold tabular-nums", summary.laterIssued === 0 ? "text-ink-400" : "text-ink-900")}>AED {formatMoney(summary.laterIssued)}</p>
            <p className="text-[13px] text-ink-500">{summary.laterIssuedCount === 1 ? "1 cheque" : `${summary.laterIssuedCount} cheques`} after {summary.days} days</p>
          </div>
        </div>
        {summary.next.length > 0 && (
          <ul className="divide-y divide-line border-t border-line">
            {summary.next.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 py-2.5 text-sm">
                <span className="w-24 shrink-0 tabular-nums text-ink-700">{formatDay(c.dueDate)}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink-900">{c.partyName}</span>
                <span className="text-[13px] text-ink-500">{c.direction === "Issued" ? "to pay" : "to receive"} · #{c.serial}</span>
                <span className="w-28 text-right font-semibold tabular-nums text-ink-900">{formatMoney(c.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line px-5 py-3">
          <Link to="/finance/cheques" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:underline sm:min-h-0">
            All cheques <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </div>
      </Card>
    </Arrive>
  );
}

function CapitalCard({ capital }: { capital: NonNullable<FinDashboard["capital"]> }) {
  return (
    <Card>
      <CardHeader title="Partners' capital" description="Money the partners put in, less anything paid back. It is part of the balances but is not income." />
      <div className="grid gap-5 px-5 pb-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-8">
        <p className="font-display text-3xl font-bold tracking-tight tabular-nums text-ink-900">
          <Mark value={capital.total}>
            <span className="mr-1 text-sm font-medium text-ink-500">AED</span>
            {formatMoney(capital.total)}
          </Mark>
        </p>
        <div>
          <Draw
            role="img"
            aria-label={`Share of the capital: ${capital.partners.map((p) => `${p.name} ${formatShare(p.share)}`).join(", ")}`}
            className="flex h-3 gap-0.5 overflow-hidden rounded-full"
          >
            {capital.partners.map((p, i) => (
              <span key={p.id} style={{ width: `${Math.max(p.share, 1.5)}%` }} className={cx("block h-full", CAPITAL_COLORS[i % CAPITAL_COLORS.length])} />
            ))}
          </Draw>
          <ul className="mt-3 grid gap-1.5 text-sm">
            {capital.partners.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2">
                <span aria-hidden="true" className={cx("size-2.5 shrink-0 rounded-sm", CAPITAL_COLORS[i % CAPITAL_COLORS.length])} />
                <span className="min-w-0 flex-1 truncate text-ink-800">{p.name}</span>
                <span className="tabular-nums text-ink-600">AED {formatMoney(p.netCapital)}</span>
                <span className="w-16 text-right font-semibold tabular-nums text-ink-900">{formatShare(p.share)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-line px-5 py-3">
        <Link to="/finance/partners" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:underline sm:min-h-0">
          Partners and capital movements <ArrowRight aria-hidden="true" size={14} />
        </Link>
      </div>
    </Card>
  );
}

function LatestCard({ data }: { data: FinDashboard }) {
  return (
    <Card>
      <CardHeader title="Latest entries" description="The eight most recent entries: expenses, income and partners' capital." />
      {data.latest.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Nothing recorded yet" description="New expenses and income are listed here." />
      ) : (
        <ul className="divide-y divide-line">
          {data.latest.map((e, index) => (
            <Arrive as="li" order={index} key={`${e.kind}-${e.id}`} className="flex items-center gap-3 px-5 py-3">
              <div className="w-24 shrink-0">
                <p className="text-[13px] font-medium tabular-nums text-ink-700">{formatDay(e.entryDate)}</p>
                <p className="font-mono text-[13px] text-ink-500">{e.entryNo}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-ink-900">{e.party}</p>
                <p className="truncate text-[13px] text-ink-600">{e.kind === "Capital" || e.kind === "CapitalOut" ? `${KIND_WORDS[e.kind]} · ` : `${e.categoryName} · `}{e.accountName}</p>
              </div>
              <p className={cx("text-right font-display text-base font-bold tabular-nums", moneyIn(e.kind) ? "text-brand-700" : "text-ink-900")}>
                <span className="sr-only">{KIND_WORDS[e.kind]} </span>
                <span aria-hidden="true">{moneyIn(e.kind) ? "+" : "−"}</span> {formatMoney(e.amount)}
              </p>
            </Arrive>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-x-6 border-t border-line px-5 py-3 text-sm font-medium text-brand-700">
        <Link to="/finance/expenses" className="inline-flex min-h-11 items-center gap-1 hover:underline sm:min-h-0">All expenses <ArrowRight aria-hidden="true" size={14} /></Link>
        <Link to="/finance/income" className="inline-flex min-h-11 items-center gap-1 hover:underline sm:min-h-0">All income <ArrowRight aria-hidden="true" size={14} /></Link>
      </div>
    </Card>
  );
}

/** Where the company stands: the period's net result, where the money went, the balances now, and what was recorded last. */
export function FinanceDashboardPage() {
  const { user } = useAuth();
  const canEdit = isManagement(user?.role);
  const desktop = useIsDesktop();
  const [categories, setCategories] = useState<FinCategory[]>([]);
  const [adding, setAdding] = useState<FinEntryKind | null>(null);
  const [days, setDays] = useState<FinWindow>(30);
  const [load, setLoad] = useState<Load>({ status: "loading" });

  // Only the answer to the latest request may be shown, so a slow reply for an earlier period cannot overwrite the current one.
  const latestRequest = useRef(0);
  const refresh = useCallback(async (window: FinWindow) => {
    const request = ++latestRequest.current;
    try {
      const data = await getFinDashboard(window);
      if (request === latestRequest.current) setLoad({ status: "ready", data });
    } catch (error) {
      if (request === latestRequest.current) setLoad({ status: "error", message: error instanceof ApiError ? error.message : "Something went wrong. Please try again." });
    }
  }, []);

  useEffect(() => {
    void refresh(days);
  }, [days, refresh]);

  useEffect(() => {
    if (!canEdit) return;
    listFinCategories(true).then(setCategories).catch(() => {});
  }, [canEdit]);

  return (
    <section className="space-y-5">
      <PageHeader
        title="Finance"
        description="Income, expenses and balances for the company, worked out from every recorded entry."
        actions={
          <>
            <PeriodPicker value={days} onChange={(d) => { setLoad({ status: "loading" }); setDays(d); }} />
            {canEdit && load.status === "ready" && (
              <>
                <Button variant="secondary" icon={HandCoins} onClick={() => setAdding("Income")}>Add income</Button>
                <Button icon={ReceiptText} onClick={() => setAdding("Expense")}>Add expense</Button>
              </>
            )}
          </>
        }
      />
      {load.status === "loading" && <LoadingState label="Loading the overview..." withCards />}
      {load.status === "error" && <LoadError message={load.message} onRetry={() => { setLoad({ status: "loading" }); void refresh(days); }} />}
      {load.status === "ready" && (
        <>
          <AttentionCard canLock={canEdit} />
          <Arrive>
            <ResultPanel data={load.data} />
          </Arrive>
          <Arrive order={1} className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <TrendCard data={load.data} />
            <SpendingCard data={load.data} />
          </Arrive>
          <Arrive order={2} className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <BalancesCard data={load.data} />
            <LatestCard data={load.data} />
          </Arrive>
          <ChequesCard />
          {load.data.capital && (
            <Arrive order={3}>
              <CapitalCard capital={load.data.capital} />
            </Arrive>
          )}
          {canEdit && <GetStartedCard />}
          {adding && (
            <EntryDialog
              kind={adding}
              accounts={load.data.accounts.filter((a) => a.isActive)}
              categories={categories.filter((c) => c.kind === adding && c.isActive)}
              variant={desktop ? "center" : "sheet"}
              onClose={() => setAdding(null)}
              onSaved={(entry) => {
                setAdding(null);
                notify.success(`${entry.entryNo}: AED ${formatMoney(entry.amount)} ${entry.kind === "Income" ? "received from" : "paid to"} ${entry.party} was recorded.`);
                void refresh(days);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
