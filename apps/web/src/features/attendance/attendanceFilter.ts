import { isLeaveStatus } from "../../utils/leaveStatuses";

/** Which workers the phone list shows: everyone, or only those in one state. */
export type AttendanceFilter = "all" | "unrecorded" | "present" | "absent" | "leave";

/** The filter group a status belongs to; a worker with no status yet is "unrecorded". */
export function filterGroup(status: string | null): Exclude<AttendanceFilter, "all"> {
  if (status === null) return "unrecorded";
  if (status === "Present") return "present";
  if (status === "Absent") return "absent";
  return isLeaveStatus(status) ? "leave" : "unrecorded";
}
