import { createPortal } from "react-dom";
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
import { mayPrepare, openLabel, type RequestRoles } from "./requestRoles";
import { ChipRow, chipOf, NewRequestSheet, RequestList, type RequestChip } from "./LettersPhone";
import { Fab, PAGE_GAP } from "../../components/phoneUi";
import { PhoneToast } from "../../components/PhoneToast";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { useAuth } from "../../contexts/AuthContext";

export type { RequestRoles };

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
  const desktop = useIsDesktop();

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
  const preparing = mayPrepare(roles, request.requestedBy, request.workerCategory) && (request.status === "Requested" || request.status === "Returned");

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
      {request.workerCategory === "Employee" && !preparing && (request.status === "Requested" || request.status === "Returned") && (
        <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This request is from an office employee. Only a Manager prepares it.
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
        (() => {
          const actions = (
            <>
              {request.status === "Approved" && request.letterId !== null && roles.canOpen && (
                <Button
                  icon={pending === request.letterId ? Loader2 : Download}
                  disabled={pending === request.letterId}
                  aria-busy={pending === request.letterId}
                  onClick={() => void download(request.letterId!, request.refNo ?? "certificate")}
                  className={desktop ? undefined : "min-h-12 flex-1"}
                >
                  Download PDF
                </Button>
              )}
              {request.status === "PendingApproval" && roles.canApprove && (
                <>
                  <Button variant="secondary" icon={XCircle} onClick={() => setSendingBack(true)} disabled={approving} className={desktop ? undefined : "min-h-12 flex-1"}>
                    Send back
                  </Button>
                  <Button icon={approving ? Loader2 : CheckCircle2} onClick={() => void approve()} disabled={approving} aria-busy={approving} className={desktop ? undefined : "min-h-12 flex-1"}>
                    {approving ? "Approving..." : "Approve"}
                  </Button>
                </>
              )}
            </>
          );
          const hasActions =
            (request.status === "Approved" && request.letterId !== null && roles.canOpen) || (request.status === "PendingApproval" && roles.canApprove);
          const summary = (
            <p className="text-sm text-ink-700">
              {request.status === "Approved"
                ? `Approved by ${request.reviewedBy}. Reference ${request.refNo}.`
                : `Prepared by ${request.preparedBy ?? "HR"}. Check it, then approve or send it back.`}
            </p>
          );
          // On a phone the decision stays in the thumb zone while the letter scrolls; on desktop it sits above the letter.
          return desktop ? (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                {summary}
                <div className="flex flex-wrap gap-2">{actions}</div>
              </div>
              <LetterSheet document={detail.document} />
            </>
          ) : (
            <>
              <div className="mb-4">{summary}</div>
              <LetterSheet document={detail.document} />
              {hasActions && (
                <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mt-5 flex gap-2 rounded-2xl border border-line bg-white p-2 shadow-pop">{actions}</div>
              )}
            </>
          );
        })()
      ) : (
        <Card>
          <EmptyState
            icon={FileText}
            title={request.workerCategory === "Employee" ? "The details have not been prepared yet" : "HR has not added the details yet"}
            description={
              request.workerCategory === "Employee"
                ? "You will see the certificate here once a Manager has prepared it."
                : "You will see the certificate here once HR sends it for approval."
            }
          />
        </Card>
      )}

      <Dialog open={sendingBack} onClose={() => setSendingBack(false)} title="Send back to HR">
        <RejectForm onSubmit={sendBack} onClose={() => setSendingBack(false)} />
      </Dialog>
    </div>
  );
}

// --- the list ----------------------------------------------------------------------------------------------

export function RequestsPanel({ roles, defaultStatus, headerSlot }: { roles: RequestRoles; defaultStatus: CertificateStatus | ""; headerSlot?: HTMLElement | null }) {
  const desktop = useIsDesktop();
  const { user } = useAuth();
  /** Phone only: which chip is chosen; null until the person picks one, so the default can follow what needs them. */
  const [phoneChip, setPhoneChip] = useState<RequestChip | null>(null);
  const [phoneWorkers, setPhoneWorkers] = useState<Worker[] | null>(null);
  const [phoneWorkersError, setPhoneWorkersError] = useState<string | null>(null);
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
    // Everything is fetched once; the tabs below filter it and show how many are in each.
    listRequests()
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
  }, [attempt, openId]);

  useEffect(() => {
    if (desktop || !raising || phoneWorkers !== null) return;
    let cancelled = false;
    listWorkers(false)
      .then((list) => !cancelled && setPhoneWorkers(list))
      .catch((e: unknown) => !cancelled && setPhoneWorkersError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [desktop, raising, phoneWorkers]);

  const counts = (rows ?? []).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const shown = status ? (rows ?? []).filter((r) => r.status === status) : rows;

  if (openId !== null) {
    return <RequestDetailView id={openId} roles={roles} onBack={() => setOpenId(null)} onNotice={setNotice} />;
  }

  if (!desktop) {
    const all = rows ?? [];
    const hasNeeds = roles.canPrepare || roles.prepareOwnAs !== undefined || roles.prepareEmployeeRequests === true || roles.canApprove;
    const n = (kind: RequestChip) => all.filter((r) => chipOf(r, roles) === kind).length;
    const chosen: RequestChip = phoneChip ?? (hasNeeds && n("needs") > 0 ? "needs" : "all");
    // What needs you first, then what is waiting on others, then what is finished; newest first within each.
    const order = { needs: 0, waiting: 1, done: 2 } as const;
    const shownRows = (chosen === "all" ? all : all.filter((r) => chipOf(r, roles) === chosen))
      .slice()
      .sort((x, y) => order[chipOf(x, roles)] - order[chipOf(y, roles)] || y.requestedUtc.localeCompare(x.requestedUtc));
    const chips: { key: RequestChip; label: string; count: number }[] = [
      { key: "all", label: "All", count: all.length },
      ...(hasNeeds ? [{ key: "needs" as const, label: "Needs me", count: n("needs") }] : []),
      { key: "waiting", label: hasNeeds ? "Waiting on others" : "In progress", count: n("waiting") },
      { key: "done", label: "Approved", count: n("done") },
    ];
    return (
      <div className={`${PAGE_GAP} pb-20`}>
        {pdfError && <ActionFailure message={pdfError} />}
        {rows !== null && rows.length > 0 && (
          <ChipRow label="Filter requests" chips={chips.map((c) => ({ key: c.key, label: c.label, count: c.count, on: chosen === c.key, onClick: () => setPhoneChip(c.key) }))} />
        )}
        {error ? (
          <LoadError message={error} onRetry={() => setAttempt((v) => v + 1)} />
        ) : rows === null ? (
          <LoadingState label="Loading requests..." rows={4} />
        ) : shownRows.length === 0 ? (
          <p className="rounded-3xl border border-line bg-white px-5 py-10 text-center text-ink-600 shadow-card">
            {chosen === "needs"
              ? "Nothing needs you right now."
              : all.length === 0
                ? roles.canRaise
                  ? "No requests yet. Tap Request letter to ask HR for a certificate."
                  : "Requests raised by supervisors appear here."
                : "No requests in this view."}
          </p>
        ) : (
          <RequestList
            rows={shownRows}
            roles={roles}
            username={user?.username}
            downloading={pending}
            onOpen={setOpenId}
            onDownload={(letterId, refNo) => void download(letterId, refNo)}
          />
        )}
        {roles.canRaise && <Fab label="Request letter" icon={Plus} onClick={() => setRaising(true)} />}
        <PhoneToast message={notice} onDone={() => setNotice(null)} />
        {raising && (
          <NewRequestSheet
            workers={phoneWorkers ?? []}
            loading={phoneWorkers === null && phoneWorkersError === null}
            loadFailure={phoneWorkersError}
            onClose={() => setRaising(false)}
            onDone={(request) => {
              setRaising(false);
              setNotice(`Request sent to HR for ${request.workerName}.`);
              setAttempt((v) => v + 1);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <SuccessRegion message={notice} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {([["", "All"], ...(Object.keys(STATUS_LABELS) as CertificateStatus[]).map((k) => [k, STATUS_LABELS[k]])] as [CertificateStatus | "", string][]).map(([key, label]) => (
            <button
              key={key || "all"}
              type="button"
              aria-pressed={status === key}
              onClick={() => setStatus(key)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${status === key ? "border-brand-600 bg-brand-50 text-brand-800" : "border-ink-300 bg-white text-ink-700 hover:bg-ink-50"}`}
            >
              {label}
              {rows !== null && (
                <span className="rounded-full bg-ink-100 px-1.5 text-xs tabular-nums text-ink-700">
                  {key ? (counts[key] ?? 0) : rows.length}
                </span>
              )}
            </button>
          ))}
        </div>
        {roles.canRaise && headerSlot && createPortal(
          <Button icon={Plus} onClick={() => setRaising(true)}>
            New request
          </Button>,
          headerSlot,
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
        ) : shown === null || shown.length === 0 ? (
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
                {shown.map((row) => (
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
                            {openLabel(row, roles)}
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
