import type { Invoice, InvoiceCompany, InvoiceLine } from "../../api/invoices";
import { formatMoney } from "./invoiceMath";
import { formatDate, useDocumentImage, useLogoUrl } from "./invoiceUi";

interface Props {
  invoice: Pick<
    Invoice,
    | "number" | "status" | "displayStatus" | "clientName" | "clientTrn" | "clientAddress" | "invoiceDate" | "dueDate" | "paymentTerms"
    | "lpoRef" | "pcRef" | "project" | "scope" | "notes" | "subTotal" | "vatTotal" | "total" | "balanceDue" | "amountPaid" | "totalInWords"
  > & { lines: Pick<InvoiceLine, "lineNo" | "description" | "quantity" | "rate" | "taxable" | "vat" | "amount">[]; company: InvoiceCompany };
}

/** The tax invoice as it prints. The same markup is used on screen and in the browser's print view (which handles the Arabic name). */
export function InvoiceDocument({ invoice }: Props) {
  const c = invoice.company;
  const logo = useLogoUrl(c.hasLogo);
  const stamp = useDocumentImage("seal", !!c.hasSeal);
  const issued = invoice.status === "Issued";
  return (
    <article
      aria-label={invoice.number ? `Tax invoice ${invoice.number}` : "Tax invoice draft"}
      className="invoice-doc mx-auto w-full max-w-4xl rounded-card border border-line bg-white p-4 text-sm text-ink-800 shadow-card sm:p-8"
    >
      <header className="flex flex-col gap-4 border-b border-ink-200 pb-5 sm:flex-row sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {logo && <img src={logo} alt="Company logo" className="h-20 w-24 shrink-0 object-contain" />}
          <div className="min-w-0">
            <p className="break-words text-base font-bold text-ink-900">{c.companyName}</p>
            {c.companySubtitle && <p className="break-words text-xs font-semibold uppercase tracking-wide text-brand-700">{c.companySubtitle}</p>}
            {c.companyNameAr && (
              <p dir="rtl" lang="ar" className="break-words text-sm font-semibold text-ink-700">
                {c.companyNameAr}
              </p>
            )}
            <div className="mt-1 space-y-0.5 text-xs text-ink-600">
              {c.mobile && <p>Mobile: {c.mobile}</p>}
              {c.address1 && <p>{c.address1}</p>}
              {c.address2 && <p>{c.address2}</p>}
              {c.trn && <p>TRN: {c.trn}</p>}
            </div>
          </div>
        </div>
        <div className="sm:text-right">
          <h3 className="text-2xl font-black uppercase tracking-tight text-ink-900">Tax Invoice</h3>
          <p className="font-bold text-ink-900">{invoice.number ?? "Draft (no number yet)"}</p>
          <p className="mt-1 text-xs font-semibold uppercase text-amber-800">
            {invoice.status === "Cancelled" ? "Cancelled" : invoice.displayStatus === "Paid" ? "Paid" : invoice.displayStatus === "PartPaid" ? "Part-paid" : invoice.status === "Draft" ? "Draft" : ""}
          </p>
        </div>
      </header>

      <section className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-ink-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Bill to</p>
          <p className="mt-1 break-words font-bold text-ink-900">{invoice.clientName}</p>
          {invoice.clientTrn && <p>TRN: {invoice.clientTrn}</p>}
          {invoice.clientAddress && <p className="break-words text-ink-600">{invoice.clientAddress}</p>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-line bg-ink-50 p-3">
          <dt className="text-ink-500">Invoice date</dt>
          <dd className="font-medium">{formatDate(invoice.invoiceDate)}</dd>
          <dt className="text-ink-500">Terms</dt>
          <dd className="font-medium">{invoice.paymentTerms}</dd>
          <dt className="text-ink-500">Due date</dt>
          <dd className="font-medium">{formatDate(invoice.dueDate)}</dd>
          <dt className="text-ink-500">LPO ref</dt>
          <dd className="break-words font-medium">{invoice.lpoRef || "-"}</dd>
          <dt className="text-ink-500">PC ref</dt>
          <dd className="break-words font-medium">{invoice.pcRef || "-"}</dd>
          <dt className="text-ink-500">Project</dt>
          <dd className="break-words font-medium">{invoice.project || "-"}</dd>
          <dt className="text-ink-500">Scope</dt>
          <dd className="break-words font-medium">{invoice.scope || "-"}</dd>
        </dl>
      </section>

      <div className="mt-5 w-full overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <caption className="sr-only">Invoice lines</caption>
          <thead className="bg-ink-900 text-white">
            <tr>
              <th scope="col" className="px-2 py-2 text-center">#</th>
              <th scope="col" className="px-3 py-2">Item &amp; description</th>
              <th scope="col" className="px-3 py-2 text-right">Area</th>
              <th scope="col" className="px-3 py-2 text-right">Rate (AED)</th>
              <th scope="col" className="px-3 py-2 text-right">Taxable</th>
              <th scope="col" className="px-3 py-2 text-right">VAT 5%</th>
              <th scope="col" className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.lineNo} className="border-b border-line align-top">
                <td className="px-2 py-2 text-center text-ink-500">{l.lineNo}</td>
                <td className="whitespace-pre-wrap break-words px-3 py-2 font-medium">{l.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.quantity)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.rate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.taxable)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.vat)}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">{formatMoney(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="invoice-totals mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-ink-50 p-3">
          <p className="text-xs font-semibold text-ink-500">Total in words</p>
          <p className="mt-0.5 font-bold italic text-ink-900">{invoice.totalInWords}</p>
        </div>
        <dl className="space-y-1">
          <div className="flex justify-between px-1">
            <dt className="font-semibold text-ink-600">Sub total</dt>
            <dd className="font-bold tabular-nums">{formatMoney(invoice.subTotal)}</dd>
          </div>
          <div className="flex justify-between border-b border-line px-1 pb-1">
            <dt className="font-semibold text-ink-600">VAT total (5%)</dt>
            <dd className="font-bold tabular-nums">{formatMoney(invoice.vatTotal)}</dd>
          </div>
          <div className="flex justify-between rounded bg-ink-100 p-2">
            <dt className="font-extrabold">Total</dt>
            <dd className="font-extrabold tabular-nums">AED {formatMoney(invoice.total)}</dd>
          </div>
          {issued && (
            <>
              <div className="flex justify-between px-1">
                <dt className="font-semibold text-ink-600">Paid</dt>
                <dd className="font-bold tabular-nums">{formatMoney(invoice.amountPaid)}</dd>
              </div>
              <div className="flex justify-between rounded border border-teal-200 bg-teal-50 p-2 text-teal-900">
                <dt className="font-extrabold">Balance due</dt>
                <dd className="font-extrabold tabular-nums">AED {formatMoney(invoice.balanceDue)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      <section className="mt-5">
        <h4 className="text-xs font-bold uppercase tracking-wide text-ink-700">Tax summary</h4>
        <table className="mt-1 w-full text-left text-sm">
          <thead className="bg-ink-100">
            <tr>
              <th scope="col" className="px-3 py-1.5">Tax details</th>
              <th scope="col" className="px-3 py-1.5 text-right">Taxable amount (AED)</th>
              <th scope="col" className="px-3 py-1.5 text-right">Tax amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <td className="px-3 py-1.5">Standard rate (5%)</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(invoice.subTotal)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(invoice.vatTotal)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {invoice.notes && (
        <section className="mt-5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-ink-700">Notes</h4>
          <p className="whitespace-pre-wrap break-words text-ink-700">{invoice.notes}</p>
        </section>
      )}

      <footer className="invoice-bank mt-6 grid gap-4 border-t border-ink-300 pt-4 text-xs sm:grid-cols-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="col-span-2 mb-1 text-sm font-bold text-ink-900">Bank details for payment</dt>
          <dt className="text-ink-500">Bank</dt>
          <dd className="break-words font-semibold">{c.bankName || "-"}</dd>
          <dt className="text-ink-500">Account name</dt>
          <dd className="break-words font-semibold">{c.accountName || "-"}</dd>
          <dt className="text-ink-500">Account no.</dt>
          <dd className="break-words font-semibold">{c.accountNumber || "-"}</dd>
          <dt className="text-ink-500">IBAN</dt>
          <dd className="break-words font-semibold">{c.iban || "-"}</dd>
        </dl>
        <div className="flex items-end justify-end">
          <div className="relative w-48 border-t border-ink-400 pt-1 text-center">
            {stamp && <img src={stamp} alt="Company stamp" className="pointer-events-none absolute bottom-full left-1/2 mb-1 h-24 w-24 -translate-x-1/2 object-contain" />}
            <p className="text-xs font-bold text-ink-900">Authorized signature</p>
            <p className="text-[10px] text-ink-500">{c.companyName}</p>
          </div>
        </div>
      </footer>
    </article>
  );
}
