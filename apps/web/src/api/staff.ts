import { apiDelete, apiGet, apiGetBlob, apiGetFile, apiPost, apiPut } from "./client";
import { EXCEL_TYPE } from "./attendance";

export type StaffStatus =
  | "Present"
  | "Late"
  | "Early Leave"
  | "Absent"
  | "Weekly Off"
  | "Public Holiday"
  | "Missing Sign-out"
  | "On Leave"
  | "Not In Yet";

/** One worked-out day for an office employee. Late, early leave, missing sign-out and outside office are flags. */
export interface StaffDay {
  date: string;
  status: StaffStatus;
  hours: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  firstIn: string | null;
  lastOut: string | null;
  isLate: boolean;
  isEarlyLeave: boolean;
  missingSignOut: boolean;
  outsideOffice: boolean;
  punchCount: number;
  note: string | null;
  /** Signed in and not yet signed out (today only). */
  inNow?: boolean;
}

export interface Punch {
  id: number;
  kind: "In" | "Out";
  date: string;
  time: string;
  outsideOffice: boolean;
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number | null;
  source: "Self" | "Manual";
  reason: string | null;
  hasSelfie: boolean;
  isVoided: boolean;
  voidReason: string | null;
  createdBy: string;
}

export interface StaffMe {
  workerId: number;
  code: string;
  name: string;
  department: string | null;
  shiftStart: string;
  shiftEnd: string;
  officeCheckOn: boolean;
  today: StaffDay;
  nextKind: "In" | "Out";
  punches: Punch[];
}

export interface PunchInput {
  selfieBase64: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
}

export interface StaffDayRow {
  workerId: number;
  code: string;
  name: string;
  department: string | null;
  day: StaffDay;
}

export interface StaffDayDetail {
  row: StaffDayRow;
  punches: Punch[];
}

export interface StaffDashboard {
  date: string;
  dayType: string | null;
  total: number;
  signedIn: number;
  late: number;
  absent: number;
  outsideOffice: number;
  missingSignOut: number;
  onLeave: number;
  notInYet: number;
  attention: StaffDayRow[];
}

export interface StaffReportRow {
  workerId: number;
  code: string;
  name: string;
  department: string | null;
  presentDays: number;
  lateDays: number;
  lateMinutes: number;
  earlyLeaveDays: number;
  earlyLeaveMinutes: number;
  absentDays: number;
  leaveDays: number;
  weeklyOffDays: number;
  holidayDays: number;
  missingSignOutDays: number;
  outsideOfficeDays: number;
  totalHours: number;
}

export interface StaffReport {
  from: string;
  to: string;
  rows: StaffReportRow[];
  days: StaffDayRow[];
}

export interface StaffSettings {
  shiftStart: string;
  shiftEnd: string;
  lateGraceMinutes: number;
  earlyGraceMinutes: number;
  /** 0 = Sunday ... 6 = Saturday. */
  weeklyOff: number;
  officeLatitude: number | null;
  officeLongitude: number | null;
  officeRadiusMeters: number | null;
  /** Off by default. When on, each absent day costs salary / 30 in the employee payroll summary. */
  deductAbsentDays?: boolean;
  /** AED per minute of late arrival; 0 means none. */
  lateDeductionPerMinute?: number;
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
}

export interface LinkableUser {
  id: number;
  username: string;
  role: string;
}

export interface StaffLeaveType {
  id: number;
  name: string;
  yearlyDays: number;
  isActive: boolean;
  /** True when a request of this type cannot be sent without a document (sick leave). */
  requiresDocument: boolean;
}

export type StaffLeaveStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";

export interface StaffLeave {
  id: number;
  workerId: number;
  code: string;
  name: string;
  department: string | null;
  leaveTypeId: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: StaffLeaveStatus;
  createdBy: string;
  createdUtc: string;
  decidedBy: string | null;
  decidedUtc: string | null;
  decisionNote: string | null;
  hasAttachment: boolean;
}

export interface StaffLeaveBalance {
  leaveTypeId: number;
  leaveType: string;
  entitlement: number;
  used: number;
  pending: number;
  remaining: number;
}

export interface StaffLeaveBalanceRow {
  workerId: number;
  code: string;
  name: string;
  department: string | null;
  balances: StaffLeaveBalance[];
}

export interface StaffMyLeave {
  balances: StaffLeaveBalance[];
  requests: StaffLeave[];
  types: StaffLeaveType[];
}

export interface LeaveRequestInput {
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  reason: string;
  /** A JPEG document (a medical certificate, for example), base64 encoded. */
  attachmentBase64?: string;
}

// --- the signed-in employee ---------------------------------------------------------------------------------------

export const getMyStaff = (signal?: AbortSignal) => apiGet<StaffMe>("/api/staff/me", signal);
export const punch = (input: PunchInput) => apiPost<StaffMe>("/api/staff/me/punch", input);
export const getMyDays = (from: string, to: string) => apiGet<StaffDay[]>(`/api/staff/me/days?from=${from}&to=${to}`);
export const getMyDay = (date: string) => apiGet<StaffDayDetail>(`/api/staff/me/day?date=${date}`);
export const getMyLeave = () => apiGet<StaffMyLeave>("/api/staff/me/leave");
export const requestLeave = (input: LeaveRequestInput) => apiPost<StaffLeave>("/api/staff/me/leave", input);
export const cancelMyLeave = (id: number) => apiPost<StaffLeave>(`/api/staff/me/leave/${id}/cancel`, undefined);

/** A sign-in selfie as a JPEG blob. */
export const getSelfie = (punchId: number) => apiGetFile(`/api/staff/punches/${punchId}/selfie`, "image/jpeg");

// --- review (HR, Manager, Partner) --------------------------------------------------------------------------------

export const getStaffDashboard = () => apiGet<StaffDashboard>("/api/staff/dashboard");

export function getStaffDay(date: string, department?: string) {
  const query = new URLSearchParams({ date });
  if (department) query.set("department", department);
  return apiGet<StaffDayRow[]>(`/api/staff/attendance?${query}`);
}

export const getStaffDetail = (workerId: number, date: string) => apiGet<StaffDayDetail>(`/api/staff/attendance/${workerId}?date=${date}`);

export interface ManualPunchInput {
  workerId: number;
  date: string;
  time: string;
  kind: "In" | "Out";
  reason: string;
}

export const addManualPunch = (input: ManualPunchInput) => apiPost<StaffDayDetail>("/api/staff/punches", input);
export const voidPunch = (id: number, reason: string) => apiPost<StaffDayDetail>(`/api/staff/punches/${id}/void`, { reason });

export function reportQuery(from: string, to: string, department?: string, workerId?: number): string {
  const query = new URLSearchParams({ from, to });
  if (department) query.set("department", department);
  if (workerId) query.set("workerId", String(workerId));
  return query.toString();
}

export const getStaffReport = (from: string, to: string, department?: string, workerId?: number) =>
  apiGet<StaffReport>(`/api/staff/report?${reportQuery(from, to, department, workerId)}`);

export function getStaffReportFile(format: "pdf" | "excel", from: string, to: string, department?: string): Promise<Blob> {
  const path = `/api/staff/report/export/${format}?${reportQuery(from, to, department)}`;
  return format === "pdf" ? apiGetBlob(path) : apiGetFile(path, EXCEL_TYPE);
}

// --- settings and holidays -----------------------------------------------------------------------------------------

export const getStaffSettings = () => apiGet<StaffSettings>("/api/staff/settings");
export const saveStaffSettings = (settings: StaffSettings) => apiPut<StaffSettings>("/api/staff/settings", settings);
export const listHolidays = (year?: number) => apiGet<Holiday[]>(`/api/staff/holidays${year ? `?year=${year}` : ""}`);
export const addHoliday = (date: string, name: string) => apiPost<Holiday>("/api/staff/holidays", { date, name });
export const deleteHoliday = (id: number) => apiDelete(`/api/staff/holidays/${id}`);

// --- logins -------------------------------------------------------------------------------------------------------

export const listLinkableUsers = () => apiGet<LinkableUser[]>("/api/staff/linkable-users");
export const createEmployeeLogin = (workerId: number, username: string, password: string) =>
  apiPost<LinkableUser>(`/api/staff/employees/${workerId}/login`, { username, password });
export const linkEmployeeLogin = (workerId: number, linkUserId: number) =>
  apiPost<LinkableUser>(`/api/staff/employees/${workerId}/login`, { linkUserId });
export const removeEmployeeLogin = (workerId: number) => apiDelete(`/api/staff/employees/${workerId}/login`);

// --- leave (HR, Manager, Partner) ----------------------------------------------------------------------------------

export const listLeaveTypes = () => apiGet<StaffLeaveType[]>("/api/staff/leave-types");
export const addLeaveType = (name: string, yearlyDays: number, requiresDocument = false) =>
  apiPost<StaffLeaveType>("/api/staff/leave-types", { name, yearlyDays, requiresDocument });
export const updateLeaveType = (id: number, name: string, yearlyDays: number, isActive: boolean, requiresDocument?: boolean) =>
  apiPut<StaffLeaveType>(`/api/staff/leave-types/${id}`, { name, yearlyDays, isActive, requiresDocument });

export function listStaffLeave(filters: { status?: string; department?: string; year?: number }) {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.department) query.set("department", filters.department);
  if (filters.year) query.set("year", String(filters.year));
  return apiGet<StaffLeave[]>(`/api/staff/leave${query.size ? `?${query}` : ""}`);
}

export const getLeaveBalances = (year: number, department?: string) =>
  apiGet<StaffLeaveBalanceRow[]>(`/api/staff/leave/balances?year=${year}${department ? `&department=${encodeURIComponent(department)}` : ""}`);

export const approveStaffLeave = (id: number, note: string) => apiPost<StaffLeave>(`/api/staff/leave/${id}/approve`, { note });
export const rejectStaffLeave = (id: number, note: string) => apiPost<StaffLeave>(`/api/staff/leave/${id}/reject`, { note });

export function getStaffLeaveFile(format: "pdf" | "excel", year: number, department?: string): Promise<Blob> {
  const query = new URLSearchParams({ year: String(year) });
  if (department) query.set("department", department);
  const path = `/api/staff/leave/export/${format}?${query}`;
  return format === "pdf" ? apiGetBlob(path) : apiGetFile(path, EXCEL_TYPE);
}

// --- employee payroll summary -------------------------------------------------------------------------------------

export interface StaffPayrollRow {
  workerId: number;
  code: string;
  name: string;
  department: string | null;
  monthlySalary: number;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  lateDays: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  totalHours: number;
  absentDeduction: number;
  lateDeduction: number;
  netSalary: number;
}

export interface StaffPayrollSummary {
  month: string;
  label: string;
  rows: StaffPayrollRow[];
  totalSalary: number;
  totalDeductions: number;
  totalNet: number;
  deductAbsentDays: boolean;
  lateDeductionPerMinute: number;
}

export const getStaffPayroll = (month: string) => apiGet<StaffPayrollSummary>(`/api/staff/payroll?month=${month}`);

export function getStaffPayrollFile(format: "pdf" | "excel", month: string): Promise<Blob> {
  const path = `/api/staff/payroll/export/${format}?month=${month}`;
  return format === "pdf" ? apiGetBlob(path) : apiGetFile(path, EXCEL_TYPE);
}

export interface StaffProfile {
  workerId: number;
  code: string;
  fullName: string;
  designation: string;
  department: string | null;
  joinDate: string | null;
  nationality: string | null;
  emiratesId: string | null;
  passportNumber: string | null;
  phone: string | null;
  email: string | null;
  emergencyContact: string | null;
  workLocation: string | null;
  username: string;
  role: string;
  hasPhoto: boolean;
}

export const getMyProfile = () => apiGet<StaffProfile>("/api/staff/me/profile");

/** The document attached to a leave request, as a JPEG blob. Employees open their own; HR and managers open any. */
export const getLeaveDocument = (id: number, own: boolean) =>
  apiGetFile(own ? `/api/staff/me/leave/${id}/attachment` : `/api/staff/leave/${id}/attachment`, "image/jpeg");

/** One employee's payslip for a month (Managers and Administrators). Without a worker, every employee in one PDF. */
export function getStaffPayslip(month: string, workerId?: number): Promise<Blob> {
  return apiGetBlob(`/api/staff/payroll/payslip?month=${month}${workerId ? `&workerId=${workerId}` : ""}`);
}

// --- HR letters -----------------------------------------------------------------------------------------------------

export const getMyLetters = () => apiGet<import("./certificateRequests").CertificateRequest[]>("/api/staff/me/letters");
export const requestMyLetter = (letterType: string, reason: string) =>
  apiPost<import("./certificateRequests").CertificateRequest>("/api/staff/me/letters", { letterType, reason });
export const getMyLetterPdf = (id: number) => apiGetBlob(`/api/staff/me/letters/${id}/pdf`);
