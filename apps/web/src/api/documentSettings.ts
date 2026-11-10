import { apiDelete, apiGet, apiPost, apiPut } from "./client";

export interface DocumentSettings {
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
  defaultPaymentTerms: string;
  defaultInvoiceNotes: string;
  nextInvoiceNumber: number;
  signerName: string;
  signerTitle: string;
  hasLogo: boolean;
  hasSeal: boolean;
  hasSignature: boolean;
}

export type DocumentSettingsInput = Omit<DocumentSettings, "nextInvoiceNumber" | "hasLogo" | "hasSeal" | "hasSignature">;
export type DocumentImageKind = "logo" | "seal" | "signature";

export function getDocumentSettings(): Promise<DocumentSettings> {
  return apiGet("/api/documents/settings");
}
export function updateDocumentSettings(input: DocumentSettingsInput): Promise<DocumentSettings> {
  return apiPut<DocumentSettings>("/api/documents/settings", input);
}
export function uploadDocumentImage(kind: DocumentImageKind, imageBase64: string): Promise<DocumentSettings> {
  return apiPost<DocumentSettings>(`/api/documents/images/${kind}`, { imageBase64 });
}
export async function removeDocumentImage(kind: DocumentImageKind): Promise<void> {
  await apiDelete(`/api/documents/images/${kind}`);
}
