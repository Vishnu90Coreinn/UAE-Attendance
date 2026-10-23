/** Paid leave: counted as a working day at the standard shift while the worker has allowance left. */
export const LEAVE_STATUSES = ["Annual Leave", "Sick Leave", "Emergency Leave"] as const;
export type LeaveStatusValue = (typeof LEAVE_STATUSES)[number];

export function isLeaveStatus(status: string | null | undefined): status is LeaveStatusValue {
  return status != null && (LEAVE_STATUSES as readonly string[]).includes(status);
}
