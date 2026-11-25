import { useEffect, useState } from "react";
import { CheckCircle2, Download, XCircle } from "lucide-react";
import {
  downloadBalanceSheet, downloadProfitAndLoss, getBalanceSheet, getProfitAndLoss,
  type BalanceSheet, type LedgerFile, type ProfitAndLoss, type StatementLine,
} from "../../api/finance";
import { ApiError } from "../../api/client";
import { TextField } from "../../components/TextField";
import { Button, Card, CardHeader, cx } from "../../ui";
import { saveBlob } from "../payroll/downloadPdf";
import { formatDay, formatMoney, todayInUae } from "./financeFormat";
import { presetRange } from "./reportPeriods";

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function Group({ title, lines, total, totalLabel, strong, empty = "Nothing in this period." }: { title: string; lines: StatementLine[]; total: number; totalLabel: string; strong?: boolean; empty?: string }) {
  return (
    <section aria-label={title}>
      <h3 className="bg-brand-50/50 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-brand-800">{title}</h3>
      <ul className="divide-y divide-line">
        {lines.length === 0 && <li className="px-5 py-2.5 text-sm text-ink-500">{empty}</li>}
        {lines.map((l) => (
          <li key={l.code + l.name} className="flex items-baseline gap-3 px-5 py-2.5 text-sm">
            <span className="w-14 font-mono text-xs text-ink-500">{l.code}</span>
            <span className="min-w-0 flex-1 break-words text-ink-900">{l.name}</span>
            <span className="tabular-nums text-ink-900">{formatMoney(l.amount)}</span>
          </li>
        ))}
      </ul>
      <p className={cx("flex items-baseline justify-between gap-3 border-t border-line bg-ink-50 px-5 py-2.5 text-sm font-semibold text-ink-900", strong && "font-display text-base")}>
        <span>{totalLabel}</span>
        <span className="tabular-nums">AED {formatMoney(total)}</span>
      </p>
    </section>
  );
}

function Downloads({ make, name }: { make: (f: LedgerFile) => Promise<Blob>; name: string }) {
  const [busy, setBusy] = useState<LedgerFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(format: LedgerFile) {
    setBusy(format);
    setError(null);
    try {
      saveBlob(await make(format), `${name}.${format}`);
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
      {(["xlsx", "pdf", "csv"] as const).map((f) => (
        <Button key={f} size="sm" variant="secondary" icon={Download} disabled={busy !== null} onClick={() => void run(f)}>{f === "xlsx" ? "Excel" : f.toUpperCase()}</Button>
      ))}
      {error && <span role="alert" className="text-sm text-danger">{error}</span>}
    </div>
  );
}

function ProfitLoss() {
  const today = todayInUae();
  const [range, setRange] = useState(() => presetRange("month", today));
  const [data, setData] = useState<ProfitAndLoss | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getProfitAndLoss(range.from, range.to)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(failure(e)));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);
  return (
    <Card>
      <CardHeader title="Profit and loss" description="Revenue less expenses for the period, from the journals." />
      <div className="grid gap-3 px-5 pb-4 sm:grid-cols-2">
        <TextField label="From" type="date" value={range.from} max={today} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        <TextField label="To" type="date" value={range.to} max={today} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
      </div>
      {error && <p role="alert" className="px-5 pb-4 text-sm text-danger">{error}</p>}
      {data && (
        <>
          <Downloads make={(f) => downloadProfitAndLoss(data.from, data.to, f)} name={`Profit_and_Loss_${data.from}_${data.to}`} />
          <div className="border-t border-line">
            <Group title="Revenue" lines={data.revenue} total={data.totalRevenue} totalLabel="Total revenue" />
            <Group title="Expenses" lines={data.expenses} total={data.totalExpenses} totalLabel="Total expenses" />
            <p className={cx("flex items-baseline justify-between gap-3 border-t-2 border-ink-300 px-5 py-3 font-display text-lg font-bold", data.netProfit < 0 ? "text-danger" : "text-ink-900")}>
              <span>{data.netProfit < 0 ? "Net loss" : "Net profit"}</span>
              <span className="tabular-nums">AED {formatMoney(data.netProfit)}</span>
            </p>
            {data.manualJournals > 0 && <p className="px-5 pb-3 text-xs text-ink-600">Includes {data.manualJournals === 1 ? "1 journal" : `${data.manualJournals} journals`} posted by hand in this period.</p>}
          </div>
        </>
      )}
      {!data && !error && <p className="px-5 pb-5 text-sm text-ink-600">Loading...</p>}
    </Card>
  );
}

function Sheet() {
  const today = todayInUae();
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState<BalanceSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getBalanceSheet(asOf)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(failure(e)));
    return () => {
      cancelled = true;
    };
  }, [asOf]);
  return (
    <Card>
      <CardHeader title="Balance sheet" description="What the company holds, what it owes, and the owners' share, at one date." />
      <div className="px-5 pb-4 sm:max-w-xs"><TextField label="As at" type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value)} /></div>
      {error && <p role="alert" className="px-5 pb-4 text-sm text-danger">{error}</p>}
      {data && (
        <>
          <Downloads make={(f) => downloadBalanceSheet(data.asOf, f)} name={`Balance_Sheet_${data.asOf}`} />
          <div className="border-t border-line">
            <Group title="Assets" lines={data.assets} total={data.totalAssets} totalLabel="Total assets" strong />
            <Group title="Liabilities" lines={data.liabilities} total={data.totalLiabilities} totalLabel="Total liabilities" empty="None at this date." />
            <Group title="Equity" lines={[...data.equity, { code: "", name: "Profit retained to date", amount: data.retainedProfit }]} total={data.totalEquity} totalLabel="Total equity" />
            <p className="flex items-baseline justify-between gap-3 border-t-2 border-ink-300 px-5 py-3 font-display text-base font-bold text-ink-900">
              <span>Total liabilities and equity</span>
              <span className="tabular-nums">AED {formatMoney(data.totalLiabilitiesAndEquity)}</span>
            </p>
            <p role="status" className={cx("flex items-center gap-2 px-5 py-3 text-sm", data.balanced ? "text-green-800" : "text-danger")}>
              {data.balanced ? <CheckCircle2 aria-hidden="true" size={16} /> : <XCircle aria-hidden="true" size={16} />}
              {data.balanced ? `Assets equal liabilities plus equity on ${formatDay(data.asOf)}.` : "Assets and liabilities plus equity differ. The books need attention."}
            </p>
            <p className="px-5 pb-4 text-xs text-ink-600">Profit retained is every revenue less every expense up to this date. There is no year-end closing yet.</p>
          </div>
        </>
      )}
      {!data && !error && <p className="px-5 pb-5 text-sm text-ink-600">Loading...</p>}
    </Card>
  );
}

/** The two statements an accountant signs, taken from the journals alone. */
export function StatementsTab({ which }: { which: "pl" | "sheet" }) {
  return which === "pl" ? <ProfitLoss /> : <Sheet />;
}
