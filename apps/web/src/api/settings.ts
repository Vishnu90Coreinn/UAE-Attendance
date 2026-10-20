import { apiGet, apiPut } from "./client";

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

/** Administrator only. Resolves with the saved settings; rejects with the ApiError (400 carries fieldErrors). */
export function updatePayrollSettings(body: PayrollSettings): Promise<PayrollSettings> {
  return apiPut<PayrollSettings>("/api/settings/payroll", body);
}
