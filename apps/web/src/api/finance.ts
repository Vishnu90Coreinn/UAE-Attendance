import { apiGet, apiGetAnyFile, apiPost, apiPostForm, apiPut } from "./client";

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

export interface FinExpenseInput {
  entryDate: string;
  categoryId: number;
  accountId: number;
  party: string;
  amount: number;
  reference: string;
  notes: string;
  files: File[];
}

function filterQuery(filter: FinEntryFilter): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function listFinExpenses(filter: FinEntryFilter = {}): Promise<FinEntryList> {
  return apiGet(`/api/finance/expenses${filterQuery(filter)}`);
}
export function listFinExpenseParties(): Promise<string[]> {
  return apiGet("/api/finance/expenses/parties");
}
export function createFinExpense(input: FinExpenseInput): Promise<FinEntry> {
  const form = new FormData();
  form.set("entryDate", input.entryDate);
  form.set("categoryId", String(input.categoryId));
  form.set("accountId", String(input.accountId));
  form.set("party", input.party);
  form.set("amount", String(input.amount));
  if (input.reference) form.set("reference", input.reference);
  if (input.notes) form.set("notes", input.notes);
  for (const file of input.files) form.append("files", file, file.name);
  return apiPostForm<FinEntry>("/api/finance/expenses", form);
}
export function getFinReceipt(id: number): Promise<Blob> {
  return apiGetAnyFile(`/api/finance/attachments/${id}`);
}
