import { useState, type FormEvent } from "react";
import { Ban, CalendarPlus, Check, Hourglass, Loader2, Palmtree, X, type LucideIcon } from "lucide-react";
import type { LeaveRequestInput, StaffLeave, StaffMyLeave } from "../../api/staff";
import { Dialog } from "../../components/Dialog";
import { Fab, PAGE_GAP, PhoneTitle, phoneButton } from "../../components/phoneUi";
import { ActionFailure } from "../workers/WorkersFeedback";
import { formatRange } from "../leave/LeavePhone";
import { DocumentButton, DocumentPicker, type PickedDocument } from "./LeaveDocument";
import { BalanceBar } from "./staffKit";
import { calendarDays, todayInUae } from "./staffUi";

const STATUS: Record<StaffLeave["status"], { tone: string; icon: LucideIcon }> = {
  Pending: { tone: "bg-amber-100 text-amber-900", icon: Hourglass },
  Approved: { tone: "bg-brand-100 text-brand-800", icon: Check },
  Rejected: { tone: "bg-red-100 text-red-800", icon: X },
  Cancelled: { tone: "bg-ink-100 text-ink-700", icon: Ban },
};

function Pill({ status }: { status: StaffLeave["status"] }) {
  const { tone, icon: Icon } = STATUS[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
      <Icon aria-hidden="true" size={13} strokeWidth={3} />
      {status}
    </span>
  );
}

const fieldClass =
  "mt-1.5 min-h-12 w-full rounded-xl border border-ink-300 bg-white px-3 text-base text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60";

/**
 * My Leave on a phone: what is left first as four small tiles, then the requests as a list with their status in words,
 * and one floating button that opens the request as a sheet. The form no longer sits under the balances.
 */
export function MyLeavePhone({
  data,
  onSend,
  onCancel,
}: {
  data: StaffMyLeave;
  /** Sends the request; throws an Error whose message is shown in the sheet. */
  onSend: (input: LeaveRequestInput) => Promise<void>;
  onCancel: (request: StaffLeave) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState<StaffLeave | null>(null);
  return (
    <section className={`${PAGE_GAP} pb-20`}>
      <PhoneTitle title="My Leave" subtitle="Sundays and public holidays are not counted." />

      <ul aria-label="Leave balances" className="grid grid-cols-2 gap-3">
        {data.balances.map((b) => (
          <li key={b.leaveTypeId} className="rounded-2xl border border-line bg-white p-3.5 shadow-card">
            <p className="truncate text-sm font-semibold text-ink-700">{b.leaveType}</p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="font-display text-3xl font-bold leading-none tabular-nums text-ink-900">{b.remaining}</span>
              <span className="text-sm text-ink-600">of {b.entitlement} left</span>
            </p>
            <div className="mt-2.5">
              <BalanceBar used={b.used} pending={b.pending} total={b.entitlement} />
            </div>
            <p className="mt-1.5 text-sm text-ink-600">
              {b.used} used{b.pending > 0 ? ` · ${b.pending} pending` : ""}
            </p>
          </li>
        ))}
      </ul>

      <div>
        <h3 className="mb-2 px-1 text-sm font-bold text-ink-800">My requests</h3>
        {data.requests.length === 0 ? (
          <div className="rounded-3xl border border-line bg-white p-6 text-center shadow-card">
            <Palmtree aria-hidden="true" size={28} className="mx-auto text-brand-700" />
            <p className="mt-2 font-semibold text-ink-900">No leave requested yet</p>
            <p className="mt-1 text-sm text-ink-600">Your requests and their decisions will appear here.</p>
            <button type="button" onClick={() => setAsking(true)} className={phoneButton("primary", "md", "mt-4")}>
              <CalendarPlus aria-hidden="true" size={20} /> Request leave
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white shadow-card">
            {data.requests.map((r) => (
              <li key={r.id} aria-label={`${r.leaveType}, ${r.status}`} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-ink-900">{r.leaveType}</p>
                    <p className="text-sm text-ink-700">
                      {formatRange(r.startDate, r.endDate)} · {r.days} day{r.days === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Pill status={r.status} />
                </div>
                {r.reason && <p className="mt-2 line-clamp-2 text-sm text-ink-700">{r.reason}</p>}
                {r.decisionNote && (
                  <p className="mt-2 rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-800">
                    <span className="font-semibold">{r.decidedBy}:</span> {r.decisionNote}
                  </p>
                )}
                {(r.hasAttachment || r.status === "Pending") && (
                  <div className="-mb-1 -ml-2 mt-2 flex items-center gap-1">
                    {r.hasAttachment && <DocumentButton id={r.id} own title={`${r.leaveType}, ${formatRange(r.startDate, r.endDate)}`} />}
                    {r.status === "Pending" && (
                      <button type="button" onClick={() => setCancelling(r)} className={phoneButton("quiet", "sm", "px-2!")}>
                        Cancel request
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.requests.length > 0 && <Fab label="Request leave" icon={CalendarPlus} onClick={() => setAsking(true)} />}
      <RequestSheet open={asking} data={data} onClose={() => setAsking(false)} onSend={onSend} />

      <Dialog open={cancelling !== null} title="Cancel this request?" variant="sheet" onClose={() => setCancelling(null)}>
        {cancelling && (
          <>
            <p className="mt-2 text-base text-ink-800">
              {cancelling.leaveType}, {formatRange(cancelling.startDate, cancelling.endDate)}. Your manager will no longer see it.
            </p>
            <div className="mt-5 space-y-3">
              <button
                type="button"
                className={phoneButton("danger", "lg", "w-full")}
                onClick={() => {
                  const request = cancelling;
                  setCancelling(null);
                  void onCancel(request);
                }}
              >
                Cancel request
              </button>
              <button type="button" className={phoneButton("secondary", "md", "w-full")} onClick={() => setCancelling(null)}>
                Keep it
              </button>
            </div>
          </>
        )}
      </Dialog>
    </section>
  );
}

function RequestSheet({
  open,
  data,
  onClose,
  onSend,
}: {
  open: boolean;
  data: StaffMyLeave;
  onClose: () => void;
  onSend: (input: LeaveRequestInput) => Promise<void>;
}) {
  return (
    <Dialog open={open} title="Request leave" variant="sheet" onClose={onClose}>
      <RequestForm data={data} onClose={onClose} onSend={onSend} />
    </Dialog>
  );
}

/** Mounted only while the sheet is open, so every opening starts with a blank form. */
function RequestForm({ data, onClose, onSend }: { data: StaffMyLeave; onClose: () => void; onSend: (input: LeaveRequestInput) => Promise<void> }) {
  const [typeId, setTypeId] = useState(data.types[0]?.id ?? 0);
  const [start, setStart] = useState(todayInUae());
  const [end, setEnd] = useState(todayInUae());
  const [reason, setReason] = useState("");
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const type = data.types.find((t) => t.id === typeId);
  const needsDocument = type?.requiresDocument === true;
  const left = (id: number) => data.balances.find((b) => b.leaveTypeId === id)?.remaining;
  const valid = Date.parse(end) >= Date.parse(start) && reason.trim() !== "" && (!needsDocument || document !== null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !valid) return;
    setPending(true);
    setFailure(null);
    try {
      await onSend({ leaveTypeId: typeId, startDate: start, endDate: end, reason, ...(needsDocument && document ? { attachmentBase64: document.base64 } : {}) });
      onClose();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-5">
      <fieldset disabled={pending}>
        <legend className="text-sm font-bold text-ink-800">Leave type</legend>
        <div role="group" aria-label="Leave type" className="mt-1.5 grid grid-cols-2 gap-2">
          {data.types.map((t) => {
            const on = t.id === typeId;
            const remaining = left(t.id);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() => setTypeId(t.id)}
                className={`min-h-14 rounded-2xl border px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
                  on ? "border-brand-700 bg-brand-700 text-white" : "border-ink-300 bg-white text-ink-900 active:bg-ink-100"
                }`}
              >
                <span className="block text-[0.9375rem] font-semibold leading-tight">{t.name}</span>
                {remaining !== undefined && <span className={`block text-sm ${on ? "text-brand-100" : "text-ink-600"}`}>{remaining} left</span>}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset disabled={pending}>
        <legend className="sr-only">Dates</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="my-leave-from" className="text-sm font-bold text-ink-800">
              From
            </label>
            <input
              id="my-leave-from"
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (e.target.value > end) setEnd(e.target.value);
              }}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="my-leave-to" className="text-sm font-bold text-ink-800">
              To
            </label>
            <input id="my-leave-to" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={fieldClass} />
          </div>
        </div>
        <p role="status" className="mt-2 text-sm text-ink-700">
          <span className="font-semibold">{calendarDays(start, end)}.</span> Sundays and public holidays are not counted.
        </p>
      </fieldset>

      <div>
        <label htmlFor="my-leave-reason" className="text-sm font-bold text-ink-800">
          Reason
        </label>
        <textarea
          id="my-leave-reason"
          rows={3}
          maxLength={500}
          value={reason}
          disabled={pending}
          placeholder="Why do you need the leave?"
          onChange={(e) => setReason(e.target.value)}
          className={`${fieldClass} py-3`}
        />
      </div>

      {needsDocument && (
        <DocumentPicker
          value={document}
          onChange={setDocument}
          required
          label={`${type?.name}: document`}
          hint="Required. Attach your doctor's certificate or sick note."
        />
      )}

      {failure && <ActionFailure message={failure} />}
      <button type="submit" disabled={pending || !valid} className={phoneButton("primary", "lg", "w-full")}>
        {pending ? <Loader2 aria-hidden="true" size={20} className="animate-spin" /> : <CalendarPlus aria-hidden="true" size={20} />}
        {pending ? "Sending..." : "Send request"}
      </button>
    </form>
  );
}
