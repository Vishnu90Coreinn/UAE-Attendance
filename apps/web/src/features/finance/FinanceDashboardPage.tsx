import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Landmark, ReceiptText, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { getFinDashboard, type FinDashboard, type FinWindow } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Card, CardHeader, EmptyState, LoadingState, PageHeader, cx } from "../../ui";
import { LoadError } from "../workers/WorkersFeedback";
import { formatDay, formatMoney, sharePercent, sumMoney } from "./financeFormat";

const WINDOWS: { days: FinWindow; label: string; long: string }[] = [
  { days: 7, label: "7 days", long: "last 7 days" },
  { days: 30, label: "30 days", long: "last 30 days" },
  { days: 365, label: "1 year", long: "last 365 days" },
];

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: FinDashboard };

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
    <div role="radiogroup" aria-label="Period" className="inline-flex rounded-lg border border-line bg-white p-0.5 shadow-card">
      {WINDOWS.map((w) => (
        <button
          key={w.days}
          type="button"
          role="radio"
          aria-checked={value === w.days}
          onClick={() => onChange(w.days)}
          className={cx(
            "min-h-11 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:min-h-9",
            value === w.days ? "bg-sidebar text-white" : "text-ink-700 hover:bg-ink-50",
          )}
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
    { key: "Income", value: current.income, color: "bg-brand-300", icon: TrendingUp },
    { key: "Expenses", value: current.expense, color: "bg-amber-300", icon: TrendingDown },
  ];
  return (
    <section aria-labelledby="net-result" className="overflow-hidden rounded-card bg-sidebar text-white shadow-card">
      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:p-7">
        <div>
          <p id="net-result" className="text-sm font-medium text-white/75">
            Net result · {label}
          </p>
          <p className={cx("mt-2 text-4xl font-semibold tracking-tight tabular-nums md:text-5xl", current.net < 0 && "text-red-200")}>
            {current.net < 0 && <span aria-label="minus">−</span>}
            <span className="mr-2 text-lg font-medium text-white/70">AED</span>
            {formatMoney(Math.abs(current.net))}
          </p>
          <p className="mt-3 text-sm text-white/70">{comparison(data)}</p>
          <p className="mt-1 text-xs text-white/60">
            {formatDay(data.from)} to {formatDay(data.to)} · transfers between accounts are not counted
          </p>
        </div>
        <ul className="grid content-end gap-4">
          {bars.map((b) => (
            <li key={b.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 font-medium text-white/85">
                  <b.icon aria-hidden="true" size={16} />
                  {b.key}
                </span>
                <Aed value={b.value} className="text-lg font-semibold" />
              </div>
              <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                <div className={cx("h-full rounded-full", b.color)} style={{ width: `${b.value > 0 ? Math.max((b.value / scale) * 100, 1.5) : 0}%` }} />
              </div>
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
  return (
    <Card>
      <CardHeader title={`Income and expenses by ${unit}`} description={`Tallest bar: AED ${formatMoney(peak)}`} />
      <div className="px-5 pb-5">
        {!busy ? (
          <p className="py-8 text-center text-sm text-ink-600">Nothing was recorded in this period.</p>
        ) : (
          <>
            <div className="flex h-40 items-end gap-px sm:gap-0.5" role="img" aria-label={`Income and expenses for each ${unit}, ${formatDay(data.from)} to ${formatDay(data.to)}. Figures are in the table below.`}>
              {buckets.map((b) => (
                <div key={b.start} title={`${b.label}: income AED ${formatMoney(b.income)}, expenses AED ${formatMoney(b.expense)}`} className="flex h-full min-w-0 flex-1 items-end justify-center gap-px">
                  <span className="block w-1/2 rounded-t-sm bg-brand-500" style={{ height: `${(b.income / peak) * 100}%`, minHeight: b.income > 0 ? 2 : 0 }} />
                  <span className="block w-1/2 rounded-t-sm bg-amber-400" style={{ height: `${(b.expense / peak) * 100}%`, minHeight: b.expense > 0 ? 2 : 0 }} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-ink-600">
              <span>{buckets[0]?.label}</span>
              <span>{buckets[buckets.length - 1]?.label}</span>
            </div>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-800">
              <span className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-brand-500" />Income</span>
              <span className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-amber-400" />Expenses</span>
            </p>
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
  const positive = sumMoney(data.accounts.filter((a) => a.balance > 0).map((a) => a.balance));
  return (
    <Card>
      <CardHeader title="Balances today" description={`AED ${formatMoney(data.totalBalance)} across ${data.accounts.length} ${data.accounts.length === 1 ? "account" : "accounts"}`} />
      {data.accounts.length === 0 ? (
        <EmptyState icon={Landmark} title="No accounts yet" description="Accounts and their balances appear here." />
      ) : (
        <ul className="divide-y divide-line">
          {data.accounts.map((a) => {
            const Icon = a.kind === "Cash" ? Wallet : Landmark;
            return (
              <li key={a.id} className="px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <Icon aria-hidden="true" size={18} className="shrink-0 text-brand-700" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">{a.name}</span>
                  <span className={cx("text-base font-semibold tabular-nums", a.balance < 0 ? "text-danger" : "text-ink-900")}>
                    {a.balance < 0 && "−"}AED {formatMoney(Math.abs(a.balance))}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${sharePercent(a.balance, positive)}%` }} />
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
  const top = Math.max(...data.spending.map((s) => s.amount), 1);
  const label = WINDOWS.find((w) => w.days === data.days)?.long ?? "";
  return (
    <Card>
      <CardHeader title="Where the money went" description={`Expenses by category, ${label}`} />
      {data.spending.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No expenses in this period" description="Spending appears here, biggest category first." />
      ) : (
        <ol className="grid gap-4 px-5 pb-5">
          {data.spending.map((s) => (
            <li key={s.categoryId ?? "rest"}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-ink-900">{s.name}</span>
                <span className="font-semibold tabular-nums text-ink-900">AED {formatMoney(s.amount)}</span>
                <span className="w-10 text-right tabular-nums text-ink-600">{s.share}%</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${(s.amount / top) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function LatestCard({ data }: { data: FinDashboard }) {
  return (
    <Card>
      <CardHeader title="Latest entries" description="The eight most recent expenses and income." />
      {data.latest.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Nothing recorded yet" description="New expenses and income are listed here." />
      ) : (
        <ul className="divide-y divide-line">
          {data.latest.map((e) => (
            <li key={`${e.kind}-${e.id}`} className="flex items-center gap-3 px-5 py-3">
              <div className="w-24 shrink-0">
                <p className="text-sm font-medium tabular-nums text-ink-900">{formatDay(e.entryDate)}</p>
                <p className="font-mono text-xs text-ink-500">{e.entryNo}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900">{e.party}</p>
                <p className="truncate text-xs text-ink-600">{e.categoryName} · {e.accountName}</p>
              </div>
              <p className={cx("text-right text-sm font-semibold tabular-nums", e.kind === "Income" ? "text-brand-700" : "text-ink-900")}>
                <span className="sr-only">{e.kind === "Income" ? "Income " : "Expense "}</span>
                <span aria-hidden="true">{e.kind === "Income" ? "+" : "−"}</span> {formatMoney(e.amount)}
              </p>
            </li>
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

  return (
    <section className="space-y-5">
      <PageHeader title="Finance" description="Income, expenses and balances for the company, worked out from every recorded entry." actions={<PeriodPicker value={days} onChange={(d) => { setLoad({ status: "loading" }); setDays(d); }} />} />
      {load.status === "loading" && <LoadingState label="Loading the overview..." withCards />}
      {load.status === "error" && <LoadError message={load.message} onRetry={() => { setLoad({ status: "loading" }); void refresh(days); }} />}
      {load.status === "ready" && (
        <>
          <ResultPanel data={load.data} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <TrendCard data={load.data} />
            <SpendingCard data={load.data} />
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <BalancesCard data={load.data} />
            <LatestCard data={load.data} />
          </div>
        </>
      )}
    </section>
  );
}
