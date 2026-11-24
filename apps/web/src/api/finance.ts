import { apiGet, apiPost, apiPut } from "./client";

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
