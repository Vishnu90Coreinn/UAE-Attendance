export interface NavItem {
  key: string;
  label: string;
}

/** The five prototype tabs, in prototype order. Each becomes a real route in its own slice. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "workers", label: "Worker Directory" },
  { key: "attendance", label: "Daily Attendance" },
  { key: "payroll", label: "Payroll Summary" },
  { key: "leave", label: "Leave Management" },
  { key: "users", label: "User Manager" },
];
