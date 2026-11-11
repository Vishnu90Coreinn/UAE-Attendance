import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { letterTypeLabel, LETTER_TYPES, getLetter, listLetters, type LetterRecord, type LetterSummary, type LetterType } from "../../api/letters";
import { useAuth } from "../../contexts/AuthContext";
import { Button, Card, EmptyState, Input, PageHeader, Select, Table, TableScroll, Td, Th, THead, TRow, cx } from "../../ui";
import { ActionFailure, LoadError } from "../workers/WorkersFeedback";
import { messageOf, usePdfDownload } from "./letterUi";
import { LetterSheet } from "./LetterSheet";
import { RequestsPanel, type RequestRoles } from "./RequestsPanel";

type Tab = "requests" | "issued";

/** An approved letter on screen with its PDF. */
function LetterDetail({ record, onBack, backLabel }: { record: LetterRecord; onBack: () => void; backLabel: string }) {
  const { pending, error, download } = usePdfDownload();
  return (
    <div>
      {error && <ActionFailure message={error} />}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink-900">{record.refNo}</h3>
          <p className="text-sm text-ink-600">
            {letterTypeLabel(record.letterType)} for {record.document.content.workerName}. Issued by {record.issuedBy}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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


/** Certificate requests (supervisor raises, HR prepares, manager approves) and the approved letters. */
export function LettersPage() {
  const { user } = useAuth();
  const role = user?.role;
  const roles: RequestRoles = {
    canRaise: role === "Supervisor" || role === "Manager" || role === "Administrator",
    canPrepare: role === "HR" || role === "Administrator",
    canApprove: role === "Manager" || role === "Administrator",
    canOpen: role === "HR" || role === "Manager" || role === "Administrator" || role === "Viewer",
  };
  const [tab, setTab] = useState<Tab>("requests");
  const [opened, setOpened] = useState<LetterRecord | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  async function open(id: number) {
    setOpenError(null);
    try {
      setOpened(await getLetter(id));
    } catch (e) {
      setOpenError(messageOf(e));
    }
  }

  useEffect(() => {
    if (!roles.canOpen && tab === "issued") setTab("requests");
  }, [roles.canOpen, tab]);

  if (opened) {
    return (
      <div className="letters-page">
        <PageHeader title="HR Letters" description="Approved certificates and letters." />
        <LetterDetail record={opened} onBack={() => setOpened(null)} backLabel="Back to letters" />
      </div>
    );
  }

  const tabs: (readonly [Tab, string])[] = [["requests", role === "Supervisor" ? "My requests" : "Requests"]];
  if (roles.canOpen) tabs.push(["issued", "Approved letters"]);

  return (
    <div className="letters-page">
      <PageHeader
        title="HR Letters"
        description={
          role === "Supervisor"
            ? "Ask HR for a certificate and follow its progress."
            : "A supervisor requests a certificate, HR prepares it, and a manager approves it before it can be downloaded."
        }
      />
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Certificates" className="mb-5 inline-flex rounded-lg border border-ink-300 bg-white p-1">
          {tabs.map(([key, label]) => (
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
      )}
      {openError && <ActionFailure message={openError} />}
      <div role="tabpanel" id={`letters-panel-${tab}`} aria-labelledby={`letters-tab-${tab}`}>
        {tab === "requests" ? (
          <RequestsPanel roles={roles} defaultStatus={role === "Manager" ? "PendingApproval" : ""} />
        ) : (
          <IssuedLog onOpen={(id) => void open(id)} />
        )}
      </div>
    </div>
  );
}
