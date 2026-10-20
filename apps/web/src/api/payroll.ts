import { apiGet, apiGetBlob } from "./client";

export interface PayrollAmounts {
  daysWorked: number;
  basicHours: number;
  overtimeHours: number;
  basicPay: number;
  overtimePay: number;
  totalPay: number;
}
export interface PayrollLine extends PayrollAmounts {
  workerId: number;
  workerCode: string;
  workerName: string;
  designation: string;
  hourlyRate: number;
  overtimeRate: number;
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
}
export function getPayroll(month: string): Promise<PayrollReport> {
  return apiGet(`/api/payroll?month=${encodeURIComponent(month)}`);
}
export function getPayrollPdf(month: string, revision: string): Promise<Blob> {
  return apiGetBlob(
    `/api/payroll/pdf?month=${encodeURIComponent(month)}&revision=${encodeURIComponent(revision)}`,
  );
}
