import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { getStaffPayroll, getStaffPayrollFile, type StaffPayrollSummary } from "../../api/staff";
import { Button, Card, CardHeader, Input, LoadingState, PageHeader } from "../../ui";
import { formatRate } from "../../utils/money";
import { saveBlob } from "../payroll/downloadPdf";
import { ActionFailure } from "../workers/WorkersFeedback";
import { Avatar } from "./staffKit";
import { errorText, hoursText, todayInUae } from "./staffUi";

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-card border p-4 ${strong ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white"}`}>
      <p className={`text-xs font-medium uppercase tracking-wide ${strong ? "text-brand-100" : "text-ink-600"}`}>{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {value} <span className={`text-sm font-normal ${strong ? "text-brand-100" : "text-ink-600"}`}>AED</span>
      </p>
    </div>
  );
}

/** The office employees' payroll summary. Kept apart from the site workers' payroll. */
export function StaffPayrollPage() {
  const [month, setMonth] = useState(todayInUae().slice(0, 7));
  const [summary, setSummary] = useState<StaffPayrollSummary | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setFailure(null);
    getStaffPayroll(month)
      .then((s) => !cancelled && setSummary(s))
      .catch((e) => !cancelled && setFailure(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [month]);

  async function download(format: "pdf" | "excel") {
    setFailure(null);
    try {
      saveBlob(await getStaffPayrollFile(format, month), `Staff_Payroll_${month}.${format === "pdf" ? "pdf" : "xlsx"}`);
    } catch (e) {
      setFailure(errorText(e));
    }
  }

  const rules = summary
    ? [summary.deductAbsentDays ? "Each absent day costs one day of pay (salary / 30)." : null, summary.lateDeductionPerMinute > 0 ? `Late arrival costs ${formatRate(summary.lateDeductionPerMinute)} AED per minute.` : null].filter((r): r is string => r !== null)
    : [];

  return (
    <section>
      <PageHeader
        title="Staff Payroll Summary"
        description="Monthly salary beside attendance for office employees. Site workers have their own Payroll Summary."
        actions={
          <>
            <Input label="Month" type="month" value={month} max={todayInUae().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            <Button variant="secondary" icon={Download} onClick={() => void download("excel")} disabled={!summary}>Excel</Button>
            <Button variant="secondary" icon={Download} onClick={() => void download("pdf")} disabled={!summary}>PDF</Button>
          </>
        }
      />
      {failure && <ActionFailure message={failure} />}
      {!summary && !failure && <LoadingState label="Loading..." withCards />}
      {summary && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Total label="Salaries" value={formatRate(summary.totalSalary)} />
            <Total label="Deductions" value={formatRate(summary.totalDeductions)} />
            <Total label="Net payable" value={formatRate(summary.totalNet)} strong />
          </div>
          <Card>
            <CardHeader
              title={summary.label}
              description={rules.length > 0 ? rules.join(" ") : "No deductions are applied. A Manager can set deduction rules in Settings."}
            />
            {summary.rows.length === 0 ? (
              <p className="px-5 py-8 text-sm text-ink-600">No office employees yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-ink-50 text-xs uppercase text-ink-600">
                    <tr>
                      <th className="px-4 py-2">Employee</th>
                      <th className="px-4 py-2 text-right">Salary</th>
                      <th className="px-4 py-2 text-right">Present / days</th>
                      <th className="px-4 py-2 text-right">Absent</th>
                      <th className="px-4 py-2 text-right">Leave</th>
                      <th className="px-4 py-2 text-right">Late min</th>
                      <th className="px-4 py-2 text-right">Hours</th>
                      <th className="px-4 py-2 text-right">Deductions</th>
                      <th className="px-4 py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((r) => (
                      <tr key={r.workerId} className="border-t border-line">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-3">
                            <Avatar name={r.name} size="sm" />
                            <div>
                              <div className="font-medium text-ink-900">{r.name}</div>
                              <div className="font-mono text-xs text-ink-600">{r.code}{r.department ? ` · ${r.department}` : ""}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatRate(r.monthlySalary)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.presentDays} / {r.workingDays}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.absentDays}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.leaveDays}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.lateMinutes}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{hoursText(r.totalHours)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-700">{r.absentDeduction + r.lateDeduction > 0 ? `-${formatRate(r.absentDeduction + r.lateDeduction)}` : "-"}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink-900">{formatRate(r.netSalary)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </section>
  );
}
