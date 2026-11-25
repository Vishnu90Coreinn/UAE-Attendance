import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, MapPinOff, TriangleAlert, Clock, UserX, ChevronRight } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { isReadOnly } from "../../permissions";
import {
  getStaffDashboard, getStaffDay, getStaffReport, getStaffReportFile,
  type StaffDashboard, type StaffDayRow, type StaffReport,
} from "../../api/staff";
import { Button, Card, CardHeader, Input, LoadingState, PageHeader, Select } from "../../ui";
import { Avatar, LiveDot, RateBar, Segmented, SegmentBar } from "./staffKit";
import { saveBlob } from "../payroll/downloadPdf";
import { ActionFailure, LoadError } from "../workers/WorkersFeedback";
import { StaffDayDialog } from "./StaffDayDialog";
import { addDays, DayFlags, errorText, hoursText, shortDate, StaffStatusBadge, todayInUae } from "./staffUi";

type Period = "day" | "week" | "month" | "custom";

function rangeFor(period: Period, anchor: string, from: string, to: string): [string, string] {
  if (period === "day") return [anchor, anchor];
  if (period === "week") return [addDays(anchor, -6), anchor];
  if (period === "month") return [`${anchor.slice(0, 8)}01`, anchor];
  return [from, to];
}

export function StaffAttendancePage() {
  const { user } = useAuth();
  const canEdit = !isReadOnly(user?.role);
  const [dash, setDash] = useState<StaffDashboard | null>(null);
  const [rows, setRows] = useState<StaffDayRow[]>([]);
  const [date, setDate] = useState(todayInUae());
  const [department, setDepartment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [open, setOpen] = useState<{ workerId: number; date: string } | null>(null);

  const [period, setPeriod] = useState<Period>("month");
  const [from, setFrom] = useState(addDays(todayInUae(), -30));
  const [to, setTo] = useState(todayInUae());
  const [report, setReport] = useState<StaffReport | null>(null);

  const loadDay = useCallback(async () => {
    setError(null);
    try {
      const [d, list] = await Promise.all([getStaffDashboard(), getStaffDay(date, department || undefined)]);
      setDash(d);
      setRows(list);
    } catch (e) {
      setError(errorText(e));
    }
  }, [date, department]);
  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  const [reportFrom, reportTo] = rangeFor(period, date, from, to);
  useEffect(() => {
    let cancelled = false;
    getStaffReport(reportFrom, reportTo, department || undefined)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setFailure(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [reportFrom, reportTo, department]);

  /** Only today's rows can be "in now", so this is 0 when another date is chosen. */
  const inOfficeNow = rows.filter((r) => r.day.inNow).length;

  const departments = useMemo(() => [...new Set(rows.map((r) => r.department).filter((d): d is string => !!d))].sort(), [rows]);

  async function download(format: "pdf" | "excel") {
    setFailure(null);
    try {
      saveBlob(await getStaffReportFile(format, reportFrom, reportTo, department || undefined), `Staff_Attendance_${reportFrom}_${reportTo}.${format === "pdf" ? "pdf" : "xlsx"}`);
    } catch (e) {
      setFailure(errorText(e));
    }
  }

  if (error) return <LoadError message={error} onRetry={() => void loadDay()} />;
  if (!dash) return <LoadingState label="Loading..." withCards />;

  return (
    <section>
      <PageHeader title="Staff Attendance" description="Office employees: who has signed in, who is late, and who needs a correction." />
      {failure && <div className="mb-3"><ActionFailure message={failure} /></div>}

      <Card className="mb-6">
        <CardHeader
          title="Roll call"
          description={`${shortDate(dash.date)}${dash.dayType ? ` · ${dash.dayType}` : ""} · ${dash.total} office employee${dash.total === 1 ? "" : "s"}`}
        />
        <div className="grid gap-6 p-5 lg:grid-cols-[auto_1fr] lg:items-center">
          <div className="flex items-end gap-6">
            <div>
              <p className="font-display text-5xl font-semibold leading-none tabular-nums text-ink-900">
                {dash.signedIn}
                <span className="text-2xl font-normal text-ink-500"> / {dash.total}</span>
              </p>
              <p className="mt-1 text-sm text-ink-600">signed in today</p>
            </div>
            <div className="border-l border-line pl-6">
              <p className="flex items-center gap-2 font-display text-3xl font-semibold leading-none tabular-nums text-ink-900">
                {inOfficeNow > 0 && <LiveDot />}
                {inOfficeNow}
              </p>
              <p className="mt-1 text-sm text-ink-600">in the office now</p>
            </div>
          </div>
          <SegmentBar
            total={dash.total}
            segments={[
              { label: "Signed in", value: dash.signedIn - dash.late, cls: "bg-green-600" },
              { label: "Late", value: dash.late, cls: "bg-amber-500" },
              { label: "On leave", value: dash.onLeave, cls: "bg-sky-600" },
              { label: "Not in yet", value: dash.notInYet, cls: "bg-ink-300" },
              { label: "Absent", value: dash.absent, cls: "bg-red-700" },
            ]}
          />
        </div>
      </Card>

      {dash.attention.length > 0 && (
        <Card className="mb-6 border-amber-300">
          <CardHeader title="Needs your attention" description="Late arrivals, sign-ins outside the office, forgotten sign-outs and absences today." />
          <ul className="divide-y divide-line">
            {dash.attention.map((r) => (
              <li key={r.workerId}>
                <button
                  type="button"
                  onClick={() => setOpen({ workerId: r.workerId, date: dash.date })}
                  className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-500"
                >
                  <Avatar name={r.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink-900">{r.name}</span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-ink-700">
                      {r.day.status === "Absent" && <span className="inline-flex items-center gap-1"><UserX aria-hidden="true" size={14} /> Absent</span>}
                      {r.day.isLate && <span className="inline-flex items-center gap-1"><Clock aria-hidden="true" size={14} /> {r.day.lateMinutes} min late</span>}
                      {r.day.outsideOffice && <span className="inline-flex items-center gap-1"><MapPinOff aria-hidden="true" size={14} /> Outside office</span>}
                      {r.day.missingSignOut && <span className="inline-flex items-center gap-1"><TriangleAlert aria-hidden="true" size={14} /> No sign-out</span>}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-ink-400" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader
          title="Daily attendance"
          actions={
            <div className="flex flex-wrap items-end gap-3">
              <Input label="Date" type="date" value={date} max={todayInUae()} onChange={(e) => e.target.value && setDate(e.target.value)} />
              {departments.length > 0 && (
                <Select label="Department" value={department} onChange={(e) => setDepartment(e.target.value)}>
                  <option value="">All</option>
                  {departments.map((d) => <option key={d}>{d}</option>)}
                </Select>
              )}
            </div>
          }
        />
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-600">No office employees to show. Add employees in the Worker Directory by choosing the Office employee category.</p>
        ) : (
          <>
          <ul className="divide-y divide-line md:hidden">
            {rows.map((r) => (
              <li key={r.workerId}>
                <button
                  type="button"
                  onClick={() => setOpen({ workerId: r.workerId, date })}
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-500"
                >
                  <Avatar name={r.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink-900">{r.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-600">
                      {r.day.inNow && <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-800"><LiveDot />In now</span>}
                      <StaffStatusBadge status={r.day.status} />
                      <DayFlags day={r.day} />
                    </span>
                    <span className="mt-1 block font-mono text-xs tabular-nums text-ink-600">
                      {r.day.firstIn ?? "--:--"} to {r.day.lastOut ?? "--:--"}{r.day.hours ? ` · ${hoursText(r.day.hours)}` : ""}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-ink-400" />
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50 text-xs uppercase text-ink-600">
                <tr><th className="px-4 py-2">Employee</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">In</th><th className="px-4 py-2">Out</th><th className="px-4 py-2 text-right">Hours</th><th className="px-4 py-2" /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.workerId} className="border-t border-line">
                    <td className="px-4 py-2"><div className="flex items-center gap-3"><Avatar name={r.name} size="sm" /><div><div className="font-medium text-ink-900">{r.name}</div><div className="font-mono text-xs text-ink-600">{r.code}{r.department ? ` · ${r.department}` : ""}</div></div></div></td>
                    <td className="px-4 py-2"><div className="flex flex-wrap items-center gap-2">{r.day.inNow && <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-800"><LiveDot />In now</span>}<StaffStatusBadge status={r.day.status} /><DayFlags day={r.day} /></div></td>
                    <td className="px-4 py-2 tabular-nums">{r.day.firstIn ?? "-"}</td>
                    <td className="px-4 py-2 tabular-nums">{r.day.lastOut ?? "-"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.day.hours ? r.day.hours.toFixed(2) : "-"}</td>
                    <td className="px-4 py-2 text-right"><Button size="sm" variant="secondary" onClick={() => setOpen({ workerId: r.workerId, date })}>{canEdit && r.workerId !== user?.employeeId ? "Review" : "View"}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Report"
          description={reportFrom === reportTo ? shortDate(reportFrom) : `${shortDate(reportFrom)} to ${shortDate(reportTo)}`}
          actions={
            <>
              <Button variant="secondary" icon={Download} onClick={() => void download("excel")}>Excel</Button>
              <Button variant="secondary" icon={Download} onClick={() => void download("pdf")}>PDF</Button>
            </>
          }
        />
        <div className="flex flex-wrap items-end gap-4 px-5 pt-4">
          <Segmented
            label="Report period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "7 days" },
              { value: "month", label: "Month to date" },
              { value: "custom", label: "Custom" },
            ]}
          />
          {period === "custom" && (
            <>
              <Input label="From" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
              <Input label="To" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </>
          )}
        </div>
        <div className="overflow-x-auto p-2">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50 text-xs uppercase text-ink-600">
              <tr>
                <th className="px-3 py-2">Employee</th><th className="px-3 py-2 text-right">Attendance</th><th className="px-3 py-2 text-right">Present</th><th className="px-3 py-2 text-right">Late</th>
                <th className="px-3 py-2 text-right">Late min</th><th className="px-3 py-2 text-right">Early min</th><th className="px-3 py-2 text-right">Absent</th>
                <th className="px-3 py-2 text-right">Leave</th><th className="px-3 py-2 text-right">Hours</th>
              </tr>
            </thead>
            <tbody>
              {(report?.rows ?? []).map((r) => (
                <tr key={r.workerId} className="border-t border-line">
                  <td className="px-3 py-2"><div className="whitespace-nowrap font-medium text-ink-900">{r.name}</div><div className="font-mono text-xs text-ink-600">{r.code}</div></td>
                  <td className="px-3 py-2"><RateBar value={r.presentDays + r.leaveDays + r.absentDays > 0 ? ((r.presentDays + r.leaveDays) / (r.presentDays + r.leaveDays + r.absentDays)) * 100 : null} label="Days present or on leave, of days expected" /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.presentDays}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.lateDays > 0 ? "font-medium text-amber-800" : ""}`}>{r.lateDays}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.lateMinutes > 0 ? "text-amber-800" : ""}`}>{r.lateMinutes}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.earlyLeaveMinutes}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.absentDays > 0 ? "font-medium text-red-800" : ""}`}>{r.absentDays}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.leaveDays}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{hoursText(r.totalHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {open && <StaffDayDialog workerId={open.workerId} date={open.date} canEdit={canEdit && open.workerId !== user?.employeeId} onClose={() => setOpen(null)} onChanged={() => void loadDay()} />}
    </section>
  );
}
