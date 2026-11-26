import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { getReceivables, type ReceivablesReport } from "../../api/finance";
import { Card, CardHeader, cx } from "../../ui";
import { formatDay, formatMoney } from "./financeFormat";

/** Who owes the company money: issued tax invoices still unpaid, oldest first, with how late each one is. */
export function ReceivablesTab() {
  const [report, setReport] = useState<ReceivablesReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReceivables().then((r) => !cancelled && setReport(r)).catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "The receivables could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!report) return <p className="text-sm text-ink-600">Loading...</p>;
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
        Issuing a tax invoice books the sale and the VAT. The customer owes that amount until a payment is recorded on the invoice against a bank or cash account.
        Compare this total with the receivables account in the books; any difference needs reconciliation.
      </p>
      {report.unrecordedPayments > 0 && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {report.unrecordedPayments} payment{report.unrecordedPayments === 1 ? " was" : "s were"} entered before invoices were tied to the books. They reduce the invoice below but were never added to a bank or cash account.
        </p>
      )}
      <Card>
        <CardHeader title="Receivables" description={`Unpaid tax invoices as at ${formatDay(report.asOf)}`} />
        <dl className="grid grid-cols-2 gap-3 border-t border-line px-5 py-3 text-sm sm:grid-cols-5">
          {report.buckets.map((b) => (
            <div key={b.name}><dt className="text-ink-500">{b.name}</dt><dd className={cx("tabular-nums", b.amount === 0 ? "text-ink-400" : "text-ink-900")}>{formatMoney(b.amount)}</dd></div>
          ))}
        </dl>
        <p className="flex items-baseline justify-between gap-3 border-t border-line bg-ink-50 px-5 py-2.5 text-sm font-semibold text-ink-900"><span>Total owed to the company</span><span className="font-display tabular-nums">AED {formatMoney(report.totalOwed)}</span></p>
        {report.rows.length === 0 ? (
          <p className="border-t border-line px-5 py-4 text-sm text-ink-600">No unpaid invoices.</p>
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[40rem] text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-500"><th className="px-4 py-2">Invoice</th><th className="px-4 py-2">Client</th><th className="px-4 py-2">Due</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2 text-right">Paid</th><th className="px-4 py-2 text-right">Owed</th></tr></thead>
              <tbody className="divide-y divide-line">
                {report.rows.map((r) => (
                  <tr key={r.invoiceId}>
                    <td className="px-4 py-2.5"><a className="font-medium text-brand-700 underline" href={`/invoices?q=${encodeURIComponent(r.number)}`}>{r.number}</a></td>
                    <td className="px-4 py-2.5 text-ink-900">{r.client}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-700">{formatDay(r.dueDate)}{r.daysOverdue > 0 && <span className="ml-2 text-xs text-danger">{r.daysOverdue} days late</span>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(r.total)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-600">{formatMoney(r.paid)}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink-900">{formatMoney(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
