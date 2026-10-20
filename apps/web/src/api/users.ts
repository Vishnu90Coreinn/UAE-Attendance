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

export const USER_ROLES: readonly Role[] = ["Administrator", "HR Staff", "Viewer"];

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
