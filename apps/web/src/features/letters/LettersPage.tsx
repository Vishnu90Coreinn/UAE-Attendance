import { useEffect, useState } from "react";
import { Download, FileText, Loader2, Search } from "lucide-react";
import { letterTypeLabel, LETTER_TYPES, getLetter, listLetters, type LetterRecord, type LetterSummary, type LetterType } from "../../api/letters";
import { useAuth } from "../../contexts/AuthContext";
import { LoadingState, Button, Card, EmptyState, Input, PageHeader, Select, Table, TableScroll, Td, Th, THead, TRow, cx } from "../../ui";
import { ActionFailure, LoadError } from "../workers/WorkersFeedback";
import { messageOf, usePdfDownload } from "./letterUi";
import { LetterSheet } from "./LetterSheet";
import { RequestsPanel } from "./RequestsPanel";
import type { RequestRoles } from "./requestRoles";
import { ChipRow, LetterCards } from "./LettersPhone";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { PAGE_GAP, PhoneTitle } from "../../components/phoneUi";

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
  const desktop = useIsDesktop();
  const [datesOpen, setDatesOpen] = useState(false);

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

  if (!desktop) {
    const dateInput = "mt-1.5 block min-h-12 w-full rounded-xl border border-ink-300 bg-white px-3 text-base text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";
    return (
      <div className={`${PAGE_GAP} pb-4`}>
        <div className="relative">
          <label htmlFor="letters-search" className="sr-only">
            Search
          </label>
          <Search aria-hidden="true" size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            id="letters-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Worker, reference or addressee"
            autoComplete="off"
            className="block min-h-12 w-full rounded-2xl border border-line bg-white pl-11 pr-4 text-base text-ink-900 shadow-card placeholder:text-ink-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
          />
        </div>
        <ChipRow
          label="Filter by type"
          chips={[
            { key: "all", label: "All types", on: type === "", onClick: () => setType("") },
            ...LETTER_TYPES.map((t) => ({ key: t.value, label: t.label, on: type === t.value, onClick: () => setType(type === t.value ? "" : t.value) })),
          ]}
        />
        <div>
          <button
            type="button"
            aria-expanded={datesOpen}
            onClick={() => setDatesOpen((v) => !v)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-1 text-sm font-bold text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            Date range{from || to ? " (on)" : ""}
          </button>
          {datesOpen && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="letters-from" className="text-sm font-bold text-ink-800">
                  From
                </label>
                <input id="letters-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={dateInput} />
              </div>
              <div>
                <label htmlFor="letters-to" className="text-sm font-bold text-ink-800">
                  To
                </label>
                <input id="letters-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={dateInput} />
              </div>
            </div>
          )}
        </div>
        {pdfError && <ActionFailure message={pdfError} />}
        {error ? (
          <LoadError message={error} onRetry={() => setAttempt((n) => n + 1)} />
        ) : rows === null ? (
          <LoadingState label="Loading letters..." rows={4} />
        ) : rows.length === 0 ? (
          <p className="rounded-3xl border border-line bg-white px-5 py-10 text-center text-ink-600 shadow-card">
            No letters found. Issued certificates and letters appear here.
          </p>
        ) : (
          <LetterCards rows={rows} downloading={pending} onOpen={onOpen} onDownload={(id, refNo) => void download(id, refNo)} />
        )}
      </div>
    );
  }

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
        <LoadingState label="Loading letters..." rows={4} />
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
  const desktop = useIsDesktop();
  const role = user?.role;
  const roles: RequestRoles = {
    canRaise: role === "Supervisor" || role === "Manager" || role === "Administrator",
    canPrepare: role === "HR" || role === "Administrator",
    prepareOwnAs: role === "Manager" ? user?.username : undefined,
    prepareEmployeeRequests: role === "Manager" || role === "Administrator",
    canApprove: role === "Manager" || role === "Administrator",
    canOpen: role === "HR" || role === "Manager" || role === "Administrator" || role === "Viewer",
  };
  const [tab, setTab] = useState<Tab>("requests");
  const [opened, setOpened] = useState<LetterRecord | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  // Where the requests list puts "New request": level with the page title, while the list keeps the state it opens.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

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
        {desktop ? <PageHeader title="HR Letters" description="Approved certificates and letters." /> : <div className="mb-5"><PhoneTitle title="HR Letters" /></div>}
        <LetterDetail record={opened} onBack={() => setOpened(null)} backLabel="Back to letters" />
      </div>
    );
  }

  const tabs: (readonly [Tab, string])[] = [["requests", role === "Supervisor" ? "My requests" : "Requests"]];
  if (roles.canOpen) tabs.push(["issued", "Approved letters"]);

  return (
    <div className="letters-page">
      {desktop ? (
        <PageHeader
          title="HR Letters"
          description={
            role === "Supervisor"
              ? "Ask HR for a certificate and follow its progress."
              : "A supervisor requests a certificate, HR prepares it, and a manager approves it before it can be downloaded."
          }
          actions={tab === "requests" && roles.canRaise ? <div ref={setHeaderSlot} /> : undefined}
        />
      ) : (
        <div className="mb-5">
          <PhoneTitle title="HR Letters" />
        </div>
      )}
      {tabs.length > 1 && (
        <div
          role="tablist"
          aria-label="Certificates"
          className={desktop ? "mb-5 inline-flex rounded-lg border border-ink-300 bg-white p-1" : "mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-ink-100 p-1"}
        >
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
                "min-h-11 px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 md:min-h-9",
                desktop ? "rounded-md" : "min-h-12 rounded-xl font-bold",
                tab === key ? (desktop ? "bg-brand-600 text-white" : "bg-white text-ink-900 shadow-card") : "text-ink-700 hover:bg-ink-100",
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
          <RequestsPanel roles={roles} defaultStatus={role === "Manager" ? "PendingApproval" : ""} headerSlot={headerSlot} />
        ) : (
          <IssuedLog onOpen={(id) => void open(id)} />
        )}
      </div>
    </div>
  );
}
