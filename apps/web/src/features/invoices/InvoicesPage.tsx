import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Banknote, Download, FilePlus2, FileText, Hourglass, Loader2, Users } from "lucide-react";
import {
  getInvoice, getInvoicesCsv, listInvoiceClients, listInvoices,
  type Invoice, type InvoiceClient, type InvoiceFilters, type InvoiceStatusFilter, type InvoiceSummary,
} from "../../api/invoices";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { Button, Card, Pager, SortTh, usePaging, useSort, EmptyState, PageHeader, Select, StatCard, Table, TableScroll, THead, TRow, Td } from "../../ui";
import { TextField } from "../../components/TextField";
import { LoadError } from "../workers/WorkersFeedback";
import { ClientsDialog } from "./ClientsDialog";
import { downloadFile } from "./download";
import { InvoiceEditor } from "./InvoiceEditor";
import { formatMoney } from "./invoiceMath";
import { errorMessage, formatDate, InvoiceStatusBadges } from "./invoiceUi";
import { InvoiceView } from "./InvoiceView";
import "./invoice.css";

type Mode = { kind: "list" } | { kind: "new" } | { kind: "edit"; invoice: Invoice } | { kind: "view"; invoice: Invoice };

const STATUS_OPTIONS: { value: InvoiceStatusFilter | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "Draft", label: "Draft" },
  { value: "Issued", label: "Issued (unpaid)" },
  { value: "PartPaid", label: "Part-paid" },
  { value: "Paid", label: "Paid" },
  { value: "Overdue", label: "Overdue" },
  { value: "Cancelled", label: "Cancelled" },
];

/** Tax invoices: Managers and the Administrator create and issue them; HR can read, print and download. */
export function InvoicesPage() {
  const { user } = useAuth();
  const canWrite = isManagement(user?.role);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [filters, setFilters] = useState<InvoiceFilters>({});
  const [rows, setRows] = useState<InvoiceSummary[] | null>(null);
  const [clients, setClients] = useState<InvoiceClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = Object.values(filters).filter((v) => v !== undefined && v !== "").length;

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await listInvoices(filters));
    } catch (e) {
      setRows(null);
      setError(errorMessage(e));
    }
  }, [filters]);

  useEffect(() => {
    if (mode.kind === "list") void load();
  }, [mode.kind, load]);

  const loadClients = useCallback(() => {
    listInvoiceClients(true).then(setClients).catch(() => undefined);
  }, []);
  useEffect(loadClients, [loadClients]);

  async function open(id: number) {
    try {
      setMode({ kind: "view", invoice: await getInvoice(id) });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      downloadFile(await getInvoicesCsv(filters), "Invoices.csv");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  // Figures describe the invoices in view, so they follow the filters.
  const live = (rows ?? []).filter((r) => r.displayStatus !== "Draft" && r.displayStatus !== "Cancelled");
  const invoiced = live.reduce((sum, r) => sum + r.total, 0);
  const collected = live.reduce((sum, r) => sum + r.amountPaid, 0);
  const outstanding = live.reduce((sum, r) => sum + r.balanceDue, 0);
  const overdueRows = live.filter((r) => r.isOverdue);
  const overdueAmount = overdueRows.reduce((sum, r) => sum + r.balanceDue, 0);

  const { sorted, sort, toggle } = useSort(rows ?? [], {
    number: (r) => r.number,
    client: (r) => r.clientName,
    project: (r) => r.project,
    date: (r) => r.invoiceDate,
    due: (r) => r.dueDate,
    total: (r) => r.total,
    balance: (r) => r.balanceDue,
    status: (r) => r.displayStatus,
  });
  const paging = usePaging(sorted);
  const thClass = "border-b border-line px-4 py-3 font-semibold";

  if (mode.kind === "new" || mode.kind === "edit") {
    return (
      <section>
        <PageHeader title={mode.kind === "new" ? "New tax invoice" : "Edit draft invoice"} />
        <InvoiceEditor
          invoice={mode.kind === "edit" ? mode.invoice : undefined}
          onSaved={(invoice) => setMode({ kind: "view", invoice })}
          onCancel={() => setMode(mode.kind === "edit" ? { kind: "view", invoice: mode.invoice } : { kind: "list" })}
        />
      </section>
    );
  }

  if (mode.kind === "view") {
    return (
      <section>
        <PageHeader
          title={mode.invoice.number ?? "Draft invoice"}
          description={mode.invoice.clientName}
          actions={
            <Button variant="secondary" icon={ArrowLeft} onClick={() => setMode({ kind: "list" })} className="invoice-controls">
              All invoices
            </Button>
          }
        />
        <InvoiceView
          invoice={mode.invoice}
          canWrite={canWrite}
          onChanged={(invoice) => setMode({ kind: "view", invoice })}
          onEdit={() => setMode({ kind: "edit", invoice: mode.invoice })}
          onDeleted={() => setMode({ kind: "list" })}
          onOpen={(invoice) => setMode({ kind: "view", invoice })}
        />
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title="Tax Invoices"
        description="Create, issue and track UAE tax invoices (5% VAT)."
        actions={
          <>
            <Button variant="secondary" icon={Users} onClick={() => setClientsOpen(true)}>Clients</Button>
            <Button variant="secondary" icon={exporting ? Loader2 : Download} disabled={exporting} onClick={exportCsv}>Export CSV</Button>
            {canWrite && <Button icon={FilePlus2} onClick={() => setMode({ kind: "new" })}>New invoice</Button>}
          </>
        }
      />

      {rows && rows.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard compact label="Invoiced (AED)" value={formatMoney(invoiced)} icon={FileText} note={`${live.length} issued invoice${live.length === 1 ? "" : "s"}`} />
          <StatCard compact label="Collected (AED)" value={formatMoney(collected)} icon={Banknote} tone="success" />
          <StatCard compact label="Outstanding (AED)" value={formatMoney(outstanding)} icon={Hourglass} tone="warning" />
          <StatCard compact label="Past due (AED)" value={formatMoney(overdueAmount)} icon={AlertTriangle} tone="danger" note={`${overdueRows.length} invoice${overdueRows.length === 1 ? "" : "s"}`} />
        </div>
      )}

      <Card className="mb-3 p-3 md:px-4">
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between text-sm font-semibold text-ink-800 sm:hidden"
          aria-expanded={filtersOpen}
          aria-controls="invoice-filters"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <span>Filters{activeFilters > 0 ? ` (${activeFilters} active)` : ""}</span>
          <span aria-hidden="true">{filtersOpen ? "Hide" : "Show"}</span>
        </button>
        <form id="invoice-filters" role="search" aria-label="Filter invoices" className={`mt-3 gap-3 sm:mt-0 sm:grid sm:grid-cols-2 sm:gap-y-2 lg:grid-cols-4 xl:grid-cols-7 md:[&_label]:text-xs md:[&_label]:text-ink-600 md:[&_input]:min-h-9 md:[&_select]:min-h-9 md:[&_input]:py-0 ${filtersOpen ? "grid" : "hidden"}`} onSubmit={(e) => e.preventDefault()}>
          <div className="sm:col-span-2">
            <TextField label="Search" placeholder="Number, client, project or LPO" value={filters.q ?? ""} onChange={(e) => setFilters({ ...filters, q: e.target.value || undefined })} />
          </div>
          <Select label="Client" value={filters.clientId ?? ""} onChange={(e) => setFilters({ ...filters, clientId: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <TextField label="Project" value={filters.project ?? ""} onChange={(e) => setFilters({ ...filters, project: e.target.value || undefined })} />
          <TextField label="From" type="date" value={filters.from ?? ""} onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })} />
          <TextField label="To" type="date" value={filters.to ?? ""} onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })} />
          <Select label="Status" value={filters.status ?? ""} onChange={(e) => setFilters({ ...filters, status: (e.target.value || undefined) as InvoiceStatusFilter | undefined })}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </form>
      </Card>

      {error && <LoadError message={error} onRetry={() => void load()} />}
      {!error && rows === null && (
        <p role="status" className="flex items-center gap-2 py-8 text-sm text-ink-500">
          <Loader2 aria-hidden="true" size={20} className="animate-spin" />
          Loading invoices...
        </p>
      )}
      {rows && rows.length === 0 && (
        <Card>
          <EmptyState icon={FileText} title="No invoices found" description={Object.values(filters).some(Boolean) ? "Try clearing the filters." : canWrite ? "Create the first invoice to get started." : "Invoices will appear here once a manager creates them."} />
        </Card>
      )}
      {rows && rows.length > 0 && (
        <Card>
          <TableScroll>
            <Table className="md:[&_td]:py-2 md:[&_th]:py-2.5">
              <caption className="sr-only">Invoices</caption>
              <THead>
                <TRow className="hover:bg-transparent">
                  <SortTh label="Invoice" sortKey="number" sort={sort} onToggle={toggle} className={thClass} />
                  <SortTh label="Client" sortKey="client" sort={sort} onToggle={toggle} className={thClass} />
                  <SortTh label="Project" sortKey="project" sort={sort} onToggle={toggle} className={thClass} />
                  <SortTh label="Date" sortKey="date" sort={sort} onToggle={toggle} className={thClass} />
                  <SortTh label="Due" sortKey="due" sort={sort} onToggle={toggle} className={thClass} />
                  <SortTh label="Total (AED)" sortKey="total" sort={sort} onToggle={toggle} className={`${thClass} text-right`} align="right" />
                  <SortTh label="Balance (AED)" sortKey="balance" sort={sort} onToggle={toggle} className={`${thClass} text-right`} align="right" />
                  <SortTh label="Status" sortKey="status" sort={sort} onToggle={toggle} className={thClass} />
                </TRow>
              </THead>
              <tbody>
                {paging.pageRows.map((r) => (
                  <TRow key={r.id}>
                    <Td>
                      <button type="button" className="min-h-11 whitespace-nowrap rounded font-semibold text-brand-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 md:min-h-0" onClick={() => void open(r.id)}>
                        {r.number ?? "Draft"}
                        <span className="sr-only">{`, ${r.clientName}`}</span>
                      </button>
                    </Td>
                    <Td className="max-w-[16rem] break-words font-medium">{r.clientName}</Td>
                    <Td className="max-w-[12rem] break-words">{r.project || "-"}</Td>
                    <Td>{formatDate(r.invoiceDate)}</Td>
                    <Td className={r.isOverdue ? "font-medium text-danger" : undefined}>{formatDate(r.dueDate)}</Td>
                    <Td numeric>{formatMoney(r.total)}</Td>
                    <Td numeric>{r.status === "Issued" ? formatMoney(r.balanceDue) : "-"}</Td>
                    <Td><InvoiceStatusBadges status={r.displayStatus} overdue={r.isOverdue} /></Td>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </TableScroll>
          <Pager {...paging} onPage={paging.setPage} className="border-t border-line px-4 pb-3" />
        </Card>
      )}

      <ClientsDialog open={clientsOpen} onClose={() => setClientsOpen(false)} onChanged={loadClients} canWrite={canWrite} />
    </section>
  );
}
