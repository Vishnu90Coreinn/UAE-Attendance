import { apiGet, apiPost } from "./client";

export type Role = "Administrator" | "Manager" | "Supervisor";

export interface CurrentUser {
  id: number;
  username: string;
  role: Role;
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

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return apiPost<void>("/api/auth/change-password", { currentPassword, newPassword });
}
