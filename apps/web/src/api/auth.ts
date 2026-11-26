import { apiGet, apiPost, renewingToken } from "./client";

export type Role = "Administrator" | "Manager" | "Supervisor" | "HR" | "Viewer" | "Employee";

export interface CurrentUser {
  id: number;
  username: string;
  role: Role;
  /** The office employee record linked to this login; decides whether My Attendance and My Leave show. */
  employeeId?: number | null;
  /** Office staff a Manager has allowed to submit expenses for approval; decides whether My Expenses shows. */
  canSubmitExpenses?: boolean;
}

export interface LoginResponse {
  token: string;
  expiresUtc: string;
  user: CurrentUser;
}

/** A 401 here means wrong credentials, not an expired session, so it must not sign anyone out. */
export function login(username: string, password: string): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/api/auth/login", { username, password }, undefined, {
    skipUnauthorizedHandler: true,
  });
}

export function getMe(signal?: AbortSignal): Promise<CurrentUser> {
  return apiGet<CurrentUser>("/api/auth/me", signal);
}

/** Changing the password signs out everywhere else; this device carries on with the new token the server sends back. */
export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return renewingToken(() => apiPost<LoginResponse>("/api/auth/change-password", { currentPassword, newPassword }));
}
