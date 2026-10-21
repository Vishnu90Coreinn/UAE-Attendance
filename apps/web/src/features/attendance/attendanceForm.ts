import type {
  AttendanceInput,
  AttendanceRow,
  AttendanceStatus,
} from "../../api/attendance";

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
