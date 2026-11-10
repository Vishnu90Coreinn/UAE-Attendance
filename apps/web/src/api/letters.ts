import { apiGet, apiGetBlob, apiPost } from "./client";

export type LetterType = "Salary" | "Service" | "BankTransfer" | "Noc";

export const LETTER_TYPES: readonly { value: LetterType; label: string }[] = [
  { value: "Salary", label: "Salary Certificate" },
  { value: "Service", label: "Service Certificate" },
  { value: "BankTransfer", label: "Bank Salary Transfer" },
  { value: "Noc", label: "Whom It May Concern" },
];

export function letterTypeLabel(type: string): string {
  return LETTER_TYPES.find((t) => t.value === type)?.label ?? type;
}

/** The body of both preview and issue. Blank text falls back to the server's defaults. */
export interface LetterRequest {
  workerId: number | null;
  letterType: LetterType;
  /** YYYY-MM-DD; omitted means today. */
  issueDate?: string;
  addressedTo?: string;
  salutation?: string;
  purposeNote?: string;
  signerName?: string;
  signerTitle?: string;
  showSeal: boolean;
  /** Used only for a bank letter when the worker has no value of their own. */
  bankName?: string;
  bankAccountNumber?: string;
  iban?: string;
}

export interface LetterRun {
  text: string;
  bold: boolean;
}

export interface LetterSalaryTable {
  basic: number;
  housing: number;
  transport: number;
  other: number;
  total: number;
}

/** Everything printed on a letter, stored as issued. */
export interface LetterContent {
  letterType: LetterType;
  title: string;
  issueDate: string;
  /** Empty for a preview; assigned when the letter is issued. */
  refNo: string;
  addressedTo: string;
  companyName: string;
  address1: string;
  address2: string;
  mobile: string;
  email: string;
  workerName: string;
  workerCode: string;
  designation: string;
  paragraphs: LetterRun[][];
  salary: LetterSalaryTable | null;
  purposeNote: string;
  signerName: string;
  signerTitle: string;
  showSeal: boolean;
}

export interface LetterDocument {
  content: LetterContent;
  hasLogo: boolean;
  hasSeal: boolean;
  hasSignature: boolean;
}

export interface LetterSummary {
  id: number;
  refNo: string;
  letterType: LetterType;
  workerId: number;
  workerName: string;
  workerCode: string;
  issueDate: string;
  addressedTo: string;
  issuedBy: string;
  issuedUtc: string;
}

export interface LetterRecord {
  id: number;
  refNo: string;
  letterType: LetterType;
  workerId: number;
  issueDate: string;
  issuedBy: string;
  issuedUtc: string;
  document: LetterDocument;
}

export interface LetterFilters {
  search?: string;
  type?: LetterType | "";
  from?: string;
  to?: string;
}

export function previewLetter(request: LetterRequest, signal?: AbortSignal): Promise<LetterDocument> {
  return apiPost<LetterDocument>("/api/letters/preview", request, signal);
}

export function issueLetter(request: LetterRequest): Promise<LetterRecord> {
  return apiPost<LetterRecord>("/api/letters", request);
}

export function listLetters(filters: LetterFilters = {}): Promise<LetterSummary[]> {
  const query = new URLSearchParams();
  if (filters.search?.trim()) query.set("search", filters.search.trim());
  if (filters.type) query.set("type", filters.type);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  const text = query.toString();
  return apiGet<LetterSummary[]>(`/api/letters${text ? `?${text}` : ""}`);
}

export function getLetter(id: number): Promise<LetterRecord> {
  return apiGet<LetterRecord>(`/api/letters/${id}`);
}

export function getLetterPdf(id: number): Promise<Blob> {
  return apiGetBlob(`/api/letters/${id}/pdf`);
}

/** The uploaded logo, seal or signature, fetched with the sign-in token so it can be shown in an img tag. */
export function getLetterImage(kind: "logo" | "seal" | "signature"): Promise<Blob> {
  return apiGetBlob(`/api/letters/images/${kind}`);
}
