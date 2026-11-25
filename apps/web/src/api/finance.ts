import { apiDeleteJson, apiGet, apiGetAnyFile, apiGetBlob, apiGetFile, apiPost, apiPostForm, apiPut, apiPutForm } from "./client";

/** Custody is petty cash held by one staff member. */
export type FinAccountKind = "Bank" | "Cash" | "Custody";
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
  /** Staff allowed to submit expenses may choose this account. */
  staffCanUse?: boolean;
  /** Cheques recorded in the books that the bank has not paid or received yet (written add back, received take off). */
  unclearedCheques?: number;
  /** What the bank statement shows: the balance plus the cheques still to clear. */
  bankBalance?: number;
  /** Custody accounts: the staff login that holds the cash. */
  holderUserId?: number | null;
  holderName?: string | null;
}

export interface FinAccountInput {
  name: string;
  kind: FinAccountKind;
  bankName: string;
  accountNumber: string;
  iban: string;
  openingBalance: number;
  openingDate: string;
  staffCanUse?: boolean;
  holderUserId?: number | null;
}

export interface FinCategory {
  id: number;
  kind: FinEntryKind;
  name: string;
  isActive: boolean;
  useCount: number;
  /** The VAT type offered first for this category. */
  defaultTaxTypeId?: number | null;
  /** True when the category never carries VAT (the form starts on "no VAT"). With neither this nor a default, the form asks each time. */
  noVat?: boolean;
  /** Made and used by the app itself; never offered on entry forms. */
  isSystem?: boolean;
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

/** One category's part of an entry; the lines of an entry add up to its amount. */
export interface FinEntryLine {
  categoryId: number;
  categoryName: string;
  amount: number;
  note: string | null;
}

export interface FinEntry {
  /** Set when this is a payment received on a tax invoice, or paid on a supplier bill: it is changed on that document, not here. */
  invoiceId?: number | null;
  billId?: number | null;
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
  /** Pending: submitted by staff and waiting for a Manager. It counts in no balance or report until approved. */
  status: "Active" | "Voided" | "Pending";
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
  /** Capital entries only. */
  partnerId?: number | null;
  payeeId?: number | null;
  /** Largest first. More than one line means the entry is split between categories. */
  lines?: FinEntryLine[];
  /** VAT: the type chosen (null when none was recorded), the rate that applied, and the VAT on the entry. */
  taxTypeId?: number | null;
  taxRate?: number;
  taxAmount?: number;
  taxInclusive?: boolean;
}

export interface FinEntryList {
  items: FinEntry[];
  /** Worked out by the server over every match, not just the rows shown. Voided rows are not counted. */
  total: number;
  count: number;
  truncated: boolean;
  /** Expenses waiting for approval: they are listed but are not in the total. */
  pendingCount?: number;
  pendingTotal?: number;
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
  payeeId?: number;
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
  payeeId?: number | null;
  /** A VAT type id, 0 for "no VAT recorded", or left out for the category default. */
  taxTypeId?: number | null;
  /** Whether the amount typed already contains the VAT. */
  taxInclusive?: boolean;
  /** Splits the amount between categories; the lines must add up to the amount. Without it the entry has one line, categoryId. */
  lines?: { categoryId: number; amount: number; note?: string }[];
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
  if (input.payeeId) form.set("payeeId", String(input.payeeId));
  if (input.taxTypeId !== undefined && input.taxTypeId !== null) {
    form.set("taxTypeId", String(input.taxTypeId));
    form.set("taxInclusive", String(input.taxInclusive ?? true));
  }
  if (input.lines && input.lines.length > 1) form.set("linesJson", JSON.stringify(input.lines));
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
export function getFinReceipt(id: number, mine = false): Promise<Blob> {
  return apiGetAnyFile(mine ? `/api/finance/my/attachments/${id}` : `/api/finance/attachments/${id}`);
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
  /** share is a percentage with one decimal; the shares of the list add up to exactly 100.0. */
  spending: { categoryId: number | null; name: string; amount: number; share: number }[];
  /** Capital entries are listed too, so a change in a balance can be explained. */
  latest: { id: number; kind: FinEntryKind | FinCapitalKind; entryNo: string; entryDate: string; categoryName: string; party: string; accountName: string; amount: number }[];
  /** Present once there is a partner holding capital. */
  capital?: { total: number; partners: { id: number; name: string; netCapital: number; share: number }[] } | null;
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
  /** Capital put in less capital paid back, in the period. */
  capital: number;
  /** The balance at the end of the period: opening + income - expenses + transfers in - transfers out. */
  closing: number;
}
export interface FinReportTotals {
  capital: number;
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
export interface FinReportMonth {
  /** yyyy-MM */
  month: string;
  /** Income and expense entries in the month, voided ones left out. */
  entries: number;
  income: number;
  expense: number;
  net: number;
  /** Capital put in less capital paid back. Not part of income, expense or net. */
  capital: number;
  isLocked: boolean;
  lockedBy: string | null;
  lockedUtc: string | null;
}
export interface FinReportPartner {
  partnerId: number;
  name: string;
  opening: number;
  added: number;
  returned: number;
  closing: number;
  share: number;
}
export interface FinReport {
  partners: FinReportPartner[];
  months: FinReportMonth[];
  from: string;
  to: string;
  accounts: FinReportAccount[];
  totals: FinReportTotals;
  period: FinPeriodTotals;
  incomeCategories: FinReportCategory[];
  expenseCategories: FinReportCategory[];
  entryCount: number;
  /** Who was paid or paid us over the period, largest first. Shares add up to exactly 100.0. */
  expensePayees?: FinReportPayee[];
  incomePayees?: FinReportPayee[];
  enteredBy?: FinReportEnteredBy[];
  cashFlow?: FinCashFlow;
  /** What `months` is cut by: its `month` is yyyy-MM, yyyy, or a date (the Monday for weeks). */
  granularity?: FinGranularity;
}
export type FinGranularity = "day" | "week" | "month" | "year";
export interface FinReportPayee {
  name: string;
  amount: number;
  count: number;
  share: number;
}
export interface FinReportEnteredBy {
  name: string;
  entries: number;
  income: number;
  expense: number;
}
export interface FinCashFlow {
  opening: number;
  income: number;
  expense: number;
  operating: number;
  capitalIn: number;
  capitalOut: number;
  financing: number;
  /** Normally zero; an account that opened inside the period adds its opening balance. */
  other: number;
  netChange: number;
  closing: number;
}
export type FinReportFormat = "xlsx" | "pdf" | "csv";

export function getFinReport(from: string, to: string, granularity: FinGranularity = "month"): Promise<FinReport> {
  return apiGet(`/api/finance/reports/summary?from=${from}&to=${to}&granularity=${granularity}`);
}
export function getFinReportFile(format: FinReportFormat, from: string, to: string, granularity: FinGranularity = "month"): Promise<Blob> {
  const path = `/api/finance/reports/summary?from=${from}&to=${to}&format=${format}&granularity=${granularity}`;
  if (format === "pdf") return apiGetBlob(path);
  return apiGetFile(path, format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

// --- partners and their capital ---------------------------------------------------------------------------------------

export interface FinPartner {
  id: number;
  name: string;
  /** Capital put in before this app was used; already part of the accounts' opening balances. */
  openingCapital: number;
  isActive: boolean;
  sortOrder: number;
  added: number;
  returned: number;
  /** openingCapital + added - returned. */
  netCapital: number;
  /** Percentage of every partner's net capital, two decimals; all shares add up to 100.00. */
  share: number;
  movementCount: number;
  lastMovementDate: string | null;
}
export interface FinPartners {
  partners: FinPartner[];
  totalCapital: number;
}
export interface FinPartnerInput {
  name: string;
  openingCapital: number;
  isActive?: boolean;
}
export type FinCapitalKind = "Capital" | "CapitalOut";
export type FinCapitalEntry = Omit<FinEntry, "kind"> & { kind: FinCapitalKind };
export interface FinCapitalList {
  items: FinCapitalEntry[];
  /** Put in less paid back, over every match. */
  total: number;
  count: number;
  truncated: boolean;
}
export interface FinCapitalInput {
  entryDate: string;
  partnerId: number;
  accountId: number;
  amount: number;
  reference: string;
  notes: string;
  files: File[];
  keepAttachmentIds?: number[];
}

export function listFinPartners(): Promise<FinPartners> {
  return apiGet("/api/finance/partners");
}
export function createFinPartner(input: FinPartnerInput): Promise<FinPartner> {
  return apiPost<FinPartner>("/api/finance/partners", input);
}
export function updateFinPartner(id: number, input: FinPartnerInput): Promise<FinPartner> {
  return apiPut<FinPartner>(`/api/finance/partners/${id}`, input);
}
export function listFinCapital(filter: { partnerId?: number; includeVoided?: boolean } = {}): Promise<FinCapitalList> {
  return apiGet(`/api/finance/capital${filterQuery(filter)}`);
}
function capitalForm(input: FinCapitalInput): FormData {
  const form = new FormData();
  form.set("entryDate", input.entryDate);
  form.set("partnerId", String(input.partnerId));
  form.set("accountId", String(input.accountId));
  form.set("amount", String(input.amount));
  if (input.reference) form.set("reference", input.reference);
  if (input.notes) form.set("notes", input.notes);
  for (const file of input.files) form.append("files", file, file.name);
  for (const id of input.keepAttachmentIds ?? []) form.append("keepAttachmentIds", String(id));
  return form;
}
/** Capital a partner put in ("Capital") or had paid back ("CapitalOut"). */
export function addFinCapital(kind: FinCapitalKind, input: FinCapitalInput): Promise<FinCapitalEntry> {
  return apiPostForm<FinCapitalEntry>(`/api/finance/capital/${kind === "Capital" ? "contributions" : "returns"}`, capitalForm(input));
}
export function correctFinCapital(id: number, input: FinCapitalInput): Promise<FinCapitalEntry> {
  return apiPutForm<FinCapitalEntry>(`/api/finance/capital/${id}`, capitalForm(input));
}
export function voidFinCapital(id: number, reason: string): Promise<FinCapitalEntry> {
  return apiPost<FinCapitalEntry>(`/api/finance/capital/${id}/void`, { reason });
}

export interface FinPayee {
  id: number;
  kind: FinEntryKind;
  name: string;
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  phone: string | null;
  taxNumber: string | null;
  notes: string | null;
  isActive: boolean;
  /** Active entries for this payee and their total. */
  entryCount: number;
  total: number;
}

export interface FinPayeeInput {
  kind?: FinEntryKind;
  name: string;
  defaultCategoryId: number | null;
  phone: string;
  taxNumber: string;
  notes: string;
  isActive?: boolean;
}

export function listFinPayees(kind?: FinEntryKind, includeInactive = false): Promise<FinPayee[]> {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (includeInactive) params.set("includeInactive", "true");
  const text = params.toString();
  return apiGet(`/api/finance/payees${text ? `?${text}` : ""}`);
}
export function createFinPayee(input: FinPayeeInput): Promise<FinPayee> {
  return apiPost<FinPayee>("/api/finance/payees", input);
}
export function updateFinPayee(id: number, input: FinPayeeInput): Promise<FinPayee> {
  return apiPut<FinPayee>(`/api/finance/payees/${id}`, input);
}

export type FinChequeDirection = "Issued" | "Received";
export type FinChequeStatus = "Issued" | "Delivered" | "Received" | "Deposited" | "Cleared" | "Bounced" | "Cancelled";

export interface FinCheque {
  id: number;
  direction: FinChequeDirection;
  serial: string;
  amount: number;
  /** The payee of an issued cheque, the drawer of a received one. */
  partyName: string;
  issueDate: string;
  dueDate: string;
  accountId: number;
  accountName: string;
  status: FinChequeStatus;
  statusDate: string | null;
  statusNote: string | null;
  entryId: number | null;
  entryNo: string | null;
  notes: string | null;
  isOpen: boolean;
  isPostDated: boolean;
  isOverdue: boolean;
  /** The statuses it may move to next; empty once it has cleared, bounced or been cancelled. */
  nextStatuses: FinChequeStatus[];
  createdBy: string;
  createdUtc: string;
}

export interface FinChequeList {
  items: FinCheque[];
  count: number;
  /** Open cheques: money already committed (issued) or expected (received). */
  openIssued: number;
  openReceived: number;
  truncated: boolean;
}

export interface FinChequeFilter {
  direction?: FinChequeDirection;
  status?: FinChequeStatus;
  openOnly?: boolean;
  from?: string;
  to?: string;
  accountId?: number;
  q?: string;
}

export interface FinChequeSummary {
  days: number;
  dueSoonIssued: number;
  dueSoonIssuedCount: number;
  dueSoonReceived: number;
  dueSoonReceivedCount: number;
  overdueCount: number;
  overdueAmount: number;
  laterIssued: number;
  laterIssuedCount: number;
  next: FinCheque[];
}

export interface FinChequeInput {
  direction?: FinChequeDirection;
  serial: string;
  amount: number;
  partyName: string;
  issueDate: string;
  dueDate: string;
  accountId: number;
  entryId: number | null;
  notes: string;
}

export function listFinCheques(filter: FinChequeFilter = {}): Promise<FinChequeList> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  }
  const text = params.toString();
  return apiGet(`/api/finance/cheques${text ? `?${text}` : ""}`);
}
export function getFinChequeSummary(): Promise<FinChequeSummary> {
  return apiGet("/api/finance/cheques/summary");
}
export function createFinCheque(input: FinChequeInput): Promise<FinCheque> {
  return apiPost<FinCheque>("/api/finance/cheques", input);
}
export function updateFinCheque(id: number, input: FinChequeInput): Promise<FinCheque> {
  return apiPut<FinCheque>(`/api/finance/cheques/${id}`, input);
}
export function changeFinChequeStatus(id: number, status: FinChequeStatus, date: string, note: string): Promise<FinCheque> {
  return apiPost<FinCheque>(`/api/finance/cheques/${id}/status`, { status, date, note });
}

export function approveFinExpense(id: number): Promise<FinEntry> {
  return apiPost<FinEntry>(`/api/finance/expenses/${id}/approve`, {});
}
export function rejectFinExpense(id: number, reason: string): Promise<FinEntry> {
  return apiPost<FinEntry>(`/api/finance/expenses/${id}/reject`, { reason });
}

export interface FinSubmitter {
  userId: number;
  username: string;
  role: string;
  canSubmit: boolean;
}
export function listFinSubmitters(): Promise<FinSubmitter[]> {
  return apiGet("/api/finance/submitters");
}
export function setFinSubmitter(userId: number, canSubmit: boolean): Promise<FinSubmitter> {
  return apiPut<FinSubmitter>(`/api/finance/submitters/${userId}`, { canSubmit });
}

/** What a staff member may pick when submitting an expense. */
export interface FinMyOptions {
  accounts: FinAccount[];
  categories: FinCategory[];
  payees: FinPayee[];
  taxTypes?: FinTaxType[];
}
export function getFinMyOptions(): Promise<FinMyOptions> {
  return apiGet("/api/finance/my/options");
}
export function listMyFinExpenses(): Promise<FinEntryList> {
  return apiGet("/api/finance/my/expenses");
}
export function submitFinExpense(input: FinEntryInput): Promise<FinEntry> {
  return apiPostForm<FinEntry>("/api/finance/my/expenses", entryForm(input));
}

export interface FinImportRow {
  row: number;
  date: string | null;
  party: string | null;
  category: string | null;
  account: string | null;
  amount: number | null;
  reference: string | null;
  notes: string | null;
  /** Ready, Duplicate (already recorded, skipped) or Error. */
  status: "Ready" | "Duplicate" | "Error";
  problems: string[];
}
export interface FinImportResult {
  rows: FinImportRow[];
  ready: number;
  duplicates: number;
  errors: number;
  readyTotal: number;
  /** 0 for a preview; the number saved after a confirmed import. */
  imported: number;
}
const importPath = (kind: FinEntryKind) => `/api/finance/import/${kind === "Income" ? "income" : "expenses"}`;
/** Checks the file row by row; with commit it also saves every good row, or none if any row is wrong. */
export function runFinImport(kind: FinEntryKind, file: File, commit: boolean): Promise<FinImportResult> {
  const form = new FormData();
  form.set("file", file, file.name);
  return apiPostForm<FinImportResult>(`${importPath(kind)}?commit=${commit}`, form);
}
export function getFinImportTemplate(kind: FinEntryKind): Promise<Blob> {
  return apiGetFile(`${importPath(kind)}/template`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

// ---- Ledger (the books) ----
export interface LedgerAccount {
  id: number;
  code: string;
  name: string;
  type: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
  isActive: boolean;
  isSystem: boolean;
  debit: number;
  credit: number;
  /** Positive in the account's normal direction: a debit for assets and expenses, a credit for the rest. */
  balance: number;
}
export interface LedgerTrialBalance {
  asOf: string;
  accounts: LedgerAccount[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}
export interface LedgerLine {
  date: string;
  journalNumber: string;
  description: string;
  memo: string | null;
  debit: number;
  credit: number;
  balance: number;
  part: "Post" | "Reversal";
}
export interface LedgerStatement {
  account: LedgerAccount;
  from: string;
  to: string;
  opening: number;
  lines: LedgerLine[];
  closing: number;
}
export interface Journal {
  id: number;
  number: string;
  date: string;
  sourceType: string;
  sourceId: number;
  part: "Post" | "Reversal";
  description: string;
  lines: { accountCode: string; accountName: string; debit: number; credit: number; memo: string | null }[];
  /** Posted by hand by the accountant; only these can be reversed here. */
  isManual?: boolean;
  reversed?: boolean;
  createdBy?: string | null;
}
export interface JournalList {
  items: Journal[];
  count: number;
  truncated: boolean;
}
export interface LedgerCheck {
  name: string;
  subject: string;
  ledger: number;
  screens: number;
  agrees: boolean;
}
export interface LedgerCheckResult {
  allAgree: boolean;
  checks: LedgerCheck[];
  journals: number;
  totalDebit: number;
  totalCredit: number;
  /** Journals posted by hand. The checks compare the records alone, so these are counted apart. */
  manualJournals?: number;
}

export function getLedgerTrialBalance(asOf?: string): Promise<LedgerTrialBalance> {
  return apiGet(`/api/finance/ledger/trial-balance${asOf ? `?asOf=${asOf}` : ""}`);
}
export function getLedgerChart(): Promise<LedgerAccount[]> {
  return apiGet("/api/finance/ledger/accounts");
}
export function getLedgerStatement(id: number, from: string, to: string): Promise<LedgerStatement> {
  return apiGet(`/api/finance/ledger/accounts/${id}/statement?from=${from}&to=${to}`);
}
export function listJournals(from?: string, to?: string): Promise<JournalList> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const text = params.toString();
  return apiGet(`/api/finance/ledger/journals${text ? `?${text}` : ""}`);
}
export function getLedgerCheck(): Promise<LedgerCheckResult> {
  return apiGet("/api/finance/ledger/check");
}

export interface LedgerAccountInput {
  code: string;
  name: string;
  type: LedgerAccount["type"];
  isActive?: boolean;
}
export function createLedgerAccount(input: LedgerAccountInput): Promise<LedgerAccount> {
  return apiPost<LedgerAccount>("/api/finance/ledger/accounts", input);
}
export function updateLedgerAccount(id: number, input: Partial<LedgerAccountInput>): Promise<LedgerAccount> {
  return apiPut<LedgerAccount>(`/api/finance/ledger/accounts/${id}`, input);
}

export interface ManualJournalInput {
  date: string;
  description: string;
  lines: { accountId: number; debit?: number; credit?: number; memo?: string }[];
}
export function postManualJournal(input: ManualJournalInput): Promise<Journal> {
  return apiPost<Journal>("/api/finance/ledger/journals", input);
}
export function reverseManualJournal(id: number, reason: string): Promise<Journal> {
  return apiPost<Journal>(`/api/finance/ledger/journals/${id}/reverse`, { reason });
}

export interface LedgerMapping {
  kind: "Category" | "Account" | "Partner";
  id: number;
  name: string;
  detail: string | null;
  ledgerAccountId: number;
}
export function getLedgerMappings(): Promise<LedgerMapping[]> {
  return apiGet("/api/finance/ledger/mappings");
}
export function setLedgerMapping(kind: LedgerMapping["kind"], id: number, ledgerAccountId: number): Promise<LedgerMapping> {
  return apiPut<LedgerMapping>(`/api/finance/ledger/mappings/${kind}/${id}`, { ledgerAccountId });
}

export type LedgerFile = "xlsx" | "pdf" | "csv";
function ledgerDownload(path: string, format: LedgerFile): Promise<Blob> {
  const url = `${path}${path.includes("?") ? "&" : "?"}format=${format}`;
  if (format === "pdf") return apiGetBlob(url);
  return apiGetFile(url, format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
export const downloadTrialBalance = (format: LedgerFile) => ledgerDownload("/api/finance/ledger/trial-balance", format);
export const downloadLedger = (id: number, from: string, to: string, format: LedgerFile) => ledgerDownload(`/api/finance/ledger/accounts/${id}/statement?from=${from}&to=${to}`, format);
export const downloadJournals = (format: LedgerFile) => ledgerDownload("/api/finance/ledger/journals", format);

export interface StatementLine {
  code: string;
  name: string;
  amount: number;
}
export interface ProfitAndLoss {
  from: string;
  to: string;
  revenue: StatementLine[];
  totalRevenue: number;
  expenses: StatementLine[];
  totalExpenses: number;
  netProfit: number;
  /** Journals posted by hand in the period, included in the figures. */
  manualJournals: number;
}
export interface BalanceSheet {
  asOf: string;
  assets: StatementLine[];
  totalAssets: number;
  liabilities: StatementLine[];
  totalLiabilities: number;
  equity: StatementLine[];
  /** Every revenue less every expense up to the date; there is no year-end closing yet. */
  retainedProfit: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  balanced: boolean;
}
export function getProfitAndLoss(from: string, to: string): Promise<ProfitAndLoss> {
  return apiGet(`/api/finance/ledger/profit-and-loss?from=${from}&to=${to}`);
}
export function getBalanceSheet(asOf: string): Promise<BalanceSheet> {
  return apiGet(`/api/finance/ledger/balance-sheet?asOf=${asOf}`);
}
export const downloadProfitAndLoss = (from: string, to: string, format: LedgerFile) => ledgerDownload(`/api/finance/ledger/profit-and-loss?from=${from}&to=${to}`, format);
export const downloadBalanceSheet = (asOf: string, format: LedgerFile) => ledgerDownload(`/api/finance/ledger/balance-sheet?asOf=${asOf}`, format);

// ---- VAT ----
export type FinTaxTreatment = "Standard" | "ZeroRated" | "Exempt" | "ReverseCharge" | "IntraGcc";
export interface FinTaxType {
  id: number;
  name: string;
  treatment: FinTaxTreatment;
  rate: number;
}
export function listFinTaxTypes(): Promise<FinTaxType[]> {
  return apiGet("/api/finance/tax-types");
}
/** A VAT type id, 0 for "this category never carries VAT", or null for "ask each time". */
export function setCategoryTaxDefault(categoryId: number, taxTypeId: number | null): Promise<FinCategory> {
  return apiPut<FinCategory>(`/api/finance/categories/${categoryId}/tax-default`, { taxTypeId });
}

export interface FinVatRow {
  taxTypeId: number;
  taxType: string;
  treatment: FinTaxTreatment;
  rate: number;
  count: number;
  net: number;
  vat: number;
}
export interface FinVatReport {
  from: string;
  to: string;
  sales: FinVatRow[];
  purchases: FinVatRow[];
  /** VAT charged on sales plus the VAT accounted for on reverse-charge purchases. */
  outputVat: number;
  /** VAT paid on purchases plus the same reverse-charge VAT, which is reclaimed. */
  inputVat: number;
  /** Output less input: positive is owed, negative is a refund. */
  netPayable: number;
  unrecordedSales: { count: number; amount: number };
  unrecordedPurchases: { count: number; amount: number };
}
export function getFinVatReport(from: string, to: string): Promise<FinVatReport> {
  return apiGet(`/api/finance/reports/vat?from=${from}&to=${to}`);
}
export function getFinVatFile(format: FinReportFormat, from: string, to: string): Promise<Blob> {
  const path = `/api/finance/reports/vat?from=${from}&to=${to}&format=${format}`;
  if (format === "pdf") return apiGetBlob(path);
  return apiGetFile(path, format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

// ---- Year-end close ----
export interface FinYear {
  year: number;
  status: "Open" | "Closed";
  revenue: number;
  expenses: number;
  netResult: number;
  journalNumber: string | null;
  closedBy: string | null;
  closedUtc: string | null;
  canClose: boolean;
  canReopen: boolean;
  /** Why the year cannot be closed yet, in a sentence. */
  blocker: string | null;
}
export function listFinYears(): Promise<FinYear[]> {
  return apiGet<FinYear[]>("/api/finance/ledger/years");
}
export function closeFinYear(year: number): Promise<FinYear> {
  return apiPost<FinYear>(`/api/finance/ledger/years/${year}/close`, {});
}
export function reopenFinYear(year: number, reason: string): Promise<FinYear> {
  return apiPost<FinYear>(`/api/finance/ledger/years/${year}/reopen`, { reason });
}

// ---- Receivables (unpaid tax invoices) ----
export interface ReceivableRow {
  invoiceId: number;
  number: string;
  client: string;
  invoiceDate: string;
  dueDate: string;
  total: number;
  paid: number;
  balance: number;
  daysOverdue: number;
  bucket: string;
}
export interface ReceivableBucket {
  name: string;
  count: number;
  amount: number;
}
export interface ReceivablesReport {
  asOf: string;
  rows: ReceivableRow[];
  buckets: ReceivableBucket[];
  totalOwed: number;
  /** Payments entered before invoices were tied to the books: they reduce an invoice here but not the ledger. */
  unrecordedPayments: number;
}
export function getReceivables(asOf?: string): Promise<ReceivablesReport> {
  return apiGet<ReceivablesReport>(`/api/finance/ledger/receivables${asOf ? `?asOf=${asOf}` : ""}`);
}

// ---- Supplier bills (payables) ----
export type FinBillDisplay = "Open" | "PartPaid" | "Paid" | "Overdue" | "Voided";
export interface FinBillLine {
  categoryId: number;
  category: string;
  amount: number;
  note: string | null;
}
export interface FinBillPayment {
  entryId: number;
  entryNo: string;
  date: string;
  amount: number;
  account: string;
  reference: string | null;
}
export interface FinBill {
  id: number;
  billNo: string;
  supplierName: string;
  payeeId: number | null;
  supplierRef: string | null;
  billDate: string;
  dueDate: string;
  notes: string | null;
  status: "Open" | "Voided";
  display: FinBillDisplay;
  taxTypeId: number | null;
  taxType: string | null;
  taxAmount: number;
  net: number;
  total: number;
  paid: number;
  balance: number;
  lines: FinBillLine[];
  payments: FinBillPayment[];
  voidReason: string | null;
  createdBy: string;
  /** The supplier's invoice, kept with the bill. */
  files?: FinAttachment[];
}
export interface FinBillInput {
  supplierName: string;
  payeeId: number | null;
  supplierRef: string;
  billDate: string;
  dueDate: string;
  notes: string;
  /** 0 or null records no VAT. Line amounts are before VAT. */
  taxTypeId: number | null;
  lines: { categoryId: number; amount: number; note: string }[];
}
export type FinBillFilter = "all" | "unpaid" | "overdue" | "paid" | "voided";
export function listFinBills(status: FinBillFilter = "all", q = ""): Promise<FinBill[]> {
  const params = new URLSearchParams({ status });
  if (q.trim()) params.set("q", q.trim());
  return apiGet<FinBill[]>(`/api/finance/bills?${params.toString()}`);
}
export function createFinBill(input: FinBillInput): Promise<FinBill> {
  return apiPost<FinBill>("/api/finance/bills", input);
}
export function payFinBill(id: number, input: { date: string; amount: number; accountId: number; reference: string }): Promise<FinBill> {
  return apiPost<FinBill>(`/api/finance/bills/${id}/pay`, input);
}
export function removeFinBillPayment(id: number, entryId: number, reason: string): Promise<FinBill> {
  return apiPost<FinBill>(`/api/finance/bills/${id}/payments/${entryId}/remove`, { reason });
}
export function voidFinBill(id: number, reason: string): Promise<FinBill> {
  return apiPost<FinBill>(`/api/finance/bills/${id}/void`, { reason });
}

export interface PayableRow {
  billId: number;
  billNo: string;
  supplier: string;
  supplierRef: string | null;
  billDate: string;
  dueDate: string;
  total: number;
  paid: number;
  balance: number;
  daysOverdue: number;
  bucket: string;
}
export interface PayablesReport {
  asOf: string;
  rows: PayableRow[];
  buckets: ReceivableBucket[];
  totalOwed: number;
}
export function getPayables(asOf?: string): Promise<PayablesReport> {
  return apiGet<PayablesReport>(`/api/finance/ledger/payables${asOf ? `?asOf=${asOf}` : ""}`);
}

// ---- Recurring journals ----
export interface RecurringJournal {
  id: number;
  description: string;
  dayOfMonth: number;
  startMonth: string;
  endMonth: string | null;
  isActive: boolean;
  lines: { accountCode: string; accountName: string; debit: number; credit: number; memo: string | null }[];
  amount: number;
  /** Months already posted, the next month to post (yyyy-MM), and how many months can be posted today. */
  posted: number;
  nextMonth: string | null;
  due: number;
  createdBy: string;
  stoppedBy: string | null;
}
export interface RecurringJournalInput {
  description: string;
  dayOfMonth: number;
  startMonth: string;
  endMonth?: string;
  lines: { accountId: number; debit?: number; credit?: number; memo?: string }[];
}
export interface RecurringRunResult {
  posted: number;
  skipped: { id: number; description: string; month: string; reason: string }[];
}
export function listRecurringJournals(): Promise<RecurringJournal[]> {
  return apiGet<RecurringJournal[]>("/api/finance/ledger/recurring");
}
export function createRecurringJournal(input: RecurringJournalInput): Promise<RecurringJournal> {
  return apiPost<RecurringJournal>("/api/finance/ledger/recurring", input);
}
export function stopRecurringJournal(id: number): Promise<RecurringJournal> {
  return apiPost<RecurringJournal>(`/api/finance/ledger/recurring/${id}/stop`, {});
}
export function postDueRecurringJournals(): Promise<RecurringRunResult> {
  return apiPost<RecurringRunResult>("/api/finance/ledger/recurring/post-due", {});
}

export function uploadFinBillFiles(id: number, files: File[]): Promise<FinBill> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  return apiPostForm<FinBill>(`/api/finance/bills/${id}/files`, form);
}
export function removeFinBillFile(id: number, fileId: number): Promise<FinBill> {
  return apiDeleteJson<FinBill>(`/api/finance/bills/${id}/files/${fileId}`, {});
}
export function getFinBillFile(fileId: number): Promise<Blob> {
  return apiGetAnyFile(`/api/finance/bills/files/${fileId}`);
}
