import { apiGet } from "./client";

export interface PayrollSettings {
  companyName: string;
  tagline: string;
  contactEmail: string;
  overtimeRatePerHour: number;
  maxBasicHoursPerDay: number;
  shiftDescription: string;
  preparedByLabel: string;
  approvedByLabel: string;
}

export function getPayrollSettings(): Promise<PayrollSettings> {
  return apiGet<PayrollSettings>("/api/settings/payroll");
}
