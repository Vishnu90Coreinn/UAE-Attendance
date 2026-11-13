import type { Role } from "./api/auth";

/** Manager and Administrator: the roles that manage workers, decide leave, run payroll and manage users. */
export function isManagement(role: Role | undefined): boolean {
  return role === "Administrator" || role === "Manager";
}

export const MANAGEMENT_ROLES: readonly Role[] = ["Administrator", "Manager"];

/** The Viewer sees every screen, pay included, and can change nothing. The server refuses all of a Viewer's writes. */
export function isReadOnly(role: Role | undefined): boolean {
  return role === "Viewer";
}

/** Management, HR and the Viewer: everyone who may see pay and the management screens. */
export function canViewAll(role: Role | undefined): boolean {
  return isManagement(role) || role === "HR" || role === "Viewer";
}

export const VIEW_ALL_ROLES: readonly Role[] = ["Administrator", "Manager", "HR", "Viewer"];

/** Who opens User Manager and Settings: only the two who manage them. A Partner and HR have neither. */
export const ADMIN_SCREEN_ROLES: readonly Role[] = ["Administrator", "Manager"];

/** Site Progress is not part of an HR account's access. */
export const SITE_PROGRESS_ROLES: readonly Role[] = ["Administrator", "Manager", "Supervisor", "Viewer"];

/** The name people see for a role. The read-only "Viewer" account is called Partner on screen; the stored role is unchanged. */
export function roleLabel(role: string | undefined): string {
  return role === "Viewer" ? "Partner" : (role ?? "");
}
