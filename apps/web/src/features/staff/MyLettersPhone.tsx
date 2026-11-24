import { useState, type FormEvent } from "react";
import { Check, Download, FileText, Hourglass, Loader2, Send, Undo2, type LucideIcon } from "lucide-react";
import { STATUS_LABELS, type CertificateRequest, type CertificateStatus } from "../../api/certificateRequests";
import { LETTER_TYPES, letterTypeLabel } from "../../api/letters";
import { Dialog } from "../../components/Dialog";
import { Fab, PAGE_GAP, PhoneTitle, phoneButton } from "../../components/phoneUi";
import { ActionFailure } from "../workers/WorkersFeedback";
import { Stepper } from "./staffKit";
import { shortDate } from "./staffUi";

const STEPS = ["Requested", "Prepared", "Ready"] as const;
const STEP_INDEX: Record<CertificateStatus, number> = { Requested: 0, Returned: 0, PendingApproval: 1, Approved: 3 };

const STATUS: Record<CertificateStatus, { tone: string; icon: LucideIcon }> = {
  Requested: { tone: "bg-sky-100 text-sky-900", icon: Send },
  PendingApproval: { tone: "bg-amber-100 text-amber-900", icon: Hourglass },
  Returned: { tone: "bg-red-100 text-red-800", icon: Undo2 },
  Approved: { tone: "bg-brand-100 text-brand-800", icon: Check },
};

/** What the employee sees at each step; the preparing and approving are done by a manager. */
const PROGRESS: Record<CertificateStatus, string> = {
  Requested: "Sent to your manager, who will prepare it.",
  PendingApproval: "Prepared and waiting for final approval.",
  Returned: "Your manager is revising it.",
  Approved: "Ready. Download your letter.",
};

const TYPE_HINT: Record<string, string> = {
  Salary: "Your pay, for a bank or visa",
  Service: "That you work here, and since when",
  BankTransfer: "Moves your salary to another bank",
  Noc: "A general letter for any office",
};

const fieldClass =
  "mt-1.5 w-full rounded-xl border border-ink-300 bg-white px-3 py-3 text-base text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60";

/**
 * My Letters on a phone: the letters (ready ones first, each with a full-width Download) and a floating button that opens
 * the request as a sheet with the four letter types as tiles.
 */
export function MyLettersPhone({
  requests,
  busyId,
  onSend,
  onDownload,
}: {
  requests: CertificateRequest[];
  busyId: number | null;
  /** Sends the request; throws an Error whose message is shown in the sheet. */
  onSend: (type: string, reason: string) => Promise<void>;
  onDownload: (request: CertificateRequest) => void;
}) {
  const [asking, setAsking] = useState(false);
  // Letters that are ready to download come first; the rest keep their order (newest first).
  const ordered = [...requests].sort((a, b) => Number(b.status === "Approved") - Number(a.status === "Approved"));
  return (
    <section className={`${PAGE_GAP} pb-20`}>
      <PhoneTitle title="My Letters" subtitle="Your manager prepares and approves each letter." />

      {requests.length === 0 ? (
        <div className="rounded-3xl border border-line bg-white p-6 text-center shadow-card">
          <FileText aria-hidden="true" size={28} className="mx-auto text-brand-700" />
          <p className="mt-2 font-semibold text-ink-900">No letter requests yet</p>
          <p className="mt-1 text-sm text-ink-600">Salary, service and other letters you ask for appear here with their progress.</p>
          <button type="button" onClick={() => setAsking(true)} className={phoneButton("primary", "md", "mt-4")}>
            <Send aria-hidden="true" size={18} /> Request a letter
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white shadow-card">
          {ordered.map((r) => {
            const { tone, icon: Icon } = STATUS[r.status];
            return (
              <li key={r.id} aria-label={`${letterTypeLabel(r.letterType)}, ${STATUS_LABELS[r.status]}`} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-ink-900">{letterTypeLabel(r.letterType)}</p>
                    <p className="text-sm text-ink-600">
                      Requested {shortDate(r.requestedUtc.slice(0, 10))}
                      {r.refNo ? ` · Ref ${r.refNo}` : ""}
                    </p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
                    <Icon aria-hidden="true" size={13} strokeWidth={3} />
                    {STATUS_LABELS[r.status]}
                  </span>
                </div>
                {r.reason && <p className="mt-2 line-clamp-2 text-sm text-ink-700">{r.reason}</p>}
                {r.status === "Approved" ? (
                  <button type="button" disabled={busyId === r.id} onClick={() => onDownload(r)} className={phoneButton("primary", "md", "mt-3 w-full")}>
                    {busyId === r.id ? <Loader2 aria-hidden="true" size={18} className="animate-spin" /> : <Download aria-hidden="true" size={18} />}
                    {busyId === r.id ? "Downloading..." : "Download letter"}
                  </button>
                ) : (
                  <>
                    <div className="mt-3">
                      <Stepper steps={STEPS} current={STEP_INDEX[r.status]} note={PROGRESS[r.status]} />
                    </div>
                    <p className="mt-2 text-sm text-ink-700">{PROGRESS[r.status]}</p>
                  </>
                )}
                {r.status === "Returned" && r.reviewNote && (
                  <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-900">
                    <span className="font-semibold">Why:</span> {r.reviewNote}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {requests.length > 0 && <Fab label="Request a letter" icon={Send} onClick={() => setAsking(true)} />}
      <Dialog open={asking} title="Request a letter" variant="sheet" onClose={() => setAsking(false)}>
        <RequestForm onClose={() => setAsking(false)} onSend={onSend} />
      </Dialog>
    </section>
  );
}

/** Mounted only while the sheet is open, so every opening starts blank. */
function RequestForm({ onClose, onSend }: { onClose: () => void; onSend: (type: string, reason: string) => Promise<void> }) {
  const [type, setType] = useState<string>(LETTER_TYPES[0].value);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      await onSend(type, reason.trim());
      onClose();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-5">
      <fieldset disabled={pending}>
        <legend className="text-sm font-bold text-ink-800">Type of letter</legend>
        <div role="group" aria-label="Type of letter" className="mt-1.5 grid gap-2">
          {LETTER_TYPES.map((t) => {
            const on = t.value === type;
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={on}
                onClick={() => setType(t.value)}
                className={`min-h-14 rounded-2xl border px-4 py-2 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
                  on ? "border-brand-700 bg-brand-700 text-white" : "border-ink-300 bg-white text-ink-900 active:bg-ink-100"
                }`}
              >
                <span className="block font-semibold leading-tight">{t.label}</span>
                <span className={`block text-sm ${on ? "text-brand-100" : "text-ink-600"}`}>{TYPE_HINT[t.value]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="my-letter-reason" className="text-sm font-bold text-ink-800">
          What is it for? <span className="font-normal text-ink-600">(optional)</span>
        </label>
        <textarea
          id="my-letter-reason"
          rows={2}
          maxLength={500}
          value={reason}
          disabled={pending}
          placeholder="For example: visa application, bank loan"
          onChange={(e) => setReason(e.target.value)}
          className={fieldClass}
        />
      </div>

      {failure && <ActionFailure message={failure} />}
      <button type="submit" disabled={pending} className={phoneButton("primary", "lg", "w-full")}>
        {pending ? <Loader2 aria-hidden="true" size={20} className="animate-spin" /> : <Send aria-hidden="true" size={20} />}
        {pending ? "Sending..." : "Send request"}
      </button>
    </form>
  );
}
