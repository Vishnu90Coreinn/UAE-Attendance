import type { Role } from "./api/auth";

/** Manager and Administrator: the roles that manage workers, decide leave, run payroll and manage users. */
export function isManagement(role: Role | undefined): boolean {
  return role === "Administrator" || role === "Manager";
}

export const MANAGEMENT_ROLES: readonly Role[] = ["Administrator", "Manager"];

/** Management plus HR: everyone who may see pay and the management screens. HR sees them read-only. */
export function canViewAll(role: Role | undefined): boolean {
  return isManagement(role) || role === "HR";
}

export const VIEW_ALL_ROLES: readonly Role[] = ["Administrator", "Manager", "HR"];
