import {
  Banknote,
  CalendarDays,
  ClipboardCheck,
  LayoutDashboard,
  ReceiptText,
  Settings,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

/** One icon per screen, shared by the desktop sidebar and the phone tab bar. */
export const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  attendance: ClipboardCheck,
  workers: UsersRound,
  payroll: Banknote,
  leave: CalendarDays,
  deductions: ReceiptText,
  users: UserCog,
  settings: Settings,
};

/** Sidebar sections. Order within and across groups matches NAV_ITEMS, so the tab order never changes. */
export const NAV_GROUPS: ReadonlyArray<{ label: string; keys: readonly string[] }> = [
  { label: "Overview", keys: ["dashboard"] },
  { label: "Workforce", keys: ["workers", "attendance"] },
  { label: "Pay & leave", keys: ["payroll", "deductions", "leave"] },
  { label: "Administration", keys: ["users", "settings"] },
];
