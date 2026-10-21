import type { Role } from "../api/auth";
import { MANAGEMENT_ROLES } from "../permissions";

export interface NavItem {
  key: string;
  label: string;
  /** Short name for the phone's bottom bar, where the full label does not fit. */
  shortLabel: string;
  /** Roles that see this tab. The server enforces access independently of this list. */
  roles: readonly Role[];
  /** Route of the screen. Tabs without one are disabled placeholders until their slice is built. */
  path?: string;
}

const ALL_ROLES: readonly Role[] = ["Administrator", "Manager", "Supervisor"];

/** The five prototype tabs in prototype order, then Settings. Each becomes a real route in its own slice. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "workers", label: "Worker Directory", shortLabel: "Workers", roles: ALL_ROLES, path: "/workers" },
  { key: "attendance", label: "Daily Attendance", shortLabel: "Attendance", roles: ALL_ROLES, path: "/attendance" },
  { key: "payroll", label: "Payroll Summary", shortLabel: "Payroll", roles: MANAGEMENT_ROLES, path: "/payroll" },
  { key: "deductions", label: "Deductions", shortLabel: "Deductions", roles: MANAGEMENT_ROLES, path: "/deductions" },
  { key: "leave", label: "Leave Management", shortLabel: "Leave", roles: ALL_ROLES, path: "/leave" },
  { key: "users", label: "User Manager", shortLabel: "Users", roles: MANAGEMENT_ROLES, path: "/users" },
  { key: "settings", label: "Settings", shortLabel: "Settings", roles: MANAGEMENT_ROLES, path: "/settings" },
];

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** Most to least used on a phone: the first screens get bottom-bar slots, the rest go behind "More". */
const PHONE_ORDER = ["attendance", "workers", "payroll", "leave", "deductions", "users", "settings"];
/** A bottom bar holds five slots at most; when "More" is needed it takes the last one. */
const PHONE_SLOTS = 5;

export function phoneNavFor(role: Role): { tabs: NavItem[]; more: NavItem[] } {
  const rank = (item: NavItem) => {
    const index = PHONE_ORDER.indexOf(item.key);
    return index === -1 ? PHONE_ORDER.length : index;
  };
  const items = navItemsForRole(role)
    .filter((item) => item.path)
    .sort((a, b) => rank(a) - rank(b));
  if (items.length <= PHONE_SLOTS) return { tabs: items, more: [] };
  return { tabs: items.slice(0, PHONE_SLOTS - 1), more: items.slice(PHONE_SLOTS - 1) };
}
