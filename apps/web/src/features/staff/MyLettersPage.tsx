import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Download, Send } from "lucide-react";
import { getMyLetterPdf, getMyLetters, requestMyLetter } from "../../api/staff";
import { STATUS_LABELS, type CertificateRequest, type CertificateStatus } from "../../api/certificateRequests";
import { LETTER_TYPES, letterTypeLabel } from "../../api/letters";
import { Button, Card, CardHeader, EmptyState, LoadingState, PageHeader, Select, StatusBadge, Textarea, type StatusTone } from "../../ui";
import { saveBlob } from "../payroll/downloadPdf";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { PhoneToast } from "../../components/PhoneToast";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { MyLettersPhone } from "./MyLettersPhone";
import { Stepper } from "./staffKit";
import { errorText, shortDate } from "./staffUi";

const STEPS = ["Requested", "Prepared", "Ready"] as const;
const STEP_INDEX: Record<CertificateStatus, number> = { Requested: 0, Returned: 0, PendingApproval: 1, Approved: 3 };

const TONE: Record<CertificateStatus, StatusTone> = { Requested: "info", PendingApproval: "warning", Returned: "danger", Approved: "success" };

/** What the employee sees at each step; the preparing and approving are done by a manager. */
const PROGRESS: Record<CertificateStatus, string> = {
  Requested: "Sent to your manager, who will prepare it.",
  PendingApproval: "Prepared and waiting for final approval.",
  Returned: "Your manager is revising it.",
  Approved: "Ready. Download your letter.",
};

export function MyLettersPage() {
  const desktop = useIsDesktop();
  const [requests, setRequests] = useState<CertificateRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<string>(LETTER_TYPES[0].value);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRequests(await getMyLetters());
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    setSuccess(null);
    try {
      await requestMyLetter(type, reason.trim());
      setReason("");
      setSuccess("Request sent. Your manager will prepare the letter.");
      await load();
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setPending(false);
    }
  }

  async function download(request: CertificateRequest) {
    setFailure(null);
    setBusyId(request.id);
    try {
      saveBlob(await getMyLetterPdf(request.id), `${(request.refNo ?? "Letter").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`);
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setBusyId(null);
    }
  }

  async function sendFromPhone(letterType: string, why: string) {
    setFailure(null);
    try {
      await requestMyLetter(letterType, why);
    } catch (e) {
      throw new Error(errorText(e));
    }
    setSuccess("Request sent. Your manager will prepare the letter.");
    await load();
  }

  if (error) return <LoadError message={error} onRetry={() => void load()} />;
  if (!requests) return <LoadingState label="Loading..." />;

  if (!desktop) {
    return (
      <>
        <MyLettersPhone requests={requests} busyId={busyId} onSend={sendFromPhone} onDownload={(r) => void download(r)} />
        <PhoneToast message={failure ?? success} error={failure !== null} onDone={() => (failure ? setFailure(null) : setSuccess(null))} />
      </>
    );
  }

  return (
    <section>
      <PageHeader title="My Letters" description="Ask for a salary, service or other certificate. Your manager prepares and approves it." />

      <Card className="mb-6">
        <CardHeader title="Request a letter" />
        <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2" noValidate>
          <Select label="Type of letter" value={type} onChange={(e) => setType(e.target.value)}>
            {LETTER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <div className="sm:col-span-2">
            <Textarea
              label="What is it for? (optional)"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              hint="For example: visa application, bank loan, rent contract."
            />
          </div>
          <div className="sm:col-span-2">
            {failure && <ActionFailure message={failure} />}
            <SuccessRegion message={success} />
            <div className="mt-3 flex justify-end">
              <Button type="submit" icon={Send} disabled={pending}>
                {pending ? "Sending..." : "Send request"}
              </Button>
            </div>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="My requests" />
        {requests.length === 0 ? (
          <EmptyState title="No letter requests yet" description="Requests you send appear here with their progress." />
        ) : (
          <ul className="divide-y divide-line">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{letterTypeLabel(r.letterType)}</p>
                  <p className="text-sm text-ink-600">
                    Requested {shortDate(r.requestedUtc.slice(0, 10))}
                    {r.refNo ? ` · Ref ${r.refNo}` : ""}
                  </p>
                  {r.reason && <p className="mt-1 text-sm text-ink-700">{r.reason}</p>}
                  <div className="mt-3"><Stepper steps={STEPS} current={STEP_INDEX[r.status]} note={PROGRESS[r.status]} /></div>
                  {r.status !== "Approved" && <p className="mt-2 text-sm text-ink-600">{PROGRESS[r.status]}</p>}
                  {r.status === "Returned" && r.reviewNote && <p className="mt-1 text-sm text-red-800">{r.reviewNote}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={TONE[r.status]} variant="soft">
                    {STATUS_LABELS[r.status]}
                  </StatusBadge>
                  {r.status === "Approved" && (
                    <Button size="sm" icon={Download} disabled={busyId === r.id} onClick={() => void download(r)}>
                      Download
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
