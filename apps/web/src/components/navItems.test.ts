import { describe, expect, it } from "vitest";
import { navItemsForRole, phoneNavFor } from "./navItems";

const MODULES = [
  "Worker Directory",
  "Daily Attendance",
  "Staff Attendance",
  "Staff Leave",
  "Payroll Summary",
  "Staff Payroll Summary",
  "Deductions",
  "Leave Management",
  "Finance",
  "Accounts",
  "Expenses",
  "Income",
  "Partners",
  "Finance Reports",
  "Tax Invoices",
  "HR Letters",
  "Site Progress",
];

function labelsFor(role: Parameters<typeof navItemsForRole>[0]) {
  return navItemsForRole(role).map((item) => item.label);
}

describe("navItemsForRole", () => {
  it("gives an Administrator the Dashboard, the modules, User Manager and Settings, in order", () => {
    expect(labelsFor("Administrator")).toEqual([
      "Dashboard",
      ...MODULES,
      "User Manager",
      "Settings",
    ]);
  });

  it("gives a Manager the same tabs as an Administrator", () => {
    expect(labelsFor("Manager")).toEqual(["Dashboard", ...MODULES, "User Manager", "Settings"]);
  });

  it("gives a Viewer (Partner) every screen except User Manager and Settings", () => {
    expect(labelsFor("Viewer")).toEqual(["Dashboard", ...MODULES]);
  });

  it("gives HR every screen except User Manager and Settings", () => {
    expect(labelsFor("HR")).not.toContain("User Manager");
    expect(labelsFor("HR")).not.toContain("Settings");
    expect(labelsFor("HR")).not.toContain("Site Progress");
    expect(labelsFor("HR")).toEqual(expect.arrayContaining(["Dashboard", "Payroll Summary", "Deductions"]));
  });

  it("gives a Supervisor Worker Directory, Daily Attendance, Leave Management, HR Letters (to request certificates) and Site Progress", () => {
    expect(labelsFor("Supervisor")).toEqual([
      "Worker Directory",
      "Daily Attendance",
      "Leave Management",
      "HR Letters",
      "Site Progress",
    ]);
  });

  it("gives all implemented modules a route", () => {
    const paths = Object.fromEntries(
      navItemsForRole("Administrator").map((item) => [item.label, item.path]),
    );

    expect(paths).toEqual({
      Dashboard: "/dashboard",
      "Worker Directory": "/workers",
      "Daily Attendance": "/attendance",
      "Payroll Summary": "/payroll",
      "Deductions": "/deductions",
      "Leave Management": "/leave",
      Finance: "/finance",
      Accounts: "/finance/accounts",
      Expenses: "/finance/expenses",
      Income: "/finance/income",
      Partners: "/finance/partners",
      "Finance Reports": "/finance/reports",
      "Staff Attendance": "/staff",
      "Staff Payroll Summary": "/staff-payroll",
      "Staff Leave": "/staff-leave",
      "Tax Invoices": "/invoices",
      "HR Letters": "/letters",
      "Site Progress": "/progress",
      "User Manager": "/users",
      Settings: "/settings",
    });
  });
});

describe("My Attendance and My Leave", () => {
  it("show only for a login that is linked to an office employee record", () => {
    expect(labelsFor("HR")).not.toContain("My Attendance");
    expect(navItemsForRole("HR", 7).map((item) => item.label).slice(0, 4)).toEqual(["My Attendance", "My Leave", "My Letters", "My Profile"]);
  });

  it("are all an Employee-role login sees", () => {
    expect(navItemsForRole("Employee", 7).map((item) => item.label)).toEqual(["My Attendance", "My Leave", "My Letters", "My Profile"]);
    expect(navItemsForRole("Employee")).toEqual([]);
  });
});

describe("phoneNavFor", () => {
  const labels = (items: { label: string }[]) => items.map((item) => item.label);

  it("puts the dashboard first and moves the rarely used screens behind More for a Manager", () => {
    const { tabs, more } = phoneNavFor("Manager");

    expect(labels(tabs)).toEqual(["Dashboard", "Daily Attendance", "Worker Directory", "Payroll Summary"]);
    expect(labels(more)).toEqual([
      "Leave Management",
      "Finance",
  "Accounts",
      "Expenses",
      "Income",
      "Partners",
      "Finance Reports",
      "Deductions",
      "Staff Attendance",
      "Staff Payroll Summary",
      "Staff Leave",
      "Site Progress",
      "Tax Invoices",
      "HR Letters",
      "User Manager",
      "Settings",
    ]);
  });

  it("gives an Administrator the same split as a Manager", () => {
    expect(phoneNavFor("Administrator")).toEqual(phoneNavFor("Manager"));
  });

  it("shows a Supervisor their five screens with no More", () => {
    const { tabs, more } = phoneNavFor("Supervisor");

    expect(labels(tabs)).toEqual(["Daily Attendance", "Worker Directory", "Leave Management", "Site Progress", "HR Letters"]);
    expect(more).toEqual([]);
  });

  it.each(["Administrator", "Manager", "Supervisor"] as const)(
    "never needs more than five bottom-bar slots for a %s",
    (role) => {
      const { tabs, more } = phoneNavFor(role);
      expect(tabs.length + (more.length > 0 ? 1 : 0)).toBeLessThanOrEqual(5);
    },
  );

  it("keeps every screen reachable exactly once", () => {
    const { tabs, more } = phoneNavFor("Manager");
    expect(labels([...tabs, ...more]).sort()).toEqual(labels(navItemsForRole("Manager")).sort());
  });
});
