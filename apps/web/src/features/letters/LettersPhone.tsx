import { useState, type FormEvent } from "react";
import { Briefcase, CircleCheck, Clock, Download, FileText, Landmark, Loader2, Undo2, Wallet, type LucideIcon } from "lucide-react";
import type { CertificateRequest, CertificateStatus } from "../../api/certificateRequests";
import { createRequest } from "../../api/certificateRequests";
import { letterTypeLabel, LETTER_TYPES, type LetterSummary, type LetterType } from "../../api/letters";
import type { Worker } from "../../api/workers";
import { Dialog } from "../../components/Dialog";
import { WorkerPicker } from "../../components/WorkerPicker";
import { ActionFailure } from "../workers/WorkersFeedback";
import { fieldErrorsOf, messageOf } from "./letterUi";
import { needsMe, openLabel, type RequestRoles } from "./requestRoles";
import { Chip, ChipRow as Row, phoneButton } from "../../components/phoneUi";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

export function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dubai" });
}

/** Who has the request now, in plain words: the supervisor needs to know where it is, not the workflow's names. */
const STATUS: Record<CertificateStatus, { label: string; tone: string; icon: LucideIcon }> = {
  Requested: { label: "With HR", tone: "bg-sky-100 text-sky-900", icon: FileText },
  PendingApproval: { label: "With manager", tone: "bg-amber-100 text-amber-900", icon: Clock },
  Returned: { label: "Sent back to HR", tone: "bg-red-100 text-red-800", icon: Undo2 },
  Approved: { label: "Approved", tone: "bg-brand-100 text-brand-800", icon: CircleCheck },
};

function StatusPill({ status }: { status: CertificateStatus }) {
  const { label, tone, icon: Icon } = STATUS[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
      <Icon aria-hidden="true" size={13} strokeWidth={2.5} />
      {label}
    </span>
  );
}

export type RequestChip = "all" | "needs" | "waiting" | "done";

export function chipOf(row: CertificateRequest, roles: RequestRoles): Exclude<RequestChip, "all"> {
  if (row.status === "Approved") return "done";
  return needsMe(row, roles) ? "needs" : "waiting";
}

/** A row of filter chips, each with its count. Shared by the requests list and the approved-letters log. */
export function ChipRow({
  label,
  chips,
}: {
  label: string;
  chips: { key: string; label: string; count?: number; on: boolean; onClick: () => void }[];
}) {
  return (
    <Row label={label}>
      {chips.map((chip) => (
        <Chip key={chip.key} on={chip.on} count={chip.count} onClick={chip.onClick}>
          {chip.label}
        </Chip>
      ))}
    </Row>
  );
}

/**
 * Certificate requests on a phone: one card per request with who it is for, which certificate, where it stands and when it
 * was asked for. If the next step is yours it is a filled button (Prepare, Review); otherwise Open, and a PDF once approved.
 */
export function RequestList({
  rows,
  roles,
  username,
  downloading,
  onOpen,
  onDownload,
}: {
  rows: CertificateRequest[];
  roles: RequestRoles;
  username: string | undefined;
  downloading: number | null;
  onOpen: (id: number) => void;
  onDownload: (letterId: number, refNo: string) => void;
}) {
  return (
    <ul aria-label="Requests" className="divide-y divide-ink-100 overflow-hidden rounded-3xl border border-line bg-white shadow-card">
      {rows.map((row) => {
        const mine = needsMe(row, roles);
        const canDownload = roles.canOpen && row.status === "Approved" && row.letterId !== null;
        return (
          <li key={row.id} aria-label={`${row.workerName}, ${letterTypeLabel(row.letterType)}`} className="px-4 py-4">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 break-words text-base font-semibold leading-snug text-ink-900">
                {row.workerName} <span className="text-[0.8125rem] font-normal text-ink-600">{row.workerCode}</span>
              </p>
              <StatusPill status={row.status} />
            </div>
            <p className="mt-1 text-[0.9375rem] font-medium text-ink-800">{letterTypeLabel(row.letterType)}</p>
            <p className="mt-1.5 text-[0.8125rem] text-ink-600">
              Requested {when(row.requestedUtc)} by {row.requestedBy === username ? "you" : row.requestedBy}
              {row.refNo ? ` · ${row.refNo}` : ""}
            </p>
            {row.reason && <p className="mt-1 line-clamp-2 break-words text-sm text-ink-700">Note: {row.reason}</p>}
            {row.status === "Returned" && row.reviewNote && (
              <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-900">
                Sent back by {row.reviewedBy}: {row.reviewNote}
              </p>
            )}
            {roles.canOpen && (
              <div className={`mt-4 grid gap-2 ${canDownload ? "grid-cols-2" : "grid-cols-1"}`}>
                <button
                  type="button"
                  aria-label={`Open request for ${row.workerName}`}
                  onClick={() => onOpen(row.id)}
                  className={phoneButton(mine ? "primary" : "secondary", "sm")}
                >
                  {openLabel(row, roles)}
                </button>
                {canDownload && (
                  <button
                    type="button"
                    aria-label={`Download PDF ${row.refNo}`}
                    disabled={downloading === row.letterId}
                    onClick={() => onDownload(row.letterId!, row.refNo ?? "certificate")}
                    className={phoneButton("secondary", "sm")}
                  >
                    {downloading === row.letterId ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Download aria-hidden="true" size={16} />}
                    PDF
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const TYPE_ICON: Record<LetterType, LucideIcon> = { Salary: Wallet, Service: Briefcase, BankTransfer: Landmark, Noc: FileText };

/**
 * "Request a certificate" as a phone sheet: search for the worker, pick the certificate from four tiles (none is chosen for
 * you, so the sensitive one is never sent by accident), and add a note if HR needs to know what it is for.
 */
export function NewRequestSheet({
  workers,
  loading,
  loadFailure,
  onDone,
  onClose,
}: {
  workers: Worker[];
  loading: boolean;
  loadFailure: string | null;
  onDone: (request: CertificateRequest) => void;
  onClose: () => void;
}) {
  const [workerId, setWorkerId] = useState("");
  const [letterType, setLetterType] = useState<LetterType | "">("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const found: Record<string, string> = {};
    if (!workerId) found.workerId = "Choose a worker.";
    if (!letterType) found.letterType = "Choose a certificate.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    setFailure(null);
    try {
      onDone(await createRequest({ workerId: Number(workerId), letterType: letterType as LetterType, reason }));
    } catch (error) {
      const fields = fieldErrorsOf(error);
      setErrors(fields);
      setFailure(Object.keys(fields).length > 0 ? "Please fix the highlighted fields." : messageOf(error));
      setPending(false);
    }
  }

  return (
    <Dialog open title="Request a certificate" variant="sheet" onClose={pending ? () => {} : onClose}>
      <form noValidate onSubmit={submit} className="mt-3 space-y-5">
        <WorkerPicker workers={workers} value={workerId} onChange={(id) => { setWorkerId(id); setErrors((e) => ({ ...e, workerId: "" })); }} error={errors.workerId} disabled={pending} loading={loading} />

        <fieldset disabled={pending}>
          <legend className="text-sm font-bold text-ink-800">Certificate</legend>
          <div role="group" aria-label="Certificate" className="mt-1.5 grid grid-cols-2 gap-2">
            {LETTER_TYPES.map((type) => {
              const Icon = TYPE_ICON[type.value];
              const on = letterType === type.value;
              return (
                <button
                  key={type.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setLetterType(type.value);
                    setErrors((e) => ({ ...e, letterType: "" }));
                  }}
                  className={`flex min-h-16 items-center gap-2.5 rounded-2xl border px-3 text-left text-[0.9375rem] font-semibold leading-tight transition-colors duration-150 ${focusRing} ${
                    on ? "border-brand-700 bg-brand-700 text-white" : "border-ink-300 bg-white text-ink-900 active:bg-ink-100"
                  }`}
                >
                  <Icon aria-hidden="true" size={20} className="shrink-0" />
                  {type.label}
                </button>
              );
            })}
          </div>
          {errors.letterType && <p className="mt-1 text-sm text-red-700">{errors.letterType}</p>}
        </fieldset>

        <div>
          <label htmlFor="request-reason" className="text-sm font-bold text-ink-800">
            What is it for? <span className="font-normal text-ink-600">(optional)</span>
          </label>
          <textarea
            id="request-reason"
            rows={3}
            maxLength={500}
            value={reason}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
            placeholder="For example a visa renewal or a bank loan"
            className={`mt-1.5 block w-full resize-none rounded-xl border border-ink-300 bg-white px-3 py-2.5 text-base text-ink-900 placeholder:text-ink-500 ${focusRing}`}
          />
          <p className="mt-1 text-[0.8125rem] text-ink-600">HR sees this note.</p>
          {errors.reason && <p className="text-sm text-red-700">{errors.reason}</p>}
        </div>

        {(failure ?? loadFailure) && <ActionFailure message={(failure ?? loadFailure) as string} />}

        <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-line bg-white px-5 pb-1 pt-3">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className={phoneButton("secondary", "lg", "shrink-0")}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className={phoneButton("primary", "lg", "flex-1")}
          >
            {pending ? "Sending..." : "Send request"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** The approved-letters log on a phone: one card per letter, with Open and PDF side by side. */
export function LetterCards({
  rows,
  downloading,
  onOpen,
  onDownload,
}: {
  rows: LetterSummary[];
  downloading: number | null;
  onOpen: (id: number) => void;
  onDownload: (id: number, refNo: string) => void;
}) {
  return (
    <ul aria-label="Approved letters" className="divide-y divide-ink-100 overflow-hidden rounded-3xl border border-line bg-white shadow-card">
      {rows.map((row) => (
        <li key={row.id} aria-label={row.refNo} className="px-4 py-4">
          <p className="text-base font-semibold leading-snug text-ink-900">{row.refNo}</p>
          <p className="mt-1 text-[0.9375rem] font-medium text-ink-800">{letterTypeLabel(row.letterType)}</p>
          <p className="mt-1.5 break-words text-[0.8125rem] text-ink-600">
            {row.workerName} ({row.workerCode}) · {row.issueDate}
            {row.addressedTo ? ` · To ${row.addressedTo}` : ""}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-label={`Open ${row.refNo}`}
              onClick={() => onOpen(row.id)}
              className={phoneButton("primary", "sm")}
            >
              Open
            </button>
            <button
              type="button"
              aria-label={`Download PDF ${row.refNo}`}
              disabled={downloading === row.id}
              onClick={() => onDownload(row.id, row.refNo)}
              className={phoneButton("secondary", "sm")}
            >
              {downloading === row.id ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Download aria-hidden="true" size={16} />}
              PDF
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
