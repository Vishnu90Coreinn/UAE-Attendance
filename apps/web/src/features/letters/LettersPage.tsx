import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Loader2, Printer, Send } from "lucide-react";
import { ApiError } from "../../api/client";
import {
  getLetter,
  getLetterPdf,
  issueLetter,
  letterTypeLabel,
  LETTER_TYPES,
  listLetters,
  previewLetter,
  type LetterDocument,
  type LetterRecord,
  type LetterRequest,
  type LetterSummary,
  type LetterType,
} from "../../api/letters";
import { listWorkers, type Worker } from "../../api/workers";
import { Button, Card, EmptyState, Input, PageHeader, Select, Table, TableScroll, Td, Textarea, Th, THead, TRow, cx } from "../../ui";
import { saveBlob } from "../payroll/downloadPdf";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { LetterSheet } from "./LetterSheet";

type Tab = "new" | "issued";
type Errors = Record<string, string>;

function dubaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.fieldErrors ? Object.values(error.fieldErrors).flat().join(" ") : error.message;
  return "Something went wrong. Please try again.";
}

function fieldErrorsOf(error: unknown): Errors {
  const result: Errors = {};
  if (error instanceof ApiError && error.fieldErrors) {
    for (const [key, messages] of Object.entries(error.fieldErrors)) result[key] = messages.join(" ");
  }
  return result;
}

function fileNameFor(refNo: string): string {
  return `${refNo.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
}

/** Download button used on the log and on an opened letter. */
function usePdfDownload() {
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const download = useCallback(async (id: number, refNo: string) => {
    setPending(id);
    setError(null);
    try {
      saveBlob(await getLetterPdf(id), fileNameFor(refNo));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(null);
    }
  }, []);
  return { pending, error, download };
}

/** An issued letter on screen with Print and PDF. Printing shows only the letter. */
function LetterDetail({ record, notice, onBack, backLabel }: { record: LetterRecord; notice?: string; onBack: () => void; backLabel: string }) {
  const { pending, error, download } = usePdfDownload();
  return (
    <div>
      <SuccessRegion message={notice ?? null} />
      {error && <ActionFailure message={error} />}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink-900">{record.refNo}</h3>
          <p className="text-sm text-ink-600">
            {letterTypeLabel(record.letterType)} for {record.document.content.workerName}. Issued by {record.issuedBy}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>
            Print
          </Button>
          <Button
            variant="secondary"
            icon={pending === record.id ? Loader2 : Download}
            disabled={pending === record.id}
            aria-busy={pending === record.id}
            onClick={() => void download(record.id, record.refNo)}
          >
            Download PDF
          </Button>
          <Button variant="primary" onClick={onBack}>
            {backLabel}
          </Button>
        </div>
      </div>
      <LetterSheet document={record.document} />
    </div>
  );
}

const SALUTATIONS = ["Mr.", "Ms.", "Mrs.", "Eng."];

function NewLetter({ workers, onIssued }: { workers: Worker[]; onIssued: (record: LetterRecord) => void }) {
  const [workerId, setWorkerId] = useState("");
  const [letterType, setLetterType] = useState<LetterType>("Salary");
  const [salutation, setSalutation] = useState("Mr.");
  const [issueDate, setIssueDate] = useState(dubaiToday);
  const [addressedTo, setAddressedTo] = useState("");
  const [purposeNote, setPurposeNote] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [showSeal, setShowSeal] = useState(true);
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [iban, setIban] = useState("");

  const [preview, setPreview] = useState<LetterDocument | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [issuing, setIssuing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const worker = workers.find((w) => String(w.id) === workerId);
  // The bank fields are asked for only when a bank letter has nothing to use from the worker's own profile.
  const workerHasBank = !!(worker?.bankName && worker.bankAccountNumber && worker.iban);
  const askBank = letterType === "BankTransfer" && !!worker && !workerHasBank;

  const request: LetterRequest = useMemo(
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
    if (!request.workerId) {
      setPreview(null);
      setErrors({});
      return;
    }
    const controller = new AbortController();
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      previewLetter(request, controller.signal)
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
  }, [request]);

  async function issue() {
    if (issuing) return;
    setIssuing(true);
    setFailure(null);
    try {
      onIssued(await issueLetter(request));
    } catch (error) {
      const fields = fieldErrorsOf(error);
      setErrors(fields);
      setFailure(Object.keys(fields).length > 0 ? "Please fix the highlighted fields." : messageOf(error));
    } finally {
      setIssuing(false);
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
            void issue();
          }}
        >
          <Select label="Worker" value={workerId} onChange={(e) => setWorkerId(e.target.value)} error={errors.workerId}>
            <option value="">Choose a worker...</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.fullName} ({w.workerCode})
              </option>
            ))}
          </Select>

          <fieldset>
            <legend className="text-sm font-medium text-ink-800">Letter type</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {LETTER_TYPES.map((t) => (
                <label
                  key={t.value}
                  className={cx(
                    "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500",
                    letterType === t.value ? "border-brand-600 bg-brand-50 font-semibold text-brand-800" : "border-ink-300 text-ink-700",
                  )}
                >
                  <input type="radio" name="letterType" className="accent-brand-600" checked={letterType === t.value} onChange={() => setLetterType(t.value)} />
                  {t.label}
                </label>
              ))}
            </div>
            {errors.letterType && <p className="mt-1 text-sm text-danger">{errors.letterType}</p>}
          </fieldset>

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
            <Input label="Signatory name" value={signerName} onChange={(e) => setSignerName(e.target.value)} error={errors.signerName} hint="Blank uses the name in Settings." />
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
            Include company seal and signature
          </label>

          {failure && <ActionFailure message={failure} />}
          <Button type="submit" icon={issuing ? Loader2 : Send} disabled={issuing || !workerId} aria-busy={issuing} className="w-full">
            {issuing ? "Issuing..." : "Issue letter"}
          </Button>
          <p className="text-sm text-ink-600">Issuing gives the letter its reference number and saves it. An issued letter cannot be edited.</p>
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
              {previewing ? "Building the preview..." : "Complete the highlighted details to see the preview."}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function IssuedLog({ onOpen }: { onOpen: (id: number) => void }) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<LetterType | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<LetterSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { pending, error: pdfError, download } = usePdfDownload();

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      listLetters({ search, type, from, to })
        .then((data) => {
          if (!cancelled) {
            setRows(data);
            setError(null);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(messageOf(e));
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, type, from, to, attempt]);

  return (
    <Card>
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="Search" placeholder="Worker, reference or addressee" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as LetterType | "")}>
          <option value="">All types</option>
          {LETTER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {pdfError && (
        <div className="p-4 pb-0">
          <ActionFailure message={pdfError} />
        </div>
      )}
      {error ? (
        <div className="p-4">
          <LoadError message={error} onRetry={() => setAttempt((n) => n + 1)} />
        </div>
      ) : rows === null ? (
        <p role="status" className="flex items-center gap-2 p-6 text-sm text-ink-600">
          <Loader2 aria-hidden="true" size={18} className="animate-spin" />
          Loading letters...
        </p>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title="No letters found" description="Issued certificates and letters appear here." />
      ) : (
        <TableScroll>
          <Table>
            <THead>
              <tr>
                <Th>Reference</Th>
                <Th>Date</Th>
                <Th>Worker</Th>
                <Th>Type</Th>
                <Th>Addressed to</Th>
                <Th>Issued by</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((row) => (
                <TRow key={row.id}>
                  <Td className="whitespace-nowrap font-medium">{row.refNo}</Td>
                  <Td className="whitespace-nowrap">{row.issueDate}</Td>
                  <Td>
                    {row.workerName} <span className="text-ink-500">({row.workerCode})</span>
                  </Td>
                  <Td>{letterTypeLabel(row.letterType)}</Td>
                  <Td>{row.addressedTo}</Td>
                  <Td>{row.issuedBy}</Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" aria-label={`Open ${row.refNo}`} onClick={() => onOpen(row.id)}>
                        Open
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Download PDF ${row.refNo}`}
                        icon={pending === row.id ? Loader2 : Download}
                        disabled={pending === row.id}
                        onClick={() => void download(row.id, row.refNo)}
                      >
                        PDF
                      </Button>
                    </div>
                  </Td>
                </TRow>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Card>
  );
}

export function LettersPage() {
  const [tab, setTab] = useState<Tab>("new");
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [workersError, setWorkersError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ record: LetterRecord; notice?: string } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const loaded = useRef(false);

  const loadWorkers = useCallback(() => {
    setWorkersError(null);
    listWorkers(false)
      .then(setWorkers)
      .catch((e: unknown) => setWorkersError(messageOf(e)));
  }, []);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    loadWorkers();
  }, [loadWorkers]);

  async function open(id: number) {
    setOpenError(null);
    try {
      setOpened({ record: await getLetter(id) });
    } catch (e) {
      setOpenError(messageOf(e));
    }
  }

  if (opened) {
    return (
      <div className="letters-page">
        <PageHeader title="HR Letters" description="Certificates and letters issued to workers." />
        <LetterDetail
          record={opened.record}
          notice={opened.notice}
          backLabel={opened.notice ? "Issue another" : "Back to letters"}
          onBack={() => {
            if (opened.notice) {
              setFormKey((k) => k + 1);
              setTab("new");
            } else {
              setTab("issued");
            }
            setOpened(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="letters-page">
      <PageHeader title="HR Letters" description="Issue salary, service and bank certificates and NOC letters, and find those already issued." />
      <div role="tablist" aria-label="Letters" className="mb-5 inline-flex rounded-lg border border-ink-300 bg-white p-1">
        {(
          [
            ["new", "New letter"],
            ["issued", "Issued letters"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`letters-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`letters-panel-${key}`}
            onClick={() => setTab(key)}
            className={cx(
              "min-h-11 rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 md:min-h-9",
              tab === key ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {openError && <ActionFailure message={openError} />}
      <div role="tabpanel" id={`letters-panel-${tab}`} aria-labelledby={`letters-tab-${tab}`}>
        {tab === "new" ? (
          workersError ? (
            <LoadError message={workersError} onRetry={loadWorkers} />
          ) : workers === null ? (
            <p role="status" className="flex items-center gap-2 py-8 text-sm text-ink-600">
              <Loader2 aria-hidden="true" size={18} className="animate-spin" />
              Loading workers...
            </p>
          ) : (
            <NewLetter
              key={formKey}
              workers={workers}
              onIssued={(record) => setOpened({ record, notice: `Letter ${record.refNo} was issued and saved.` })}
            />
          )
        ) : (
          <IssuedLog onOpen={(id) => void open(id)} />
        )}
      </div>
    </div>
  );
}
