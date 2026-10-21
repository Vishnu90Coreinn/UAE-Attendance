import type { Role } from "../api/auth";
import { MANAGEMENT_ROLES } from "../permissions";

export interface NavItem {
  key: string;
  label: string;
  /** Roles that see this tab. The server enforces access independently of this list. */
  roles: readonly Role[];
  /** Route of the screen. Tabs without one are disabled placeholders until their slice is built. */
  path?: string;
}

const ALL_ROLES: readonly Role[] = ["Administrator", "Manager", "Supervisor"];

/** The five prototype tabs in prototype order, then Settings. Each becomes a real route in its own slice. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "workers", label: "Worker Directory", roles: ALL_ROLES, path: "/workers" },
  { key: "attendance", label: "Daily Attendance", roles: ALL_ROLES, path: "/attendance" },
  { key: "payroll", label: "Payroll Summary", roles: MANAGEMENT_ROLES, path: "/payroll" },
  { key: "leave", label: "Leave Management", roles: ALL_ROLES, path: "/leave" },
  { key: "users", label: "User Manager", roles: MANAGEMENT_ROLES, path: "/users" },
  { key: "settings", label: "Settings", roles: MANAGEMENT_ROLES, path: "/settings" },
];

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
