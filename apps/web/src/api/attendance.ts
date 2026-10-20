import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import type { Worker } from "./workers";

export type AttendanceStatus = "Present" | "Absent" | null;
/** Where an entry is in the supervisor-to-manager approval flow. Only Approved entries reach payroll. */
export type ApprovalStatus = "Submitted" | "Approved" | "Rejected";
export interface AttendanceRecord {
  status: Exclude<AttendanceStatus, null>;
  basicHours: number;
  overtimeHours: number;
  approvalStatus: ApprovalStatus;
  /** Why a manager sent the entry back; null unless it is Rejected. */
  rejectionReason: string | null;
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
  /** Null for Supervisors, who never see pay. */
  dailyPay: DailyPay | null;
}
export interface AttendanceDay {
  date: string;
  isFinalised: boolean;
  rows: AttendanceRow[];
  /** Entries on this date waiting for a manager. */
  pendingCount: number;
}
export interface AttendanceInput {
  workerId: number;
  /** Explicit null removes the record as part of the atomic day save. */
  status: AttendanceStatus;
  basicHours: number;
  overtimeHours: number;
}
export interface AttendanceDayCount {
  date: string;
  count: number;
}
export interface AttendanceSummary {
  submittedTotal: number;
  submitted: AttendanceDayCount[];
  rejectedTotal: number;
  rejected: AttendanceDayCount[];
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
/** Manager/Administrator: approve the given workers' submitted entries, or every submitted entry when omitted. */
export function approveAttendance(
  date: string,
  workerIds?: number[],
): Promise<AttendanceDay> {
  return apiPost(`/api/attendance/${encodeURIComponent(date)}/approve`, {
    workerIds: workerIds ?? null,
  });
}
/** Manager/Administrator: send submitted entries back to the supervisor with a reason. */
export function rejectAttendance(
  date: string,
  workerIds: number[],
  reason: string,
): Promise<AttendanceDay> {
  return apiPost(`/api/attendance/${encodeURIComponent(date)}/reject`, {
    workerIds,
    reason,
  });
}
export function getAttendanceSummary(): Promise<AttendanceSummary> {
  return apiGet("/api/attendance/summary");
}
