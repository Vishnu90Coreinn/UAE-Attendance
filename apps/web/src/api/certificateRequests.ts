import { apiGet, apiPost, apiPut } from "./client";
import type { LetterDocument, LetterRequest, LetterType } from "./letters";

export type CertificateStatus = "Requested" | "PendingApproval" | "Returned" | "Approved";

export const STATUS_LABELS: Record<CertificateStatus, string> = {
  Requested: "Requested",
  PendingApproval: "Awaiting approval",
  Returned: "Returned by manager",
  Approved: "Approved",
};

export interface CertificateRequest {
  id: number;
  workerId: number;
  workerName: string;
  workerCode: string;
  letterType: LetterType;
  /** The supervisor's note: what the certificate is for. */
  reason: string;
  status: CertificateStatus;
  requestedBy: string;
  requestedUtc: string;
  preparedBy: string | null;
  preparedUtc: string | null;
  reviewedBy: string | null;
  reviewedUtc: string | null;
  /** Why the manager sent it back; empty otherwise. */
  reviewNote: string;
  hasDetails: boolean;
  /** Set once approved: the issued letter and its reference number. */
  letterId: number | null;
  refNo: string | null;
}

/** The request with HR's saved details and the letter built from them (or the issued letter once approved). */
export interface CertificateRequestDetail {
  request: CertificateRequest;
  details: LetterRequest | null;
  document: LetterDocument | null;
}

export function createRequest(body: { workerId: number; letterType: LetterType; reason: string }): Promise<CertificateRequest> {
  return apiPost<CertificateRequest>("/api/certificate-requests", body);
}

export function listRequests(status?: CertificateStatus): Promise<CertificateRequest[]> {
  return apiGet(`/api/certificate-requests${status ? `?status=${status}` : ""}`);
}

export function getRequest(id: number): Promise<CertificateRequestDetail> {
  return apiGet(`/api/certificate-requests/${id}`);
}

export function saveDetails(id: number, details: LetterRequest): Promise<CertificateRequest> {
  return apiPut<CertificateRequest>(`/api/certificate-requests/${id}/details`, details);
}

export function submitRequest(id: number): Promise<CertificateRequest> {
  return apiPost<CertificateRequest>(`/api/certificate-requests/${id}/submit`, {});
}

export function approveRequest(id: number): Promise<CertificateRequest> {
  return apiPost<CertificateRequest>(`/api/certificate-requests/${id}/approve`, {});
}

export function rejectRequest(id: number, reason: string): Promise<CertificateRequest> {
  return apiPost<CertificateRequest>(`/api/certificate-requests/${id}/reject`, { reason });
}
