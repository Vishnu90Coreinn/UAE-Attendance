import type { Role } from "./api/auth";

/** Manager and Administrator: the roles that manage workers, decide leave, run payroll and manage users. */
export function isManagement(role: Role | undefined): boolean {
  return role === "Administrator" || role === "Manager";
}

export const MANAGEMENT_ROLES: readonly Role[] = ["Administrator", "Manager"];
