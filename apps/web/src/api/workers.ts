import { apiDelete, apiGet, apiPost, apiPut } from "./client";

export interface Worker {
  id: number;
  workerCode: string;
  fullName: string;
  designation: string;
  /** AED per hour; a JSON number with at most two decimal places. */
  hourlyRate: number;
  isActive: boolean;
}

/** The four editable fields, sent as the body of create and update. */
export interface WorkerInput {
  workerCode: string;
  fullName: string;
  designation: string;
  hourlyRate: number;
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
