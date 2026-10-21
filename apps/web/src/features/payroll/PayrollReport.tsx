import type { PayrollReport as Report } from "../../api/payroll";

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const headingClass = "px-3 py-3 font-semibold";
/** On phones each cell is a labelled row inside a card; from md up it is an ordinary table cell. */
const cellClass =
  "flex items-center justify-between gap-3 whitespace-nowrap border-t border-gray-100 py-2 text-right tabular-nums before:content-[attr(data-label)] before:text-left before:text-xs before:font-semibold before:uppercase before:text-gray-600 md:table-cell md:border-0 md:px-3 md:py-3 md:before:content-none";

/**
 * The same server response and markup are used on screen and in print. Payslip buttons appear only when the month is
 * finalised and a handler is given; they are hidden from print.
 */
export function PayrollReport({
  report,
  onPayslip,
  payslipBusy,
}: {
  report: Report;
  onPayslip?: (workerId: number) => void;
  payslipBusy?: boolean;
}) {
  const showPayslips = !!onPayslip && report.status === "Finalised";
  return (
    <article
      id="payroll-report"
      className="payroll-report min-w-0 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6"
      aria-label={`Monthly Payroll Report ${report.period}`}
    >
      <header className="payroll-letterhead space-y-2 border-b-2 border-slate-800 pb-5 text-center">
        <p className="break-words text-lg font-bold text-slate-900 max-sm:hidden sm:text-2xl">
          {report.company.companyName}
        </p>
        {report.company.tagline && (
          <p className="break-words text-sm text-gray-700 max-sm:hidden">
            {report.company.tagline}
          </p>
        )}
        <p className="break-words text-sm text-gray-700 max-sm:hidden">
          Email: {report.company.contactEmail} • United Arab Emirates
        </p>
        <h3 className="pt-2 text-lg font-bold text-gray-900">
          Monthly Payroll Report
        </h3>
        <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
          <p>Month: {report.period}</p>
          <span
            className={`rounded-full px-3 py-1 font-semibold ${report.status === "Finalised" ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"}`}
          >
            {report.status}
          </span>
        </div>
        {report.status === "Finalised" && report.finalisedUtc && (
          <p className="break-words text-sm text-gray-700">
            Finalised by {report.finalisedBy} on{" "}
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: "Asia/Dubai",
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(report.finalisedUtc))}{" "}
            (UAE)
          </p>
        )}
      </header>
      <div className="payroll-table-scroll relative mt-5 overflow-x-auto">
        <table className="payroll-table block w-full text-left text-sm text-gray-800 md:table md:min-w-[700px]">
          <caption className="sr-only">
            Payroll in AED for {report.period}
          </caption>
          <colgroup className="hidden md:table-column-group">
            <col className="w-[20%]" />
            <col className="w-[18%]" />
            <col className="w-[10%]" />
            <col className="w-[13%]" />
            <col className="w-[11%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
            {showPayslips && <col className="no-print w-[10%]" />}
          </colgroup>
          <thead className="sr-only border-y border-gray-300 bg-gray-50 md:not-sr-only md:table-header-group">
            <tr className="md:table-row">
              {[
                "Worker Name",
                "Designation",
                "Days Worked",
                "Basic Pay",
                "OT Pay",
                "Deductions",
                "Total Net Salary",
              ].map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  className={`${headingClass} ${index > 1 ? "md:text-right" : ""}`}
                >
                  {label}
                </th>
              ))}
              {showPayslips && (
                <th scope="col" className={`${headingClass} no-print md:text-right`}>
                  Payslip
                </th>
              )}
            </tr>
          </thead>
          <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-gray-200">
            {report.lines.length ? (
              report.lines.map((line) => (
                <tr
                  key={line.workerId}
                  className="block rounded-lg border border-gray-200 bg-white p-3 shadow-sm md:table-row md:rounded-none md:border-0 md:p-0 md:shadow-none"
                >
                  <th scope="row" className="block break-words pb-1 text-left font-semibold md:table-cell md:px-3 md:py-3 md:font-medium">
                    {line.workerName}
                  </th>
                  <td data-label="Designation" className={`${cellClass} md:text-left`}>
                    {line.designation}
                  </td>
                  <td data-label="Days worked" className={cellClass}>{line.daysWorked}</td>
                  <td data-label="Basic pay" className={cellClass}>{money.format(line.basicPay)}</td>
                  <td data-label="OT pay" className={cellClass}>
                    {money.format(line.overtimePay)}
                  </td>
                  <td data-label="Deductions" className={cellClass}>
                    {money.format(line.totalDeductions)}
                  </td>
                  <td data-label="Net salary" className={`${cellClass} font-semibold max-md:text-base max-md:font-bold`}>
                    {money.format(line.netPay)}
                  </td>
                  {showPayslips && (
                    <td className="no-print block pt-3 md:table-cell md:px-3 md:py-3 md:pt-3 md:text-right">
                      <button
                        type="button"
                        onClick={() => onPayslip!(line.workerId)}
                        disabled={payslipBusy}
                        aria-label={`Download payslip for ${line.workerName}`}
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-700 px-3 text-sm font-medium text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                      >
                        Payslip
                      </button>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr className="block md:table-row">
                <td colSpan={showPayslips ? 8 : 7} className="block py-8 text-center text-gray-600 md:table-cell">
                  No workers for this month.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="block border-t-2 border-gray-700 bg-gray-50 font-bold md:table-footer-group md:border-y-2">
            <tr className="block p-3 md:table-row md:p-0">
              <th scope="row" colSpan={3} className="block px-0 py-2 text-left md:table-cell md:px-3 md:py-3">
                TOTAL PAYROLL
              </th>
              <td data-label="Basic pay" className={cellClass}>
                {money.format(report.totals.basicPay)}
              </td>
              <td data-label="OT pay" className={cellClass}>
                {money.format(report.totals.overtimePay)}
              </td>
              <td data-label="Deductions" className={cellClass}>
                {money.format(report.totals.totalDeductions)}
              </td>
              <td data-label="Net salary" className={cellClass}>
                {money.format(report.totals.netPay)}
              </td>
              {showPayslips && <td className="no-print block md:table-cell" />}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="payroll-signatures mt-12 grid gap-10 text-sm sm:grid-cols-2">
        <div>
          <p className="break-words font-semibold">
            Prepared By: {report.company.preparedByLabel}
          </p>
          <div className="mt-12 border-t border-gray-400 pt-2 text-gray-600">
            Signature &amp; Date
          </div>
        </div>
        <div>
          <p className="break-words font-semibold">
            Approved By: {report.company.approvedByLabel}
          </p>
          <div className="mt-12 border-t border-gray-400 pt-2 text-gray-600">
            Signature &amp; Stamp
          </div>
        </div>
      </div>
    </article>
  );
}
