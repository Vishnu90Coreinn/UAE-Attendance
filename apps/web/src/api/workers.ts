import { apiDelete, apiGet, apiGetBlob, apiPost, apiPut } from "./client";

export interface Worker {
  id: number;
  workerCode: string;
  fullName: string;
  designation: string;
  /** AED per hour; null for Supervisors, who never see wages. */
  hourlyRate: number | null;
  /** The worker's own overtime rate in AED per hour; null means the company rate applies (or hidden from Supervisors). */
  overtimeRate: number | null;
  /** The overtime rate that actually applies; null for Supervisors. */
  effectiveOvertimeRate: number | null;
  isActive: boolean;
  /** YYYY-MM-DD, or null when not recorded. */
  joinDate?: string | null;
  department?: string | null;
  emiratesId?: string | null;
  passportNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  emergencyContact?: string | null;
  workLocation?: string | null;
  notes?: string | null;
  contractSigned?: boolean;
  visaMedicalCleared?: boolean;
  safetyGearIssued?: boolean;
  siteOrientationDone?: boolean;
  wpsRegistered?: boolean;
  badgeIssued?: boolean;
}

/** The editable fields, sent as the body of create and update. */
export interface WorkerInput {
  workerCode: string;
  fullName: string;
  designation: string;
  hourlyRate: number;
  /** Null or omitted means the worker uses the company overtime rate. */
  overtimeRate?: number | null;
  /** YYYY-MM-DD, or null when unknown. Printed on the payslip. */
  joinDate?: string | null;
  /** Optional profile details; null or omitted means not recorded. */
  department?: string | null;
  emiratesId?: string | null;
  passportNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  emergencyContact?: string | null;
  workLocation?: string | null;
  notes?: string | null;
  /** Onboarding checklist; an omitted item is left unchanged on update. */
  contractSigned?: boolean;
  visaMedicalCleared?: boolean;
  safetyGearIssued?: boolean;
  siteOrientationDone?: boolean;
  wpsRegistered?: boolean;
  badgeIssued?: boolean;
}

export function listWorkers(includeInactive: boolean): Promise<Worker[]> {
  return apiGet<Worker[]>(`/api/workers?includeInactive=${includeInactive}`);
}

/** The suggested ID for the next new worker, for example EMP-005. */
export async function getNextWorkerCode(): Promise<string> {
  const response = await apiGet<{ workerCode: string }>("/api/workers/next-code");
  return response.workerCode;
}

export function createWorker(input: WorkerInput): Promise<Worker> {
  return apiPost<Worker>("/api/workers", input);
}

export function updateWorker(id: number, input: WorkerInput): Promise<Worker> {
  return apiPut<Worker>(`/api/workers/${id}`, input);
}

/** The worker's record as a PDF (Managers, Administrators and HR). */
export function getWorkerProfilePdf(id: number): Promise<Blob> {
  return apiGetBlob(`/api/workers/${id}/profile/pdf`);
}

export function deactivateWorker(id: number): Promise<Worker> {
  return apiPost<Worker>(`/api/workers/${id}/deactivate`, undefined);
}

export function activateWorker(id: number): Promise<Worker> {
  return apiPost<Worker>(`/api/workers/${id}/activate`, undefined);
}

/** A hard delete; the API answers 409 when the worker already has records. */
export function deleteWorker(id: number): Promise<void> {
  return apiDelete(`/api/workers/${id}`);
}
