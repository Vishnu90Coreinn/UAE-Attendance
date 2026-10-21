import { apiGet, apiPost, apiPut } from "./client";

export interface DeductionType {
  id: number;
  name: string;
  isActive: boolean;
}
export interface DeductionEntry {
  deductionTypeId: number;
  amount: number;
  note: string;
}
export interface MonthDeductionWorker {
  workerId: number;
  workerCode: string;
  fullName: string;
  isActive: boolean;
  entries: DeductionEntry[];
}
export interface MonthDeductions {
  month: string;
  isFinalised: boolean;
  types: DeductionType[];
  workers: MonthDeductionWorker[];
}

export function listDeductionTypes(): Promise<DeductionType[]> {
  return apiGet("/api/deduction-types");
}
export function createDeductionType(name: string): Promise<DeductionType> {
  return apiPost<DeductionType>("/api/deduction-types", { name });
}
export function updateDeductionType(
  id: number,
  name: string,
  isActive: boolean,
): Promise<DeductionType> {
  return apiPut<DeductionType>(`/api/deduction-types/${id}`, { name, isActive });
}
export function getDeductions(month: string): Promise<MonthDeductions> {
  return apiGet(`/api/deductions?month=${encodeURIComponent(month)}`);
}
/** Replaces each listed worker's deductions for the month. Workers not listed are left unchanged. */
export function saveDeductions(
  month: string,
  workers: { workerId: number; entries: DeductionEntry[] }[],
): Promise<MonthDeductions> {
  return apiPut<MonthDeductions>(`/api/deductions/${encodeURIComponent(month)}`, { workers });
}
