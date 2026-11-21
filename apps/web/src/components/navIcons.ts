import {
  Banknote,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Camera,
  ClipboardCheck,
  FileSignature,
  FileText,
  HardHat,
  LayoutDashboard,
  ReceiptText,
  Settings,
  UserCog,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** One icon per screen, shared by the desktop sidebar and the phone tab bar. */
export const NAV_ICONS: Record<string, LucideIcon> = {
  "my-attendance": Camera,
  "my-leave": CalendarPlus,
  staff: Building2,
  "staff-leave": CalendarCheck,
  "staff-payroll": Wallet,
  dashboard: LayoutDashboard,
  attendance: ClipboardCheck,
  workers: UsersRound,
  payroll: Banknote,
  leave: CalendarDays,
  deductions: ReceiptText,
  invoices: FileText,
  letters: FileSignature,
  progress: HardHat,
  users: UserCog,
  settings: Settings,
};

/** Sidebar sections. Order within and across groups matches NAV_ITEMS, so the tab order never changes. */
export const NAV_GROUPS: ReadonlyArray<{ label: string; keys: readonly string[] }> = [
  { label: "My work", keys: ["my-attendance", "my-leave"] },
  { label: "Overview", keys: ["dashboard"] },
  { label: "Workforce", keys: ["workers", "attendance"] },
  { label: "Office staff", keys: ["staff", "staff-leave"] },
  { label: "Pay & leave", keys: ["payroll", "staff-payroll", "deductions", "leave"] },
  { label: "Documents", keys: ["invoices", "letters"] },
  { label: "Site", keys: ["progress"] },
  { label: "Administration", keys: ["users", "settings"] },
];
