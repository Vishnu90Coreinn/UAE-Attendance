import type { Role } from "../api/auth";
import { ADMIN_SCREEN_ROLES, SITE_PROGRESS_ROLES, VIEW_ALL_ROLES } from "../permissions";

export interface NavItem {
  key: string;
  label: string;
  /** Short name for the phone's bottom bar, where the full label does not fit. */
  shortLabel: string;
  /** Roles that see this tab. The server enforces access independently of this list. */
  roles: readonly Role[];
  /** Route of the screen. Tabs without one are disabled placeholders until their slice is built. */
  path?: string;
  /** Shown only to a login that is linked to an office employee record. */
  needsEmployee?: boolean;
}

const ALL_ROLES: readonly Role[] = ["Administrator", "Manager", "Supervisor", "HR", "Viewer"];
/** Everyone who can be linked to an office employee record, including the Employee role itself. */
const STAFF_ROLES: readonly Role[] = [...ALL_ROLES, "Employee"];

/** The five prototype tabs in prototype order, then Settings. Each becomes a real route in its own slice. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "my-attendance", label: "My Attendance", shortLabel: "Sign in", roles: STAFF_ROLES, path: "/my-attendance", needsEmployee: true },
  { key: "my-leave", label: "My Leave", shortLabel: "My Leave", roles: STAFF_ROLES, path: "/my-leave", needsEmployee: true },
  { key: "my-letters", label: "My Letters", shortLabel: "Letters", roles: STAFF_ROLES, path: "/my-letters", needsEmployee: true },
  { key: "my-profile", label: "My Profile", shortLabel: "Profile", roles: STAFF_ROLES, path: "/my-profile", needsEmployee: true },
  { key: "dashboard", label: "Dashboard", shortLabel: "Home", roles: VIEW_ALL_ROLES, path: "/dashboard" },
  { key: "workers", label: "Worker Directory", shortLabel: "Workers", roles: ALL_ROLES, path: "/workers" },
  { key: "attendance", label: "Daily Attendance", shortLabel: "Attendance", roles: ALL_ROLES, path: "/attendance" },
  { key: "staff", label: "Staff Attendance", shortLabel: "Staff", roles: VIEW_ALL_ROLES, path: "/staff" },
  { key: "staff-leave", label: "Staff Leave", shortLabel: "Staff Leave", roles: VIEW_ALL_ROLES, path: "/staff-leave" },
  { key: "payroll", label: "Payroll Summary", shortLabel: "Payroll", roles: VIEW_ALL_ROLES, path: "/payroll" },
  { key: "staff-payroll", label: "Staff Payroll Summary", shortLabel: "Staff Pay", roles: VIEW_ALL_ROLES, path: "/staff-payroll" },
  { key: "deductions", label: "Deductions", shortLabel: "Deductions", roles: VIEW_ALL_ROLES, path: "/deductions" },
  { key: "leave", label: "Leave Management", shortLabel: "Leave", roles: ALL_ROLES, path: "/leave" },
  { key: "invoices", label: "Tax Invoices", shortLabel: "Invoices", roles: VIEW_ALL_ROLES, path: "/invoices" },
  { key: "letters", label: "HR Letters", shortLabel: "Letters", roles: ALL_ROLES, path: "/letters" },
  { key: "progress", label: "Site Progress", shortLabel: "Progress", roles: SITE_PROGRESS_ROLES, path: "/progress" },
  { key: "users", label: "User Manager", shortLabel: "Users", roles: ADMIN_SCREEN_ROLES, path: "/users" },
  { key: "settings", label: "Settings", shortLabel: "Settings", roles: ADMIN_SCREEN_ROLES, path: "/settings" },
];

export function navItemsForRole(role: Role, employeeId?: number | null): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role) && (!item.needsEmployee || employeeId != null));
}

/** Most to least used on a phone: the first screens get bottom-bar slots, the rest go behind "More". */
const PHONE_ORDER = ["my-attendance", "my-leave", "my-letters", "my-profile", "dashboard", "attendance", "workers", "payroll", "leave", "deductions", "staff", "staff-payroll", "staff-leave", "progress", "invoices", "letters", "users", "settings"];
/** A bottom bar holds five slots at most; when "More" is needed it takes the last one. */
const PHONE_SLOTS = 5;

export function phoneNavFor(role: Role, employeeId?: number | null): { tabs: NavItem[]; more: NavItem[] } {
  const rank = (item: NavItem) => {
    const index = PHONE_ORDER.indexOf(item.key);
    return index === -1 ? PHONE_ORDER.length : index;
  };
  const items = navItemsForRole(role, employeeId)
    .filter((item) => item.path)
    .sort((a, b) => rank(a) - rank(b));
  if (items.length <= PHONE_SLOTS) return { tabs: items, more: [] };
  return { tabs: items.slice(0, PHONE_SLOTS - 1), more: items.slice(PHONE_SLOTS - 1) };
}
