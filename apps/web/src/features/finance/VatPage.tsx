import { useEffect, useMemo, useState } from "react";
import { Download, Receipt } from "lucide-react";
import { Link } from "react-router-dom";
import { getFinVatFile, getFinVatReport, type FinReportFormat, type FinVatReport, type FinVatRow } from "../../api/finance";
import { ApiError } from "../../api/client";
import { TextField } from "../../components/TextField";
import { Button, Card, CardHeader, EmptyState, LoadingState, PageHeader, cx } from "../../ui";
import { LoadError } from "../workers/WorkersFeedback";
import { saveBlob } from "../payroll/downloadPdf";
import { formatDay, formatMoney, quietZero, todayInUae } from "./financeFormat";
import { vatDueDate, vatQuarter } from "./vatPeriods";

/** VAT is filed by calendar quarter, so the shortcuts are quarters, not months. */
type VatPreset = "quarter" | "lastQuarter" | "year";
const PRESETS: { key: VatPreset; label: string }[] = [
  { key: "quarter", label: "This quarter" }, { key: "lastQuarter", label: "Last quarter" }, { key: "year", label: "This year" },
];

function rangeFor(preset: VatPreset, today: string): { from: string; to: string } {
  if (preset === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const quarter = vatQuarter(today, preset === "quarter" ? 0 : -1);
  return { from: quarter.from, to: quarter.to > today ? today : quarter.to };
}

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function Block({ title, rows, vatLabel }: { title: string; rows: FinVatRow[]; vatLabel: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <p className="border-t border-line px-5 py-4 text-sm text-ink-600">Nothing with a VAT type in this period.</p>
      ) : (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[30rem] text-sm">
            <caption className="sr-only">{title}: net amount and VAT for each VAT type</caption>
            <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-600">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">VAT type</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Entries</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Net</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">{vatLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.taxTypeId}>
                  <td className="px-4 py-2.5 text-ink-900">{r.taxType}{r.rate > 0 && <span className="ml-2 text-[13px] text-ink-500">{r.rate}%</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.count}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(r.net)}</td>
                  <td className={cx("px-4 py-2.5 text-right font-semibold tabular-nums", quietZero(r.vat))}>{formatMoney(r.vat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The VAT return figures for a period, from the entries: what was charged on sales, what was paid on purchases, and the difference to pay or reclaim. */
export function VatPage() {
  const today = useMemo(() => todayInUae(), []);
  const [range, setRange] = useState(() => rangeFor("quarter", today));
  const [preset, setPreset] = useState<VatPreset | "custom">("quarter");
  const [report, setReport] = useState<FinVatReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<FinReportFormat | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getFinVatReport(range.from, range.to)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setError(failure(e)));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  async function download(format: FinReportFormat, extension: string) {
    setBusy(format);
    try {
      saveBlob(await getFinVatFile(format, range.from, range.to), `VAT_${range.from}_${range.to}.${extension}`);
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(null);
    }
  }

  // A due date means something only for exactly one quarter (the whole of it, or the part of it that has passed).
  const picked = range.from ? vatQuarter(range.from, 0) : null;
  const filing = picked && picked.from === range.from && (range.to === picked.to || (range.to === today && picked.to > today)) ? picked : null;
  const unrecorded = report ? report.unrecordedSales.count + report.unrecordedPurchases.count : 0;
  return (
    <section className="space-y-5">
      <PageHeader
        title="VAT"
        description="The VAT return figures for a period, from the VAT type on each expense and income. Check them with your accountant before filing."
      />
      <Card>
        <div className="space-y-3 px-5 py-4">
          <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" aria-pressed={preset === p.key} onClick={() => { setPreset(p.key); setRange(rangeFor(p.key, today)); }}
                className={cx("min-h-11 rounded-full border px-3.5 text-sm font-medium md:min-h-9", preset === p.key ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-ink-700 hover:border-brand-300")}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="From" type="date" value={range.from} max={today} onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, from: e.target.value })); }} />
            <TextField label="To" type="date" value={range.to} max={today} onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, to: e.target.value })); }} />
          </div>
        </div>
      </Card>

      {error && <LoadError message={error} onRetry={() => setRange({ ...range })} />}
      {!report && !error && <LoadingState label="Working out the VAT..." withCards />}
      {report && (
        <>
          <section aria-labelledby="vat-net" className="overflow-hidden rounded-card bg-sidebar text-white shadow-card">
            <div className="grid gap-5 p-5 md:grid-cols-3 md:p-7">
              <div className="md:col-span-1">
                <p id="vat-net" className="flex items-center gap-2 text-sm font-medium text-white/75"><Receipt aria-hidden="true" size={16} /> {report.netPayable >= 0 ? "VAT to pay" : "VAT to reclaim"}</p>
                <p className="mt-2 font-display text-4xl font-bold tracking-tight tabular-nums"><span className="mr-2 text-lg font-medium text-white/70">AED</span>{formatMoney(Math.abs(report.netPayable))}</p>
              </div>
              <p className="text-sm text-white/80 md:col-span-1">VAT charged on sales and on reverse-charge purchases<span className="mt-1 block font-display text-xl font-semibold tabular-nums text-white">AED {formatMoney(report.outputVat)}</span></p>
              <p className="text-sm text-white/80 md:col-span-1">VAT paid on purchases, which can be reclaimed<span className="mt-1 block font-display text-xl font-semibold tabular-nums text-white">AED {formatMoney(report.inputVat)}</span></p>
            </div>
          </section>
          {filing && (
            <p className="rounded-lg bg-ink-50 px-4 py-3 text-sm text-ink-800">
              Return for <strong>{filing.label}</strong> ({formatDay(filing.from)} to {formatDay(filing.to)}) is due <strong>{formatDay(vatDueDate(filing.to))}</strong>.
              {filing.to > today && " The quarter is not over, so these figures are so far."}
            </p>
          )}
          {unrecorded > 0 && (
            <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {report.unrecordedSales.count} sales (AED {formatMoney(report.unrecordedSales.amount)}) and {report.unrecordedPurchases.count} purchases (AED {formatMoney(report.unrecordedPurchases.amount)}) have no VAT type, so they are not in these figures.{" "}
              <Link to="/finance/expenses" className="font-medium underline">Open the expenses</Link> to choose one by correcting the entry.
            </p>
          )}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Block title="Sales" rows={report.sales} vatLabel="VAT charged" />
            <Block title="Purchases" rows={report.purchases} vatLabel="VAT" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-600">Download these figures:</span>
            <Button variant="secondary" icon={Download} disabled={busy !== null} onClick={() => void download("xlsx", "xlsx")}>Excel</Button>
            <Button variant="secondary" icon={Download} disabled={busy !== null} onClick={() => void download("pdf", "pdf")}>PDF</Button>
            <Button variant="secondary" icon={Download} disabled={busy !== null} onClick={() => void download("csv", "csv")}>CSV</Button>
          </div>
          {report.sales.length === 0 && report.purchases.length === 0 && unrecorded === 0 && (
            <Card><EmptyState icon={Receipt} title="No entries in this period" description="Record an expense or income and choose its VAT type." /></Card>
          )}
        </>
      )}
    </section>
  );
}
