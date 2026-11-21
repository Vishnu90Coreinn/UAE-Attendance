import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { getStaffPayroll, getStaffPayrollFile, getStaffPayslip, type StaffPayrollSummary } from "../../api/staff";
import { Button, Card, CardHeader, Input, LoadingState, PageHeader } from "../../ui";
import { formatRate } from "../../utils/money";
import { saveBlob } from "../payroll/downloadPdf";
import { ActionFailure } from "../workers/WorkersFeedback";
import { Avatar, RateBar } from "./staffKit";
import { errorText, formatMoney, hoursText, todayInUae } from "./staffUi";

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
  const [busyId, setBusyId] = useState<number | null>(null);
  const { user } = useAuth();
  /** Only a Manager or Administrator issues payslips. */
  const canIssue = isManagement(user?.role);

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

  async function payslip(workerId?: number, code?: string) {
    setFailure(null);
    setBusyId(workerId ?? 0);
    try {
      saveBlob(await getStaffPayslip(month, workerId), workerId ? `Staff_Payslip_${month}_${code}.pdf` : `Staff_Payslips_${month}.pdf`);
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setBusyId(null);
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
            {canIssue && (
              <Button icon={FileText} onClick={() => void payslip()} disabled={!summary || summary.rows.length === 0 || busyId !== null}>
                All payslips
              </Button>
            )}
          </>
        }
      />
      {failure && <ActionFailure message={failure} />}
      {!summary && !failure && <LoadingState label="Loading..." withCards />}
      {summary && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Total label="Salaries" value={formatMoney(summary.totalSalary)} />
            <Total label="Deductions" value={formatMoney(summary.totalDeductions)} />
            <Total label="Net payable" value={formatMoney(summary.totalNet)} strong />
          </div>
          <Card>
            <CardHeader
              title={summary.label}
              description={rules.length > 0 ? rules.join(" ") : "No deductions are applied. A Manager can set deduction rules in Settings."}
            />
            {summary.rows.length === 0 ? (
              <p className="px-5 py-8 text-sm text-ink-600">No office employees yet.</p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-ink-50 text-xs uppercase text-ink-600">
                    <tr>
                      <th className="px-4 py-2.5">Employee</th>
                      <th className="px-4 py-2.5 text-right">Salary</th>
                      <th className="px-4 py-2.5 text-right">Attendance</th>
                      <th className="px-4 py-2.5">Absence and late</th>
                      <th className="px-4 py-2.5 text-right">Hours</th>
                      <th className="px-4 py-2.5 text-right">Net</th>
                      {canIssue && <th className="px-4 py-2.5"><span className="sr-only">Payslip</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((r) => {
                      const expected = r.presentDays + r.absentDays + r.leaveDays;
                      return (
                        <tr key={r.workerId} className="border-t border-line">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <Avatar name={r.name} size="sm" />
                              <div className="min-w-0">
                                <div className="whitespace-nowrap font-medium text-ink-900">{r.name}</div>
                                <div className="whitespace-nowrap font-mono text-xs text-ink-600">{r.code}{r.department ? ` · ${r.department}` : ""}</div>
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatMoney(r.monthlySalary)}</td>
                          <td className="px-4 py-3">
                            <RateBar value={expected > 0 ? ((r.presentDays + r.leaveDays) / expected) * 100 : null} label={`${r.presentDays} present, ${r.leaveDays} on leave, ${r.absentDays} absent`} />
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                            <span className={r.absentDays > 0 ? "font-medium text-red-800" : ""}>{r.absentDays} absent</span>
                            {r.leaveDays > 0 && (
                              <>
                                <span className="text-ink-400"> · </span>
                                {r.leaveDays} on leave
                              </>
                            )}
                            <span className="text-ink-400"> · </span>
                            <span className={r.lateMinutes > 0 ? "font-medium text-amber-800" : ""}>{r.lateMinutes} min late</span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{hoursText(r.totalHours)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <div className="text-base font-semibold tabular-nums text-ink-900">{formatMoney(r.netSalary)}</div>
                            {r.absentDeduction + r.lateDeduction > 0 && (
                              <div className="text-xs tabular-nums text-ink-600">after {formatMoney(r.absentDeduction + r.lateDeduction)} deducted</div>
                            )}
                          </td>
                          {canIssue && (
                            <td className="px-4 py-3 text-right">
                              <Button size="sm" variant="secondary" icon={FileText} aria-label={`Payslip for ${r.name}`} disabled={busyId !== null} onClick={() => void payslip(r.workerId, r.code)}>
                                Payslip
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
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
