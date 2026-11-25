import { apiGet, apiGetAnyFile, apiGetBlob, apiGetFile, apiPost, apiPostForm, apiPut, apiPutForm } from "./client";

export type FinAccountKind = "Bank" | "Cash";
export type FinEntryKind = "Expense" | "Income";

export interface FinAccount {
  id: number;
  name: string;
  kind: FinAccountKind;
  bankName: string | null;
  /** The Partner gets these masked ("••••8001"); Managers and Administrators get them in full. */
  accountNumber: string | null;
  iban: string | null;
  openingBalance: number;
  /** yyyy-MM-dd */
  openingDate: string;
  isActive: boolean;
  sortOrder: number;
  /** Worked out by the server from the opening balance, entries and transfers. */
  balance: number;
  /** Entries and transfers recorded against the account, voided ones included. */
  entryCount: number;
}

export interface FinAccountInput {
  name: string;
  kind: FinAccountKind;
  bankName: string;
  accountNumber: string;
  iban: string;
  openingBalance: number;
  openingDate: string;
}

export interface FinCategory {
  id: number;
  kind: FinEntryKind;
  name: string;
  isActive: boolean;
  useCount: number;
}

export interface FinTransfer {
  id: number;
  transferNo: string;
  transferDate: string;
  fromAccountId: number;
  fromAccountName: string;
  toAccountId: number;
  toAccountName: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  status: "Active" | "Voided";
  voidReason: string | null;
  createdBy: string;
  createdUtc: string;
}

export interface FinTransferInput {
  transferDate: string;
  fromAccountId: number;
  toAccountId: number;
  amount: number;
  reference: string;
  notes: string;
}

export function listFinAccounts(): Promise<FinAccount[]> {
  return apiGet("/api/finance/accounts?includeInactive=true");
}
export function createFinAccount(input: FinAccountInput): Promise<FinAccount> {
  return apiPost<FinAccount>("/api/finance/accounts", input);
}
export function updateFinAccount(id: number, input: FinAccountInput): Promise<FinAccount> {
  return apiPut<FinAccount>(`/api/finance/accounts/${id}`, input);
}
export function setFinAccountActive(id: number, active: boolean): Promise<FinAccount> {
  return apiPost<FinAccount>(`/api/finance/accounts/${id}/${active ? "activate" : "deactivate"}`, {});
}

export function listFinCategories(includeInactive = true): Promise<FinCategory[]> {
  return apiGet(`/api/finance/categories?includeInactive=${includeInactive}`);
}
export function createFinCategory(kind: FinEntryKind, name: string): Promise<FinCategory> {
  return apiPost<FinCategory>("/api/finance/categories", { kind, name });
}
export function updateFinCategory(id: number, name: string, isActive: boolean): Promise<FinCategory> {
  return apiPut<FinCategory>(`/api/finance/categories/${id}`, { name, isActive });
}

export function listFinTransfers(): Promise<FinTransfer[]> {
  return apiGet("/api/finance/transfers");
}
export function createFinTransfer(input: FinTransferInput): Promise<FinTransfer> {
  return apiPost<FinTransfer>("/api/finance/transfers", input);
}

export interface FinAttachment {
  id: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface FinEntry {
  id: number;
  kind: FinEntryKind;
  entryNo: string;
  entryDate: string;
  categoryId: number;
  categoryName: string;
  party: string;
  accountId: number;
  accountName: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  status: "Active" | "Voided";
  voidReason: string | null;
  createdBy: string;
  createdUtc: string;
  attachments: FinAttachment[];
  voidedBy: string | null;
  voidedUtc: string | null;
  replacesEntryId: number | null;
  /** The entry this one corrects, and the entry that corrected it. */
  replacesEntryNo: string | null;
  replacedByEntryNo: string | null;
}

export interface FinEntryList {
  items: FinEntry[];
  /** Worked out by the server over every match, not just the rows shown. Voided rows are not counted. */
  total: number;
  count: number;
  truncated: boolean;
}

export interface FinEntryFilter {
  from?: string;
  to?: string;
  categoryId?: number;
  accountId?: number;
  min?: number;
  max?: number;
  q?: string;
  includeVoided?: boolean;
}

export interface FinEntryInput {
  entryDate: string;
  categoryId: number;
  accountId: number;
  party: string;
  amount: number;
  reference: string;
  notes: string;
  files: File[];
  /** When correcting: receipts of the original entry to keep. */
  keepAttachmentIds?: number[];
}

function filterQuery(filter: FinEntryFilter): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

const entryPath = (kind: FinEntryKind) => (kind === "Income" ? "/api/finance/income" : "/api/finance/expenses");

export function listFinEntries(kind: FinEntryKind, filter: FinEntryFilter = {}): Promise<FinEntryList> {
  return apiGet(`${entryPath(kind)}${filterQuery(filter)}`);
}
/** Names typed before ("paid to" or "received from"), newest first. */
export function listFinParties(kind: FinEntryKind): Promise<string[]> {
  return apiGet(`${entryPath(kind)}/parties`);
}
function entryForm(input: FinEntryInput): FormData {
  const form = new FormData();
  form.set("entryDate", input.entryDate);
  form.set("categoryId", String(input.categoryId));
  form.set("accountId", String(input.accountId));
  form.set("party", input.party);
  form.set("amount", String(input.amount));
  if (input.reference) form.set("reference", input.reference);
  if (input.notes) form.set("notes", input.notes);
  for (const file of input.files) form.append("files", file, file.name);
  for (const id of input.keepAttachmentIds ?? []) form.append("keepAttachmentIds", String(id));
  return form;
}
export function createFinEntry(kind: FinEntryKind, input: FinEntryInput): Promise<FinEntry> {
  return apiPostForm<FinEntry>(entryPath(kind), entryForm(input));
}
/** Voids the entry and adds a replacement that points back at it. */
export function correctFinEntry(kind: FinEntryKind, id: number, input: FinEntryInput): Promise<FinEntry> {
  return apiPutForm<FinEntry>(`${entryPath(kind)}/${id}`, entryForm(input));
}
export function voidFinEntry(kind: FinEntryKind, id: number, reason: string): Promise<FinEntry> {
  return apiPost<FinEntry>(`${entryPath(kind)}/${id}/void`, { reason });
}
export function voidFinTransfer(id: number, reason: string): Promise<FinTransfer> {
  return apiPost<FinTransfer>(`/api/finance/transfers/${id}/void`, { reason });
}

export interface FinMonthLock {
  month: string;
  isLocked: boolean;
  lockedBy: string | null;
  lockedUtc: string | null;
  unlockedBy: string | null;
  unlockedUtc: string | null;
  unlockReason: string | null;
}
export function listFinMonthLocks(): Promise<FinMonthLock[]> {
  return apiGet("/api/finance/month-locks");
}
export function lockFinMonth(month: string): Promise<FinMonthLock> {
  return apiPost<FinMonthLock>(`/api/finance/month-locks/${month}/lock`, {});
}
export function unlockFinMonth(month: string, reason: string): Promise<FinMonthLock> {
  return apiPost<FinMonthLock>(`/api/finance/month-locks/${month}/unlock`, { reason });
}
export function getFinReceipt(id: number): Promise<Blob> {
  return apiGetAnyFile(`/api/finance/attachments/${id}`);
}

export type FinWindow = 7 | 30 | 365;
export interface FinPeriodTotals {
  income: number;
  expense: number;
  net: number;
}
export interface FinDashboard {
  days: FinWindow;
  from: string;
  to: string;
  totalBalance: number;
  accounts: FinAccount[];
  current: FinPeriodTotals;
  /** The same number of days immediately before `from`, for comparison. */
  previous: FinPeriodTotals;
  granularity: "day" | "month";
  buckets: { start: string; label: string; income: number; expense: number }[];
  spending: { categoryId: number | null; name: string; amount: number; share: number }[];
  latest: { id: number; kind: FinEntryKind; entryNo: string; entryDate: string; categoryName: string; party: string; accountName: string; amount: number }[];
}
export function getFinDashboard(days: FinWindow): Promise<FinDashboard> {
  return apiGet(`/api/finance/dashboard?days=${days}`);
}

export interface FinReportAccount {
  accountId: number;
  name: string;
  kind: FinAccountKind;
  isActive: boolean;
  /** The balance at the start of the period. */
  opening: number;
  income: number;
  expense: number;
  transfersIn: number;
  transfersOut: number;
  /** The balance at the end of the period: opening + income - expenses + transfers in - transfers out. */
  closing: number;
}
export interface FinReportTotals {
  opening: number;
  income: number;
  expense: number;
  transfersIn: number;
  transfersOut: number;
  closing: number;
}
export interface FinReportCategory {
  categoryId: number;
  name: string;
  amount: number;
  count: number;
  share: number;
}
export interface FinReport {
  from: string;
  to: string;
  accounts: FinReportAccount[];
  totals: FinReportTotals;
  period: FinPeriodTotals;
  incomeCategories: FinReportCategory[];
  expenseCategories: FinReportCategory[];
  entryCount: number;
}
export type FinReportFormat = "xlsx" | "pdf" | "csv";

export function getFinReport(from: string, to: string): Promise<FinReport> {
  return apiGet(`/api/finance/reports/summary?from=${from}&to=${to}`);
}
export function getFinReportFile(format: FinReportFormat, from: string, to: string): Promise<Blob> {
  const path = `/api/finance/reports/summary?from=${from}&to=${to}&format=${format}`;
  if (format === "pdf") return apiGetBlob(path);
  return apiGetFile(path, format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
