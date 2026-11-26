import { useState } from "react";
import { AlertTriangle, Check, CheckCircle2, FileImage, Users, X } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { approveStaffLeave, rejectStaffLeave, type StaffLeave, type StaffLeaveBalanceRow, type StaffLeaveType } from "../../api/staff";
import { Button, Textarea } from "../../ui";
import { ActionFailure } from "../workers/WorkersFeedback";
import { Avatar } from "./staffKit";
import { DocumentDrawer } from "./LeaveDocument";
import { leaveDates, leaveDay } from "./leaveFormat";
import { errorText } from "./staffUi";

const MIN_REASON = 3;

function DecisionDialog({ request, approve, onClose, onDone }: { request: StaffLeave; approve: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const short = !approve && note.trim().length < MIN_REASON;
  async function submit() {
    setPending(true);
    setFailure(null);
    try {
      await (approve ? approveStaffLeave(request.id, note) : rejectStaffLeave(request.id, note.trim()));
      onDone(`${request.name}: ${request.leaveType} ${approve ? "approved" : "rejected"}.`);
    } catch (e) {
      setFailure(errorText(e));
      setPending(false);
    }
  }
  return (
    <Dialog open onClose={pending ? () => {} : onClose} title={approve ? "Approve leave" : "Reject leave"}>
      <p className="mt-1 text-sm text-ink-600">
        {request.name} · {request.leaveType} · {leaveDates(request.startDate, request.endDate)} ({request.days} working {request.days === 1 ? "day" : "days"})
      </p>
      <p className="mt-2 text-sm text-ink-800">Employee's reason: {request.reason}</p>
      <div className="mt-4">
        <Textarea label={approve ? "Note (optional)" : "Reason for rejecting"} rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        {!approve && <p className="mt-1 text-[13px] text-ink-600">At least {MIN_REASON} characters. The employee sees it.</p>}
        <p className="mt-1 text-[13px] text-ink-600">A decision cannot be undone.</p>
      </div>
      {failure && <div className="mt-3"><ActionFailure message={failure} /></div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
        <Button variant={approve ? "primary" : "danger"} icon={approve ? Check : X} onClick={() => void submit()} disabled={pending || short}>
          {approve ? "Approve" : "Reject"}
        </Button>
      </div>
    </Dialog>
  );
}

/** What the decision turns on: what is left, who else is away, and whether the paperwork is there. */
function Context({ request, balances, others, type }: { request: StaffLeave; balances: Record<number, StaffLeaveBalanceRow[]>; others: StaffLeave[]; type: StaffLeaveType | undefined }) {
  const year = Number(request.startDate.slice(0, 4));
  const oneYear = request.endDate.startsWith(String(year));
  const balance = balances[year]?.find((row) => row.workerId === request.workerId)?.balances.find((b) => b.leaveTypeId === request.leaveTypeId);
  const away = request.department
    ? others.filter((o) => o.workerId !== request.workerId && o.department === request.department && (o.status === "Approved" || o.status === "Pending") && o.startDate <= request.endDate && o.endDate >= request.startDate)
    : [];
  const after = balance ? balance.remaining - request.days : 0;
  return (
    <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
      <li className="text-ink-800">
        {!balance ? (
          <span className="text-ink-600">Balance for {year} is not available.</span>
        ) : !oneYear ? (
          <>{request.leaveType} left in {year}: <strong className="tabular-nums">{balance.remaining}</strong> days. These dates run into the next year.</>
        ) : (
          <>
            {request.leaveType} left in {year}: <strong className="tabular-nums">{balance.remaining}</strong> → <strong className={`tabular-nums ${after < 0 ? "text-danger" : ""}`}>{after}</strong> days after approval
          </>
        )}
      </li>
      <li className={`flex items-start gap-2 ${away.length > 0 ? "text-amber-900" : "text-ink-600"}`}>
        <Users aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
        <span>
          {!request.department
            ? "No department set, so overlap cannot be checked."
            : away.length === 0
              ? `Nobody else in ${request.department} is away or asking for these dates.`
              : `Also away in ${request.department}: ${away.map((o) => `${o.name} (${leaveDates(o.startDate, o.endDate)}${o.status === "Pending" ? ", not yet decided" : ""})`).join("; ")}`}
        </span>
      </li>
      <li>
        {request.hasAttachment ? (
          <span className="flex items-center gap-2 font-medium text-green-800"><CheckCircle2 aria-hidden="true" size={16} />Document attached</span>
        ) : type?.requiresDocument ? (
          <span className="flex items-center gap-2 font-medium text-amber-900"><AlertTriangle aria-hidden="true" size={16} />Document missing</span>
        ) : (
          <span className="text-ink-600">No document (not required for this type).</span>
        )}
      </li>
    </ul>
  );
}

export function LeaveDecisions({ pending, requests, balances, types, onDecided }: {
  pending: StaffLeave[];
  /** Every request, to find who else is away. */
  requests: StaffLeave[];
  /** Balance rows by year. */
  balances: Record<number, StaffLeaveBalanceRow[]>;
  types: StaffLeaveType[];
  onDecided: (message: string) => void;
}) {
  const [deciding, setDeciding] = useState<{ request: StaffLeave; approve: boolean } | null>(null);
  const [viewing, setViewing] = useState<StaffLeave | null>(null);
  if (pending.length === 0) return null;
  return (
    <section aria-label="Waiting for your decision">
      <h3 className="mb-3 font-display text-base font-semibold text-ink-900">Waiting for your decision ({pending.length})</h3>
      <ul className={`grid gap-3 ${pending.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {pending.map((r) => (
          <li key={r.id} aria-label={`${r.name}, ${r.leaveType}`} className="flex flex-col rounded-card border border-amber-300 bg-white p-4 shadow-card">
            <div className="flex items-start gap-3">
              <Avatar name={r.name} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-900">{r.name}</p>
                <p className="text-sm text-ink-600">{r.leaveType} · {r.days} working {r.days === 1 ? "day" : "days"} · asked {leaveDay(r.createdUtc.slice(0, 10))}</p>
                <p className="mt-1 text-sm font-medium text-ink-800">{leaveDates(r.startDate, r.endDate)}</p>
                <p className="mt-2 text-sm text-ink-700">&ldquo;{r.reason}&rdquo;</p>
              </div>
            </div>
            <Context request={r} balances={balances} others={requests} type={types.find((t) => t.id === r.leaveTypeId)} />
            {r.hasAttachment && (
              <button type="button" onClick={() => setViewing(r)} className="-ml-2 inline-flex h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
                <FileImage aria-hidden="true" size={16} /> Open document (photo)
              </button>
            )}
            <div className="mt-auto flex justify-end gap-2 pt-3">
              <Button variant="secondary" icon={X} onClick={() => setDeciding({ request: r, approve: false })}>Reject</Button>
              <Button icon={Check} onClick={() => setDeciding({ request: r, approve: true })}>Approve</Button>
            </div>
          </li>
        ))}
      </ul>
      {viewing && <DocumentDrawer id={viewing.id} title={`${viewing.name}, ${viewing.leaveType}, ${leaveDates(viewing.startDate, viewing.endDate)}`} onClose={() => setViewing(null)} />}
      {deciding && (
        <DecisionDialog
          request={deciding.request}
          approve={deciding.approve}
          onClose={() => setDeciding(null)}
          onDone={(message) => {
            setDeciding(null);
            onDecided(message);
          }}
        />
      )}
    </section>
  );
}
