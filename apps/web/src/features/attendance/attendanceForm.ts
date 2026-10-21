import type {
  AttendanceInput,
  AttendanceRow,
  AttendanceStatus,
} from "../../api/attendance";
import { dailyPay } from "../../utils/dailyPay";

export interface AttendanceForm {
  workerId: number;
  status: AttendanceStatus;
  basicHours: string;
  overtimeHours: string;
}
export function formFromRow(row: AttendanceRow): AttendanceForm {
  return {
    workerId: row.worker.id,
    status: row.record?.status ?? null,
    basicHours: String(row.record?.basicHours ?? 0),
    overtimeHours: String(row.record?.overtimeHours ?? 0),
  };
}
export function formInput(form: AttendanceForm): AttendanceInput {
  return {
    workerId: form.workerId,
    status: form.status,
    basicHours: form.status === "Present" ? Number(form.basicHours) : 0,
    overtimeHours: form.status === "Present" ? Number(form.overtimeHours) : 0,
  };
}
export function changed(
  form: AttendanceForm,
  original: AttendanceRow,
): boolean {
  const baseline = formFromRow(original);
  return (
    form.status !== baseline.status ||
    form.basicHours !== baseline.basicHours ||
    form.overtimeHours !== baseline.overtimeHours
  );
}
export function validateHours(
  form: AttendanceForm,
  maximum: number,
): string | null {
  if (form.status !== "Present") return null;
  const basic = Number(form.basicHours);
  const overtime = Number(form.overtimeHours);
  if (
    !form.basicHours.trim() ||
    !Number.isFinite(basic) ||
    basic <= 0 ||
    basic > maximum
  )
    return `Basic hours must be greater than 0 and at most ${maximum}.`;
  if (!form.overtimeHours.trim() || !Number.isFinite(overtime) || overtime < 0)
    return "Overtime hours must be 0 or greater.";
  if (
    !/^\d+(\.\d{1,2})?$/.test(form.basicHours) ||
    !/^\d+(\.\d{1,2})?$/.test(form.overtimeHours)
  )
    return "Hours can have at most 2 decimal places.";
  if (basic + overtime > 24)
    return "Basic and overtime hours together must not exceed 24.";
  return null;
}

/** Moves an hours field up or down by one step, staying between 0 and the maximum, with at most two decimals. */
export function stepHours(value: string, delta: number, maximum: number): string {
  const current = Number(value);
  const start = value.trim() && Number.isFinite(current) ? current : 0;
  return String(Math.min(maximum, Math.max(0, Math.round((start + delta) * 100) / 100)));
}

/** The live pay preview for a row being edited; null means "show a dash". Never run for roles without wage access. */
export function previewPay(
  row: AttendanceRow,
  form: AttendanceForm,
  maximum: number,
  companyRate: number | null,
): number | null {
  if (!changed(form, row)) return row.dailyPay?.totalPay ?? null;
  if (validateHours(form, maximum)) return null;
  const hourlyRate = row.worker.hourlyRate;
  const overtimeRate = row.worker.overtimeRate ?? companyRate;
  if (hourlyRate === null || overtimeRate === null) return null;
  return dailyPay(
    form.status,
    Number(form.basicHours),
    Number(form.overtimeHours),
    hourlyRate,
    overtimeRate,
    null,
  ).totalPay;
}
