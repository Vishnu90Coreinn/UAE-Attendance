import { describe, expect, it } from "vitest";
import { navItemsForRole, phoneNavFor } from "./navItems";

const MODULES = [
  "Worker Directory",
  "Daily Attendance",
  "Payroll Summary",
  "Deductions",
  "Leave Management",
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

  it("gives a Supervisor only Worker Directory, Daily Attendance and Leave Management", () => {
    expect(labelsFor("Supervisor")).toEqual([
      "Worker Directory",
      "Daily Attendance",
      "Leave Management",
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
      "User Manager": "/users",
      Settings: "/settings",
    });
  });
});

describe("phoneNavFor", () => {
  const labels = (items: { label: string }[]) => items.map((item) => item.label);

  it("puts the dashboard first and moves the rarely used screens behind More for a Manager", () => {
    const { tabs, more } = phoneNavFor("Manager");

    expect(labels(tabs)).toEqual(["Dashboard", "Daily Attendance", "Worker Directory", "Payroll Summary"]);
    expect(labels(more)).toEqual(["Leave Management", "Deductions", "User Manager", "Settings"]);
  });

  it("gives an Administrator the same split as a Manager", () => {
    expect(phoneNavFor("Administrator")).toEqual(phoneNavFor("Manager"));
  });

  it("shows a Supervisor their three screens with no More", () => {
    const { tabs, more } = phoneNavFor("Supervisor");

    expect(labels(tabs)).toEqual(["Daily Attendance", "Worker Directory", "Leave Management"]);
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
