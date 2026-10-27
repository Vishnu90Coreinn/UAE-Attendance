import { apiDelete, apiGet, apiGetBlob, apiGetFile, apiPost } from "./client";
import { EXCEL_TYPE } from "./attendance";

export const LEAVE_TYPES = [
  "Annual Leave",
  "Sick Leave",
  "Unpaid Leave",
  "Emergency Leave",
] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export type LeaveStatus = "Pending" | "Approved" | "Rejected";
export interface LeaveInput {
  workerId: number;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  /** Optional JPEG photo of the leave request or doctor's note, base64 encoded. */
  attachmentBase64?: string;
}
export interface LeaveRequest extends Omit<LeaveInput, "attachmentBase64"> {
  id: number;
  hasAttachment: boolean;
  workerCode: string;
  workerName: string;
  workerIsActive: boolean;
  days: number;
  status: LeaveStatus;
  createdBy: string;
  createdUtc: string;
  decidedBy: string | null;
  decidedUtc: string | null;
}
export interface LeaveFilters {
  status?: LeaveStatus;
  workerId?: number;
}
export function listLeave(filters: LeaveFilters): Promise<LeaveRequest[]> {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.workerId) query.set("workerId", String(filters.workerId));
  return apiGet(`/api/leave${query.size ? `?${query}` : ""}`);
}
export function createLeave(input: LeaveInput): Promise<LeaveRequest> {
  return apiPost("/api/leave", input);
}
/** Leave requests that touch a month (yyyy-MM), for every worker or one, as a PDF or Excel file. */
export function getLeaveExport(month: string, workerId: number | undefined, format: "pdf" | "excel"): Promise<Blob> {
  const query = new URLSearchParams({ month });
  if (workerId) query.set("workerId", String(workerId));
  const path = `/api/leave/export/${format}?${query}`;
  return format === "pdf" ? apiGetBlob(path) : apiGetFile(path, EXCEL_TYPE);
}
/** The photo attached to a leave request, as a JPEG blob. */
export function getLeaveAttachment(id: number): Promise<Blob> {
  return apiGetFile(`/api/leave/${id}/attachment`, "image/jpeg");
}
export function approveLeave(id: number): Promise<LeaveRequest> {
  return apiPost(`/api/leave/${id}/approve`, undefined);
}
export function rejectLeave(id: number): Promise<LeaveRequest> {
  return apiPost(`/api/leave/${id}/reject`, undefined);
}
export function deleteLeave(id: number): Promise<void> {
  return apiDelete(`/api/leave/${id}`);
}

/** One paid-leave type for a worker in their current allowance year. Used counts paid days only. */
export interface LeaveTypeBalance {
  leaveType: "Annual Leave" | "Sick Leave" | "Emergency Leave";
  allowance: number;
  used: number;
  remaining: number;
  /** False when the worker cannot take this leave yet (annual leave before 10 months, or no join date). */
  available: boolean;
  eligibleFrom: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}
export interface WorkerLeaveBalance {
  workerId: number;
  workerCode: string;
  workerName: string;
  joinDate: string | null;
  balances: LeaveTypeBalance[];
}
export function getLeaveBalances(): Promise<WorkerLeaveBalance[]> {
  return apiGet("/api/leave/balances");
}
