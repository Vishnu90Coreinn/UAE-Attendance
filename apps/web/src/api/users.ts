import type { Role } from "./auth";
import { apiDelete, apiGet, apiPost, apiPut } from "./client";

export interface ManagedUser {
  id: number;
  username: string;
  role: Role;
  isActive: boolean;
  createdUtc: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: Role;
}

export interface UpdateUserInput {
  role: Role;
  active: boolean;
}

/** Roles an Administrator may assign. */
export const ADMIN_ASSIGNABLE_ROLES: readonly Role[] = ["Administrator", "Manager", "HR", "Supervisor", "Viewer"];
/** Roles a Manager may assign: HR, Supervisors and Partners (the read-only "Viewer" role). */
export const MANAGER_ASSIGNABLE_ROLES: readonly Role[] = ["HR", "Supervisor", "Viewer"];

export function assignableRoles(role: Role | undefined): readonly Role[] {
  if (role === "Viewer") return [];
  return role === "Administrator" ? ADMIN_ASSIGNABLE_ROLES : MANAGER_ASSIGNABLE_ROLES;
}

export function listUsers(): Promise<ManagedUser[]> {
  return apiGet<ManagedUser[]>("/api/users");
}

export function createUser(input: CreateUserInput): Promise<ManagedUser> {
  return apiPost<ManagedUser>("/api/users", input);
}

export function updateUser(id: number, input: UpdateUserInput): Promise<ManagedUser> {
  return apiPut<ManagedUser>(`/api/users/${id}`, input);
}

export function resetUserPassword(id: number, password: string): Promise<void> {
  return apiPost(`/api/users/${id}/reset-password`, { password });
}

export function deleteUser(id: number): Promise<void> {
  return apiDelete(`/api/users/${id}`);
}
