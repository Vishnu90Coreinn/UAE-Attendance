import { describe, expect, it } from "vitest";
import { navItemsForRole } from "./navItems";

const MODULES = ["Worker Directory", "Daily Attendance", "Payroll Summary", "Leave Management"];

function labelsFor(role: Parameters<typeof navItemsForRole>[0]) {
  return navItemsForRole(role).map((item) => item.label);
}

describe("navItemsForRole", () => {
  it("gives an Administrator the four modules plus User Manager and Settings, in order", () => {
    expect(labelsFor("Administrator")).toEqual([...MODULES, "User Manager", "Settings"]);
  });

  it("gives HR Staff the four modules without User Manager or Settings", () => {
    expect(labelsFor("HR Staff")).toEqual(MODULES);
  });

  it("gives a Viewer the four modules without User Manager or Settings", () => {
    expect(labelsFor("Viewer")).toEqual(MODULES);
  });

  it("gives Worker Directory, Daily Attendance and Settings a route", () => {
    const paths = Object.fromEntries(navItemsForRole("Administrator").map((item) => [item.label, item.path]));

    expect(paths).toEqual({
      "Worker Directory": "/workers",
      "Daily Attendance": "/attendance",
      "Payroll Summary": "/payroll",
      "Leave Management": undefined,
      "User Manager": undefined,
      Settings: "/settings",
    });
  });
});
