import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, Clock, Download, FileText, Loader2, Plus, Undo2, XCircle } from "lucide-react";
import {
  approveRequest,
  createRequest,
  getRequest,
  listRequests,
  rejectRequest,
  STATUS_LABELS,
  type CertificateRequest,
  type CertificateRequestDetail,
  type CertificateStatus,
} from "../../api/certificateRequests";
import { letterTypeLabel, LETTER_TYPES, type LetterType } from "../../api/letters";
import { listWorkers, type Worker } from "../../api/workers";
import { Dialog } from "../../components/Dialog";
import { LoadingState, Button, Card, EmptyState, Select, StatusBadge, Table, TableScroll, Td, Textarea, Th, THead, TRow } from "../../ui";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { fieldErrorsOf, messageOf, usePdfDownload } from "./letterUi";
import { LetterSheet } from "./LetterSheet";
import { PrepareLetter } from "./PrepareLetter";

export interface RequestRoles {
  /** Supervisors, Managers and the Administrator raise requests. */
  canRaise: boolean;
  /** HR and the Administrator add and update the details and send for approval. */
  canPrepare: boolean;
  /** Managers and the Administrator approve or send back. */
  canApprove: boolean;
  /** HR, Managers and the Administrator open requests and download approved certificates. */
  canOpen: boolean;
}

export function RequestStatus({ status }: { status: CertificateStatus }) {
  const label = STATUS_LABELS[status];
  switch (status) {
    case "Approved":
      return <StatusBadge tone="success" icon={CheckCircle2}>{label}</StatusBadge>;
    case "PendingApproval":
      return <StatusBadge tone="warning" icon={Clock}>{label}</StatusBadge>;
    case "Returned":
      return <StatusBadge tone="danger" icon={Undo2}>{label}</StatusBadge>;
    default:
      return <StatusBadge tone="info" icon={FileText}>{label}</StatusBadge>;
  }
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Dubai" });
}

// --- raise a request -----------------------------------------------------------------------------------------

function NewRequestForm({ onDone, onClose }: { onDone: (request: CertificateRequest) => void; onClose: () => void }) {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [workerId, setWorkerId] = useState("");
  const [letterType, setLetterType] = useState<LetterType>("Salary");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listWorkers(false)
      .then((list) => !cancelled && setWorkers(list))
      .catch((e: unknown) => !cancelled && setFailure(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!workerId) found.workerId = "Choose a worker.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    setFailure(null);
    try {
      onDone(await createRequest({ workerId: Number(workerId), letterType, reason }));
    } catch (error) {
      const fields = fieldErrorsOf(error);
      setErrors(fields);
      setFailure(Object.keys(fields).length > 0 ? "Please fix the highlighted fields." : messageOf(error));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Select label="Worker" value={workerId} onChange={(e) => setWorkerId(e.target.value)} error={errors.workerId} disabled={workers === null}>
        <option value="">{workers === null ? "Loading workers..." : "Choose a worker..."}</option>
        {(workers ?? []).map((w) => (
          <option key={w.id} value={w.id}>
            {w.fullName} ({w.workerCode})
          </option>
        ))}
      </Select>
      <Select label="Certificate" value={letterType} onChange={(e) => setLetterType(e.target.value as LetterType)} error={errors.letterType}>
        {LETTER_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <Textarea
        label="What is it for? (optional)"
        rows={3}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={errors.reason}
        hint="For example a visa renewal or a bank loan. HR sees this note."
      />
      {failure && <ActionFailure message={failure} />}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" icon={pending ? Loader2 : Plus} disabled={pending} aria-busy={pending}>
          {pending ? "Sending..." : "Send request"}
        </Button>
      </div>
    </form>
  );
}

// --- one request -----------------------------------------------------------------------------------------

function RejectForm({ onSubmit, onClose }: { onSubmit: (reason: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim() === "") {
      setError("Say what HR needs to change.");
      return;
    }
    setPending(true);
    try {
      await onSubmit(reason);
    } catch (e) {
      setError(messageOf(e));
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Textarea label="Reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} error={error} hint="HR sees this, fixes the details and sends it again." />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" icon={pending ? Loader2 : Undo2} disabled={pending} aria-busy={pending}>
          Send back to HR
        </Button>
      </div>
    </form>
  );
}

function RequestDetailView({ id, roles, onBack, onNotice }: { id: number; roles: RequestRoles; onBack: () => void; onNotice: (message: string) => void }) {
  const [detail, setDetail] = useState<CertificateRequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const { pending, error: pdfError, download } = usePdfDownload();

  const load = useCallback(() => {
    setError(null);
    getRequest(id)
      .then(setDetail)
      .catch((e: unknown) => setError(messageOf(e)));
  }, [id]);
  useEffect(load, [load]);

  async function approve() {
    setApproving(true);
    setFailure(null);
    try {
      const approved = await approveRequest(id);
      setNotice(`Approved. Reference ${approved.refNo}.`);
      load();
    } catch (e) {
      setFailure(messageOf(e));
    } finally {
      setApproving(false);
    }
  }

  async function sendBack(reason: string) {
    await rejectRequest(id, reason);
    setSendingBack(false);
    onNotice("The request was sent back to HR.");
    onBack();
  }

  if (error) return <LoadError message={error} onRetry={load} />;
  if (!detail) {
    return (
      <p role="status" className="flex items-center gap-2 py-8 text-sm text-ink-600">
        <Loader2 aria-hidden="true" size={18} className="animate-spin" />
        Loading the request...
      </p>
    );
  }
  const request = detail.request;
  const preparing = roles.canPrepare && (request.status === "Requested" || request.status === "Returned");

  return (
    <div>
      <Button variant="secondary" icon={ArrowLeft} onClick={onBack} className="mb-4">
        Back to requests
      </Button>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink-900">
            {letterTypeLabel(request.letterType)} for {request.workerName}
          </h3>
          <p className="text-sm text-ink-600">
            Requested by {request.requestedBy} on {when(request.requestedUtc)}.{request.reason ? ` Note: ${request.reason}` : ""}
          </p>
        </div>
        <RequestStatus status={request.status} />
      </div>

      <SuccessRegion message={notice} />
      {failure && <ActionFailure message={failure} />}
      {pdfError && <ActionFailure message={pdfError} />}

      {request.status === "Returned" && request.reviewNote && (
        <p role="status" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          Sent back by {request.reviewedBy}: {request.reviewNote}
        </p>
      )}
      {request.status === "PendingApproval" && !roles.canApprove && (
        <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Waiting for a manager to approve. The certificate can be downloaded once it is approved.
        </p>
      )}

      {preparing ? (
        <PrepareLetter
          detail={detail}
          onSaved={() => load()}
          onSubmitted={() => {
            onNotice("Sent to the manager for approval.");
            onBack();
          }}
        />
      ) : detail.document ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-700">
              {request.status === "Approved"
                ? `Approved by ${request.reviewedBy}. Reference ${request.refNo}.`
                : `Prepared by ${request.preparedBy ?? "HR"}. Check it, then approve or send it back.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {request.status === "Approved" && request.letterId !== null && roles.canOpen && (
                <Button
                  icon={pending === request.letterId ? Loader2 : Download}
                  disabled={pending === request.letterId}
                  aria-busy={pending === request.letterId}
                  onClick={() => void download(request.letterId!, request.refNo ?? "certificate")}
                >
                  Download PDF
                </Button>
              )}
              {request.status === "PendingApproval" && roles.canApprove && (
                <>
                  <Button variant="secondary" icon={XCircle} onClick={() => setSendingBack(true)} disabled={approving}>
                    Send back
                  </Button>
                  <Button icon={approving ? Loader2 : CheckCircle2} onClick={() => void approve()} disabled={approving} aria-busy={approving}>
                    {approving ? "Approving..." : "Approve"}
                  </Button>
                </>
              )}
            </div>
          </div>
          <LetterSheet document={detail.document} />
        </>
      ) : (
        <Card>
          <EmptyState icon={FileText} title="HR has not added the details yet" description="You will see the certificate here once HR sends it for approval." />
        </Card>
      )}

      <Dialog open={sendingBack} onClose={() => setSendingBack(false)} title="Send back to HR">
        <RejectForm onSubmit={sendBack} onClose={() => setSendingBack(false)} />
      </Dialog>
    </div>
  );
}

// --- the list ----------------------------------------------------------------------------------------------

export function RequestsPanel({ roles, defaultStatus }: { roles: RequestRoles; defaultStatus: CertificateStatus | "" }) {
  const [status, setStatus] = useState<CertificateStatus | "">(defaultStatus);
  const [rows, setRows] = useState<CertificateRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [raising, setRaising] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { pending, error: pdfError, download } = usePdfDownload();
  const first = useRef(true);

  useEffect(() => {
    let cancelled = false;
    first.current = false;
    listRequests(status || undefined)
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          setError(null);
        }
      })
      .catch((e: unknown) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [status, attempt, openId]);

  if (openId !== null) {
    return <RequestDetailView id={openId} roles={roles} onBack={() => setOpenId(null)} onNotice={setNotice} />;
  }

  return (
    <div>
      <SuccessRegion message={notice} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="w-full sm:w-64">
          <Select label="Show" value={status} onChange={(e) => setStatus(e.target.value as CertificateStatus | "")}>
            <option value="">All requests</option>
            {(Object.keys(STATUS_LABELS) as CertificateStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        {roles.canRaise && (
          <Button icon={Plus} onClick={() => setRaising(true)}>
            New request
          </Button>
        )}
      </div>

      {pdfError && <ActionFailure message={pdfError} />}
      <Card>
        {error ? (
          <div className="p-4">
            <LoadError message={error} onRetry={() => setAttempt((n) => n + 1)} />
          </div>
        ) : rows === null ? (
          <LoadingState label="Loading requests..." rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No requests"
            description={roles.canRaise ? "Ask for a certificate with New request. HR prepares it and a manager approves it." : "Requests raised by supervisors appear here."}
          />
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <tr>
                  <Th>Worker</Th>
                  <Th>Certificate</Th>
                  <Th>Requested</Th>
                  <Th>Status</Th>
                  <Th>Reference</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {rows.map((row) => (
                  <TRow key={row.id}>
                    <Td>
                      {row.workerName} <span className="text-ink-500">({row.workerCode})</span>
                    </Td>
                    <Td>{letterTypeLabel(row.letterType)}</Td>
                    <Td className="whitespace-nowrap">
                      {when(row.requestedUtc)} <span className="text-ink-500">by {row.requestedBy}</span>
                    </Td>
                    <Td>
                      <RequestStatus status={row.status} />
                    </Td>
                    <Td className="whitespace-nowrap">{row.refNo ?? "-"}</Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        {roles.canOpen && (
                          <Button size="sm" variant="secondary" aria-label={`Open request for ${row.workerName}`} onClick={() => setOpenId(row.id)}>
                            {roles.canPrepare && (row.status === "Requested" || row.status === "Returned")
                              ? "Prepare"
                              : roles.canApprove && row.status === "PendingApproval"
                                ? "Review"
                                : "Open"}
                          </Button>
                        )}
                        {roles.canOpen && row.status === "Approved" && row.letterId !== null && (
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label={`Download PDF ${row.refNo}`}
                            icon={pending === row.letterId ? Loader2 : Download}
                            disabled={pending === row.letterId}
                            onClick={() => void download(row.letterId!, row.refNo ?? "certificate")}
                          >
                            PDF
                          </Button>
                        )}
                      </div>
                    </Td>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>

      <Dialog open={raising} onClose={() => setRaising(false)} title="Request a certificate">
        <NewRequestForm
          onClose={() => setRaising(false)}
          onDone={(request) => {
            setRaising(false);
            setNotice(`Request sent to HR for ${request.workerName}.`);
            setAttempt((n) => n + 1);
          }}
        />
      </Dialog>
    </div>
  );
}
