import { apiDeleteJson, apiGet, apiGetBlob, apiPost } from "./client";

export interface PayrollAmounts {
  daysWorked: number;
  basicHours: number;
  overtimeHours: number;
  basicPay: number;
  overtimePay: number;
  /** Gross: basic + overtime. */
  totalPay: number;
  totalDeductions: number;
  /** Net: gross minus deductions. This is the amount paid. */
  netPay: number;
}
export interface PayrollDeduction {
  name: string;
  amount: number;
  note: string;
}
export interface PayrollLine extends PayrollAmounts {
  workerId: number;
  workerCode: string;
  workerName: string;
  designation: string;
  hourlyRate: number;
  overtimeRate: number;
  deductions: PayrollDeduction[];
}
export interface PayrollReport {
  period: string;
  status: "Draft" | "Finalised";
  company: {
    companyName: string;
    tagline: string;
    contactEmail: string;
    preparedByLabel: string;
    approvedByLabel: string;
  };
  lines: PayrollLine[];
  totals: PayrollAmounts;
  /** A stable digest of the report figures and letterhead used to prevent export drift. */
  revision: string;
  finalisedBy?: string | null;
  finalisedUtc?: string | null;
}
export function getPayroll(month: string): Promise<PayrollReport> {
  return apiGet(`/api/payroll?month=${encodeURIComponent(month)}`);
}
export function getPayrollPdf(month: string, revision: string): Promise<Blob> {
  return apiGetBlob(
    `/api/payroll/pdf?month=${encodeURIComponent(month)}&revision=${encodeURIComponent(revision)}`,
  );
}
export function finalisePayroll(
  month: string,
  revision: string,
): Promise<PayrollReport> {
  return apiPost(`/api/payroll/${encodeURIComponent(month)}/finalise`, {
    revision,
  });
}
export function reopenPayroll(
  month: string,
  reason: string,
): Promise<PayrollReport> {
  return apiDeleteJson(`/api/payroll/${encodeURIComponent(month)}/finalise`, {
    reason,
  });
}

/** One worker's payslip, or every worker's payslips in one PDF. Available only once the month is finalised. */
export function getPayslipPdf(month: string, workerId?: number): Promise<Blob> {
  const base = `/api/payroll/${encodeURIComponent(month)}/payslips`;
  return apiGetBlob(workerId === undefined ? `${base}/pdf` : `${base}/${workerId}/pdf`);
}
