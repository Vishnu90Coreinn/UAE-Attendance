import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, Send } from "lucide-react";
import { getDocumentSettings } from "../../api/documentSettings";
import { saveDetails, submitRequest, type CertificateRequestDetail } from "../../api/certificateRequests";
import { letterTypeLabel, previewLetter, type LetterDocument, type LetterRequest } from "../../api/letters";
import { listWorkers, type Worker } from "../../api/workers";
import { Button, Card, EmptyState, Input, Select, Textarea } from "../../ui";
import { FileText } from "lucide-react";
import { ActionFailure, SuccessRegion } from "../workers/WorkersFeedback";
import { dubaiToday, fieldErrorsOf, messageOf, type Errors } from "./letterUi";
import { LetterSheet } from "./LetterSheet";

const SALUTATIONS = ["Mr.", "Ms.", "Mrs.", "Eng."];

interface PrepareLetterProps {
  /** The request being prepared, with whatever details HR saved earlier. */
  detail: CertificateRequestDetail;
  /** Called after the details are saved (the request is still with HR). */
  onSaved: (message: string) => void;
  /** Called after the request was sent to a manager for approval. */
  onSubmitted: () => void;
}

/** HR adds or updates the details of a requested certificate, sees the letter as it will print, and sends it for approval. */
export function PrepareLetter({ detail, onSaved, onSubmitted }: PrepareLetterProps) {
  const certificate = detail.request;
  const saved = detail.details;
  const letterType = certificate.letterType;
  const workerId = String(certificate.workerId);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [salutation, setSalutation] = useState(saved?.salutation ?? "Mr.");
  const [issueDate, setIssueDate] = useState(saved?.issueDate ?? dubaiToday());
  const [addressedTo, setAddressedTo] = useState(saved?.addressedTo ?? "");
  const [purposeNote, setPurposeNote] = useState(saved?.purposeNote ?? "");
  const [signerName, setSignerName] = useState(saved?.signerName ?? "");
  const [signerTitle, setSignerTitle] = useState(saved?.signerTitle ?? "");
  const [defaultSigner, setDefaultSigner] = useState<{ name: string; title: string } | null>(null);
  const [showSeal, setShowSeal] = useState(saved?.showSeal ?? true);
  const [bankName, setBankName] = useState(saved?.bankName ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(saved?.bankAccountNumber ?? "");
  const [iban, setIban] = useState(saved?.iban ?? "");

  const [preview, setPreview] = useState<LetterDocument | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Show the company's saved signatory as the starting value, so the common case needs no typing.
  useEffect(() => {
    let cancelled = false;
    getDocumentSettings()
      .then((s) => {
        if (cancelled) return;
        setDefaultSigner({ name: s.signerName, title: s.signerTitle });
        setSignerName((current) => current || s.signerName);
        setSignerTitle((current) => current || s.signerTitle);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listWorkers(true)
      .then((list) => !cancelled && setWorkers(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const worker = workers.find((w) => String(w.id) === workerId);
  // The bank fields are asked for only when a bank letter has nothing to use from the worker's own profile.
  const workerHasBank = !!(worker?.bankName && worker.bankAccountNumber && worker.iban);
  const askBank = letterType === "BankTransfer" && !!worker && !workerHasBank;

  const draft: LetterRequest = useMemo(
    () => ({
      workerId: workerId ? Number(workerId) : null,
      letterType,
      issueDate: issueDate || undefined,
      salutation,
      addressedTo,
      purposeNote,
      signerName,
      signerTitle,
      showSeal,
      bankName: askBank ? bankName : undefined,
      bankAccountNumber: askBank ? bankAccountNumber : undefined,
      iban: askBank ? iban : undefined,
    }),
    [workerId, letterType, issueDate, salutation, addressedTo, purposeNote, signerName, signerTitle, showSeal, askBank, bankName, bankAccountNumber, iban],
  );

  // The preview is built by the server (the same wording that is stored when the letter is issued), a moment after typing stops.
  useEffect(() => {
    if (!draft.workerId) {
      setPreview(null);
      setErrors({});
      return;
    }
    const controller = new AbortController();
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      previewLetter(draft, controller.signal)
        .then((doc) => {
          setPreview(doc);
          setErrors({});
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setPreview(null);
          const fields = fieldErrorsOf(error);
          setErrors(Object.keys(fields).length > 0 ? fields : { general: messageOf(error) });
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewing(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft]);

  async function run(kind: "save" | "submit") {
    if (busy) return;
    setBusy(kind);
    setFailure(null);
    setNotice(null);
    try {
      await saveDetails(certificate.id, draft);
      if (kind === "submit") {
        await submitRequest(certificate.id);
        onSubmitted();
      } else {
        setNotice("Details saved. Send the request for approval when it is ready.");
        onSaved("Details saved.");
      }
    } catch (error) {
      const fields = fieldErrorsOf(error);
      setErrors(fields);
      setFailure(Object.keys(fields).length > 0 ? "Please fix the highlighted fields." : messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <Card className="self-start p-5">
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run("submit");
          }}
        >
          <div className="rounded-lg bg-ink-50 p-3 text-sm">
            <p className="font-semibold text-ink-900">
              {certificate.workerName} <span className="font-normal text-ink-600">({certificate.workerCode})</span>
            </p>
            <p className="text-ink-700">{letterTypeLabel(letterType)}</p>
            {certificate.reason && <p className="mt-1 text-ink-600">Requested by {certificate.requestedBy}: {certificate.reason}</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Select label="Salutation" value={salutation} onChange={(e) => setSalutation(e.target.value)} error={errors.salutation}>
              {SALUTATIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
            <div className="col-span-2">
              <Input label="Issue date" type="date" max={dubaiToday()} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} error={errors.issueDate} />
            </div>
          </div>
          <Input
            label="Addressed to"
            placeholder="e.g. The Branch Manager, Emirates NBD"
            hint="Leave blank for To Whom It May Concern."
            value={addressedTo}
            onChange={(e) => setAddressedTo(e.target.value)}
            error={errors.addressedTo}
          />
          <Textarea
            label="Purpose note"
            rows={3}
            placeholder="This certificate is issued upon the request of the employee..."
            hint="Leave blank for the standard no-liability wording."
            value={purposeNote}
            onChange={(e) => setPurposeNote(e.target.value)}
            error={errors.purposeNote}
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <Input
              label="Signatory name"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              error={errors.signerName}
              hint={defaultSigner && !defaultSigner.name ? "No default is saved yet. Add one in Settings to skip this next time." : undefined}
            />
            <Input label="Signatory title" value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} error={errors.signerTitle} />
          </div>
          {askBank && (
            <fieldset className="space-y-3 rounded-lg border border-line bg-ink-50 p-3">
              <legend className="px-1 text-sm font-semibold text-ink-800">Bank details for this letter</legend>
              <p className="text-sm text-ink-600">This worker has no bank details saved. Enter them here or add them to the worker profile.</p>
              <Input label="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} error={errors.bankName} />
              <Input label="Bank account number" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} error={errors.bankAccountNumber} />
              <Input label="IBAN" value={iban} onChange={(e) => setIban(e.target.value)} error={errors.iban} />
            </fieldset>
          )}
          <label className="flex min-h-11 items-center gap-3 text-sm text-ink-800">
            <input type="checkbox" className="size-5 accent-brand-600" checked={showSeal} onChange={(e) => setShowSeal(e.target.checked)} />
            Include signature
          </label>

          {failure && <ActionFailure message={failure} />}
          {notice && <SuccessRegion message={notice} />}
          <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
            <Button type="button" variant="secondary" icon={busy === "save" ? Loader2 : Save} disabled={busy !== null} aria-busy={busy === "save"} className="flex-1" onClick={() => void run("save")}>
              {busy === "save" ? "Saving..." : "Save details"}
            </Button>
            <Button type="submit" icon={busy === "submit" ? Loader2 : Send} disabled={busy !== null} aria-busy={busy === "submit"} className="flex-1">
              {busy === "submit" ? "Sending..." : "Send for approval"}
            </Button>
          </div>
          <p className="text-sm text-ink-600">A manager reviews the letter and approves it. The reference number is given only on approval.</p>
        </form>
      </Card>

      <div className="min-w-0">
        {errors.general && <ActionFailure message={errors.general} />}
        {!worker ? (
          <Card>
            <EmptyState icon={FileText} title="Choose a worker to see the letter" description="The preview fills in as you choose the worker and type." />
          </Card>
        ) : preview ? (
          <div aria-busy={previewing}>
            <LetterSheet document={preview} />
          </div>
        ) : (
          <Card>
            <p role="status" className="p-6 text-sm text-ink-600">
              {previewing ? "Building the preview..." : `${Object.values(errors)[0] ?? "Complete the highlighted details."} The preview appears once it is filled in.`}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

