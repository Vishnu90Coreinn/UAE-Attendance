import { apiDelete, apiGet, apiPost } from "./client";

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
}
export interface LeaveRequest extends LeaveInput {
  id: number;
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
export function approveLeave(id: number): Promise<LeaveRequest> {
  return apiPost(`/api/leave/${id}/approve`, undefined);
}
export function rejectLeave(id: number): Promise<LeaveRequest> {
  return apiPost(`/api/leave/${id}/reject`, undefined);
}
export function deleteLeave(id: number): Promise<void> {
  return apiDelete(`/api/leave/${id}`);
}
