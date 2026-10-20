import { apiDelete, apiGet, apiPut } from "./client";
import type { Worker } from "./workers";

export type AttendanceStatus = "Present" | "Absent" | null;
export interface AttendanceRecord {
  status: Exclude<AttendanceStatus, null>;
  basicHours: number;
  overtimeHours: number;
}
export interface DailyPay {
  basicPay: number;
  overtimePay: number;
  totalPay: number;
  daysWorked: number;
}
export interface AttendanceRow {
  worker: Worker;
  record: AttendanceRecord | null;
  dailyPay: DailyPay;
}
export interface AttendanceDay {
  date: string;
  isFinalised: boolean;
  rows: AttendanceRow[];
}
export interface AttendanceInput {
  workerId: number;
  /** Explicit null removes the record as part of the atomic day save. */
  status: AttendanceStatus;
  basicHours: number;
  overtimeHours: number;
}
export function getAttendance(date: string): Promise<AttendanceDay> {
  return apiGet(`/api/attendance?date=${encodeURIComponent(date)}`);
}
export function saveAttendance(
  date: string,
  rows: AttendanceInput[],
): Promise<AttendanceDay> {
  return apiPut(`/api/attendance/${encodeURIComponent(date)}`, rows);
}
export function deleteAttendance(
  date: string,
  workerId: number,
): Promise<void> {
  return apiDelete(`/api/attendance/${encodeURIComponent(date)}/${workerId}`);
}
