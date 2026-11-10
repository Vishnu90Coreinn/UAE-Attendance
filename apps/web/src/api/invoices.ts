import { apiDelete, apiGet, apiGetBlob, apiGetFile, apiPost, apiPut } from "./client";

export type InvoiceStatus = "Draft" | "Issued" | "Cancelled";
/** What the list shows: the stored status refined by payments. Overdue is a separate flag. */
export type InvoiceDisplayStatus = "Draft" | "Issued" | "PartPaid" | "Paid" | "Cancelled";
export type InvoiceStatusFilter = InvoiceDisplayStatus | "Overdue";

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  rate: number;
}

export interface InvoiceInput {
  clientId: number | null;
  clientName: string;
  clientTrn: string;
  clientAddress: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms: string;
  lpoRef: string;
  project: string;
  scope: string;
  notes: string;
  lines: InvoiceLineInput[];
}

export interface InvoiceLine extends InvoiceLineInput {
  lineNo: number;
  taxable: number;
  vat: number;
  amount: number;
}

export interface InvoicePayment {
  id: number;
  paidDate: string;
  amount: number;
  method: string;
  reference: string;
  recordedBy: string;
}

export interface InvoiceCompany {
  companyName: string;
  companySubtitle: string;
  companyNameAr: string;
  mobile: string;
  address1: string;
  address2: string;
  email: string;
  trn: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  iban: string;
  hasLogo: boolean;
}

export interface Invoice extends Omit<InvoiceInput, "lines"> {
  id: number;
  number: string | null;
  status: InvoiceStatus;
  displayStatus: InvoiceDisplayStatus;
  isOverdue: boolean;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  subTotal: number;
  vatTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  totalInWords: string;
  company: InvoiceCompany;
  createdBy: string;
  issuedUtc: string | null;
  issuedBy: string | null;
  cancelledUtc: string | null;
  cancelReason: string | null;
}

export interface InvoiceSummary {
  id: number;
  number: string | null;
  status: InvoiceStatus;
  displayStatus: InvoiceDisplayStatus;
  isOverdue: boolean;
  clientName: string;
  project: string;
  lpoRef: string;
  invoiceDate: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
}

export interface InvoiceFilters {
  q?: string;
  clientId?: number;
  project?: string;
  from?: string;
  to?: string;
  status?: InvoiceStatusFilter;
}

export interface PaymentInput {
  paidDate: string;
  amount: number;
  method: string;
  reference: string;
}

export interface InvoiceClient {
  id: number;
  name: string;
  trn: string;
  address: string;
  isActive: boolean;
}

function query(filters: InvoiceFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.clientId) params.set("clientId", String(filters.clientId));
  if (filters.project) params.set("project", filters.project);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.status) params.set("status", filters.status);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function listInvoices(filters: InvoiceFilters = {}): Promise<InvoiceSummary[]> {
  return apiGet(`/api/invoices${query(filters)}`);
}
export function getInvoice(id: number): Promise<Invoice> {
  return apiGet(`/api/invoices/${id}`);
}
export function createInvoice(input: InvoiceInput): Promise<Invoice> {
  return apiPost<Invoice>("/api/invoices", input);
}
export function updateInvoice(id: number, input: InvoiceInput): Promise<Invoice> {
  return apiPut<Invoice>(`/api/invoices/${id}`, input);
}
export function deleteInvoice(id: number): Promise<void> {
  return apiDelete(`/api/invoices/${id}`);
}
export function duplicateInvoice(id: number): Promise<Invoice> {
  return apiPost<Invoice>(`/api/invoices/${id}/duplicate`, {});
}
export function issueInvoice(id: number): Promise<Invoice> {
  return apiPost<Invoice>(`/api/invoices/${id}/issue`, {});
}
export function cancelInvoice(id: number, reason: string): Promise<Invoice> {
  return apiPost<Invoice>(`/api/invoices/${id}/cancel`, { reason });
}
export function addPayment(id: number, input: PaymentInput): Promise<Invoice> {
  return apiPost<Invoice>(`/api/invoices/${id}/payments`, input);
}
export async function removePayment(id: number, paymentId: number): Promise<Invoice> {
  // The server answers with the updated invoice, which the typed helper for DELETE does not return.
  await apiDelete(`/api/invoices/${id}/payments/${paymentId}`);
  return getInvoice(id);
}
export function getInvoicePdf(id: number): Promise<Blob> {
  return apiGetBlob(`/api/invoices/${id}/pdf`);
}
export function getInvoicesCsv(filters: InvoiceFilters = {}): Promise<Blob> {
  return apiGetFile(`/api/invoices/export${query(filters)}`, "text/csv");
}

export function listInvoiceClients(includeInactive = false): Promise<InvoiceClient[]> {
  return apiGet(`/api/invoice-clients${includeInactive ? "?includeInactive=true" : ""}`);
}
export function createInvoiceClient(input: Omit<InvoiceClient, "id" | "isActive">): Promise<InvoiceClient> {
  return apiPost<InvoiceClient>("/api/invoice-clients", input);
}
export function updateInvoiceClient(id: number, input: Omit<InvoiceClient, "id">): Promise<InvoiceClient> {
  return apiPut<InvoiceClient>(`/api/invoice-clients/${id}`, input);
}
