import { describe, expect, it } from "vitest";
import { navItemsForRole } from "./navItems";

const MODULES = [
  "Worker Directory",
  "Daily Attendance",
  "Payroll Summary",
  "Leave Management",
];

function labelsFor(role: Parameters<typeof navItemsForRole>[0]) {
  return navItemsForRole(role).map((item) => item.label);
}

describe("navItemsForRole", () => {
  it("gives an Administrator the four modules plus User Manager and Settings, in order", () => {
    expect(labelsFor("Administrator")).toEqual([
      ...MODULES,
      "User Manager",
      "Settings",
    ]);
  });

  it("gives a Manager the same tabs as an Administrator", () => {
    expect(labelsFor("Manager")).toEqual([...MODULES, "User Manager", "Settings"]);
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
      "Worker Directory": "/workers",
      "Daily Attendance": "/attendance",
      "Payroll Summary": "/payroll",
      "Leave Management": "/leave",
      "User Manager": "/users",
      Settings: "/settings",
    });
  });
});
