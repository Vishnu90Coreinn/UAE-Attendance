import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Download, FilePlus2, FileText, Loader2, Users } from "lucide-react";
import {
  getInvoice, getInvoicesCsv, listInvoiceClients, listInvoices,
  type Invoice, type InvoiceClient, type InvoiceFilters, type InvoiceStatusFilter, type InvoiceSummary,
} from "../../api/invoices";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { Button, Card, EmptyState, PageHeader, Select, Table, TableScroll, THead, Th, TRow, Td } from "../../ui";
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

      <Card className="mb-4 p-4">
        <form role="search" aria-label="Filter invoices" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => e.preventDefault()}>
          <div className="lg:col-span-2">
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
            <Table>
              <caption className="sr-only">Invoices</caption>
              <THead>
                <TRow className="hover:bg-transparent">
                  <Th>Invoice</Th>
                  <Th>Client</Th>
                  <Th>Project</Th>
                  <Th>Date</Th>
                  <Th>Due</Th>
                  <Th align="right">Total (AED)</Th>
                  <Th align="right">Balance (AED)</Th>
                  <Th>Status</Th>
                </TRow>
              </THead>
              <tbody>
                {rows.map((r) => (
                  <TRow key={r.id}>
                    <Td>
                      <button type="button" className="min-h-11 rounded font-semibold text-brand-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 md:min-h-0" onClick={() => void open(r.id)}>
                        {r.number ?? "Draft"}
                        <span className="sr-only">{`, ${r.clientName}`}</span>
                      </button>
                    </Td>
                    <Td className="max-w-[16rem] break-words">{r.clientName}</Td>
                    <Td className="max-w-[12rem] break-words">{r.project || "-"}</Td>
                    <Td>{formatDate(r.invoiceDate)}</Td>
                    <Td>{formatDate(r.dueDate)}</Td>
                    <Td numeric>{formatMoney(r.total)}</Td>
                    <Td numeric>{r.status === "Issued" ? formatMoney(r.balanceDue) : "-"}</Td>
                    <Td><InvoiceStatusBadges status={r.displayStatus} overdue={r.isOverdue} /></Td>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}

      <ClientsDialog open={clientsOpen} onClose={() => setClientsOpen(false)} onChanged={loadClients} canWrite={canWrite} />
    </section>
  );
}
