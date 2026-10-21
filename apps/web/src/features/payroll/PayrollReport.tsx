import type { PayrollReport as Report } from "../../api/payroll";

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const headingClass = "px-3 py-3 font-semibold";
const amountClass = "whitespace-nowrap px-3 py-3 text-right tabular-nums";

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
        <p className="break-words text-xl font-bold text-slate-900 sm:text-2xl">
          {report.company.companyName}
        </p>
        {report.company.tagline && (
          <p className="break-words text-sm text-gray-700">
            {report.company.tagline}
          </p>
        )}
        <p className="break-words text-sm text-gray-700">
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
        <table className="payroll-table w-full min-w-[700px] text-left text-sm text-gray-800">
          <caption className="sr-only">
            Payroll in AED for {report.period}
          </caption>
          <colgroup>
            <col className="w-[20%]" />
            <col className="w-[18%]" />
            <col className="w-[10%]" />
            <col className="w-[13%]" />
            <col className="w-[11%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
            {showPayslips && <col className="no-print w-[10%]" />}
          </colgroup>
          <thead className="border-y border-gray-300 bg-gray-50">
            <tr>
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
                  className={`${headingClass} ${index > 1 ? "text-right" : ""}`}
                >
                  {label}
                </th>
              ))}
              {showPayslips && (
                <th scope="col" className={`${headingClass} no-print text-right`}>
                  Payslip
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {report.lines.length ? (
              report.lines.map((line) => (
                <tr key={line.workerId}>
                  <th scope="row" className="break-words px-3 py-3 font-medium">
                    {line.workerName}
                  </th>
                  <td className="break-words px-3 py-3">{line.designation}</td>
                  <td className={amountClass}>{line.daysWorked}</td>
                  <td className={amountClass}>{money.format(line.basicPay)}</td>
                  <td className={amountClass}>
                    {money.format(line.overtimePay)}
                  </td>
                  <td className={amountClass}>
                    {money.format(line.totalDeductions)}
                  </td>
                  <td className={`${amountClass} font-semibold`}>
                    {money.format(line.netPay)}
                  </td>
                  {showPayslips && (
                    <td className="no-print px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onPayslip!(line.workerId)}
                        disabled={payslipBusy}
                        aria-label={`Download payslip for ${line.workerName}`}
                        className="inline-flex min-h-11 items-center rounded-lg border border-slate-700 px-3 text-sm font-medium text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Payslip
                      </button>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={showPayslips ? 8 : 7} className="py-8 text-center text-gray-600">
                  No workers for this month.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-y-2 border-gray-700 bg-gray-50 font-bold">
            <tr>
              <th scope="row" colSpan={3} className="px-3 py-3">
                TOTAL PAYROLL
              </th>
              <td className={amountClass}>
                {money.format(report.totals.basicPay)}
              </td>
              <td className={amountClass}>
                {money.format(report.totals.overtimePay)}
              </td>
              <td className={amountClass}>
                {money.format(report.totals.totalDeductions)}
              </td>
              <td className={amountClass}>
                {money.format(report.totals.netPay)}
              </td>
              {showPayslips && <td className="no-print" />}
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
