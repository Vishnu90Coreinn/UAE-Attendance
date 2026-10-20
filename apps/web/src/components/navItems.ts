import type { Role } from "../api/auth";

export interface NavItem {
  key: string;
  label: string;
  /** Roles that see this tab. The server enforces access independently of this list. */
  roles: readonly Role[];
}

const ALL_ROLES: readonly Role[] = ["Administrator", "HR Staff", "Viewer"];

/** The five prototype tabs, in prototype order. Each becomes a real route in its own slice. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "workers", label: "Worker Directory", roles: ALL_ROLES },
  { key: "attendance", label: "Daily Attendance", roles: ALL_ROLES },
  { key: "payroll", label: "Payroll Summary", roles: ALL_ROLES },
  { key: "leave", label: "Leave Management", roles: ALL_ROLES },
  { key: "users", label: "User Manager", roles: ["Administrator"] },
];

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
