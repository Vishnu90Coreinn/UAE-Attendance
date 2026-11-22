import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Download, X } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement, isReadOnly } from "../../permissions";
import {
  addLeaveType, approveStaffLeave, getLeaveBalances, getStaffLeaveFile, listLeaveTypes, listStaffLeave, rejectStaffLeave, updateLeaveType,
  type StaffLeave, type StaffLeaveBalanceRow, type StaffLeaveType,
} from "../../api/staff";
import { Button, Card, CardHeader, Input, LoadingState, PageHeader, Select, StatusBadge, Textarea, type StatusTone } from "../../ui";
import { saveBlob } from "../payroll/downloadPdf";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { Avatar, BalanceBar } from "./staffKit";
import { DocumentButton } from "./LeaveDocument";
import { errorText, shortDate } from "./staffUi";

const STATUS_TONE: Record<StaffLeave["status"], StatusTone> = { Pending: "warning", Approved: "success", Rejected: "danger", Cancelled: "neutral" };

function DecisionDialog({ request, approve, onClose, onDone }: { request: StaffLeave; approve: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function submit() {
    setPending(true);
    setFailure(null);
    try {
      await (approve ? approveStaffLeave(request.id, note) : rejectStaffLeave(request.id, note));
      onDone(approve ? "Leave approved." : "Leave rejected.");
    } catch (e) {
      setFailure(errorText(e));
      setPending(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={approve ? "Approve leave" : "Reject leave"}>
      <p className="mt-1 text-sm text-ink-600">
        {request.name} · {request.leaveType} · {shortDate(request.startDate)} to {shortDate(request.endDate)} ({request.days} days)
      </p>
      <p className="mt-2 text-sm text-ink-800">Reason: {request.reason}</p>
      <div className="mt-4">
        <Textarea label={approve ? "Note (optional)" : "Reason for rejecting"} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {failure && <div className="mt-3"><ActionFailure message={failure} /></div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
        <Button variant={approve ? "primary" : "danger"} icon={approve ? Check : X} onClick={() => void submit()} disabled={pending || (!approve && !note.trim())}>
          {approve ? "Approve" : "Reject"}
        </Button>
      </div>
    </Dialog>
  );
}

function LeaveTypesCard({ types, onChanged, setFailure }: { types: StaffLeaveType[]; onChanged: () => void; setFailure: (m: string | null) => void }) {
  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [needsDoc, setNeedsDoc] = useState(false);
  async function add() {
    setFailure(null);
    try {
      await addLeaveType(name, Number(days), needsDoc);
      setName("");
      setDays("");
      setNeedsDoc(false);
      onChanged();
    } catch (e) {
      setFailure(errorText(e));
    }
  }
  async function change(type: StaffLeaveType, patch: Partial<StaffLeaveType>) {
    setFailure(null);
    const next = { ...type, ...patch };
    try {
      await updateLeaveType(type.id, next.name, next.yearlyDays, next.isActive, next.requiresDocument);
      onChanged();
    } catch (e) {
      setFailure(errorText(e));
    }
  }
  return (
    <Card className="mb-6">
      <CardHeader title="Leave types" description="The yearly entitlement for each type. Changes apply to every employee." />
      <ul className="divide-y divide-line">
        {types.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className={`min-w-40 flex-1 font-medium ${t.isActive ? "text-ink-900" : "text-ink-500 line-through"}`}>{t.name}</span>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              Days a year
              <input
                type="number"
                min={0}
                max={366}
                defaultValue={t.yearlyDays}
                aria-label={`Yearly days for ${t.name}`}
                onBlur={(e) => Number(e.target.value) !== t.yearlyDays && void change(t, { yearlyDays: Number(e.target.value) })}
                className="min-h-10 w-20 rounded-lg border border-ink-300 px-2 text-right"
              />
            </label>
            <label className="flex min-h-9 items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={t.requiresDocument} onChange={(e) => void change(t, { requiresDocument: e.target.checked })} className="size-4 rounded border-ink-300 accent-brand-600" />
              Document required
            </label>
            <Button size="sm" variant="secondary" onClick={() => void change(t, { isActive: !t.isActive })}>
              {t.isActive ? "Switch off" : "Switch on"}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3 border-t border-line p-5">
        <Input label="New leave type" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Days a year" type="number" min={0} max={366} value={days} onChange={(e) => setDays(e.target.value)} />
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={needsDoc} onChange={(e) => setNeedsDoc(e.target.checked)} className="size-4 rounded border-ink-300 accent-brand-600" />
          Document required
        </label>
        <Button onClick={() => void add()} disabled={!name.trim() || days === ""}>Add type</Button>
      </div>
    </Card>
  );
}

export function StaffLeavePage() {
  const { user } = useAuth();
  const canDecide = isManagement(user?.role);
  const readOnly = isReadOnly(user?.role);
  const [requests, setRequests] = useState<StaffLeave[] | null>(null);
  const [balances, setBalances] = useState<StaffLeaveBalanceRow[]>([]);
  const [types, setTypes] = useState<StaffLeaveType[]>([]);
  const [status, setStatus] = useState("");
  const [department, setDepartment] = useState("");
  const year = new Date().getFullYear();
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ request: StaffLeave; approve: boolean } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, bal, kinds] = await Promise.all([listStaffLeave({ status: status || undefined, department: department || undefined, year }), getLeaveBalances(year, department || undefined), listLeaveTypes()]);
      setRequests(list);
      setBalances(bal);
      setTypes(kinds);
    } catch (e) {
      setError(errorText(e));
    }
  }, [status, department, year]);
  useEffect(() => {
    void load();
  }, [load]);

  const departments = useMemo(() => [...new Set(balances.map((b) => b.department).filter((d): d is string => !!d))].sort(), [balances]);
  const activeTypes = types.filter((t) => t.isActive);

  async function download(format: "pdf" | "excel") {
    setFailure(null);
    try {
      saveBlob(await getStaffLeaveFile(format, year, department || undefined), `Staff_Leave_${year}.${format === "pdf" ? "pdf" : "xlsx"}`);
    } catch (e) {
      setFailure(errorText(e));
    }
  }

  if (error) return <LoadError message={error} onRetry={() => void load()} />;
  if (!requests) return <LoadingState label="Loading..." />;

  return (
    <section>
      <PageHeader
        title="Staff Leave"
        description={canDecide ? "Approve or reject leave requested by office employees." : "Leave requests and balances for office employees."}
        actions={
          <>
            <Button variant="secondary" icon={Download} onClick={() => void download("excel")}>Excel</Button>
            <Button variant="secondary" icon={Download} onClick={() => void download("pdf")}>PDF</Button>
          </>
        }
      />
      <SuccessRegion message={success} />
      {failure && <div className="mb-3"><ActionFailure message={failure} /></div>}

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="min-w-44">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {["Pending", "Approved", "Rejected", "Cancelled"].map((s) => <option key={s}>{s}</option>)}
          </Select>
        </div>
        {departments.length > 0 && (
          <div className="min-w-44">
            <Select label="Department" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d}>{d}</option>)}
            </Select>
          </div>
        )}
      </div>

      {canDecide && requests.some((r) => r.status === "Pending") && (
        <div className="mb-6">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-600">Waiting for your decision</h3>
          <ul className="grid gap-3 lg:grid-cols-2">
            {requests.filter((r) => r.status === "Pending").map((r) => (
              <li key={r.id} className="rounded-card border border-amber-300 bg-white p-4 shadow-card">
                <div className="flex items-start gap-3">
                  <Avatar name={r.name} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink-900">{r.name}</p>
                    <p className="text-sm text-ink-600">{r.leaveType} · {r.days} working day{r.days === 1 ? "" : "s"}</p>
                    <p className="mt-1 text-sm font-medium text-ink-800">{shortDate(r.startDate)} to {shortDate(r.endDate)}</p>
                    <p className="mt-2 text-sm text-ink-700">&ldquo;{r.reason}&rdquo;</p>
                    {r.hasAttachment && <div className="mt-1 -ml-2"><DocumentButton id={r.id} own={false} title={`${r.name}, ${r.leaveType}`} /></div>}
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="secondary" icon={X} onClick={() => setDeciding({ request: r, approve: false })}>Reject</Button>
                  <Button icon={Check} onClick={() => setDeciding({ request: r, approve: true })}>Approve</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card className="mb-6">
        <CardHeader title="All requests" description={canDecide ? "Pending requests are decided in the cards above." : undefined} />
        {requests.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-600">No leave requests.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50 text-xs uppercase text-ink-600">
                <tr>
                  <th className="px-4 py-2">Employee</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Dates</th>
                  <th className="px-4 py-2 text-right">Days</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="px-4 py-2"><div className="flex items-center gap-3"><Avatar name={r.name} size="sm" /><div><div className="whitespace-nowrap font-medium text-ink-900">{r.name}</div><div className="whitespace-nowrap font-mono text-xs text-ink-600">{r.code}{r.department ? ` · ${r.department}` : ""}</div></div></div></td>
                    <td className="whitespace-nowrap px-4 py-2">{r.leaveType}</td>
                    <td className="whitespace-nowrap px-4 py-2">{shortDate(r.startDate)} to {shortDate(r.endDate)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.days}</td>
                    <td className="px-4 py-2"><StatusBadge tone={STATUS_TONE[r.status]} variant="soft">{r.status}</StatusBadge></td>
                    <td className="max-w-xs px-4 py-2 text-ink-700">{r.reason}{r.hasAttachment && <div><DocumentButton id={r.id} own={false} title={`${r.name}, ${r.leaveType}`} /></div>}{r.decisionNote && <div className="text-xs text-ink-600">{r.decidedBy}: {r.decisionNote}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mb-6">
        <CardHeader title={`Leave balances ${year}`} description="Days used (approved) and days left, per leave type." />
        {balances.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-600">No office employees yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50 text-xs uppercase text-ink-600">
                <tr>
                  <th className="px-4 py-2">Employee</th>
                  {balances[0].balances.map((b) => <th key={b.leaveTypeId} className="px-4 py-2 text-right">{b.leaveType}</th>)}
                </tr>
              </thead>
              <tbody>
                {balances.map((row) => (
                  <tr key={row.workerId} className="border-t border-line">
                    <td className="px-4 py-2"><div className="font-medium text-ink-900">{row.name}</div><div className="text-xs text-ink-600">{row.code}</div></td>
                    {row.balances.map((b) => <td key={b.leaveTypeId} className="min-w-32 px-4 py-2"><div className="mb-1 text-right text-xs tabular-nums text-ink-600"><strong className="text-sm text-ink-900">{b.remaining}</strong> left · {b.used} used</div><BalanceBar used={b.used} pending={b.pending} total={b.entitlement} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canDecide && !readOnly && <LeaveTypesCard types={types} onChanged={() => void load()} setFailure={setFailure} />}
      {activeTypes.length === 0 && <p className="text-sm text-amber-800">No leave type is switched on, so employees cannot request leave.</p>}

      {deciding && (
        <DecisionDialog
          request={deciding.request}
          approve={deciding.approve}
          onClose={() => setDeciding(null)}
          onDone={(message) => {
            setDeciding(null);
            setSuccess(message);
            void load();
          }}
        />
      )}
    </section>
  );
}
