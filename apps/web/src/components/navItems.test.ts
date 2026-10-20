import { describe, expect, it } from "vitest";
import { navItemsForRole } from "./navItems";

const MODULES = ["Worker Directory", "Daily Attendance", "Payroll Summary", "Leave Management"];

function labelsFor(role: Parameters<typeof navItemsForRole>[0]) {
  return navItemsForRole(role).map((item) => item.label);
}

describe("navItemsForRole", () => {
  it("gives an Administrator the four modules plus User Manager, in prototype order", () => {
    expect(labelsFor("Administrator")).toEqual([...MODULES, "User Manager"]);
  });

  it("gives HR Staff the four modules without User Manager", () => {
    expect(labelsFor("HR Staff")).toEqual(MODULES);
  });

  it("gives a Viewer the four modules without User Manager", () => {
    expect(labelsFor("Viewer")).toEqual(MODULES);
  });

  it("gives only Worker Directory a route for now; the other tabs stay placeholders", () => {
    const paths = Object.fromEntries(navItemsForRole("Administrator").map((item) => [item.label, item.path]));

    expect(paths).toEqual({
      "Worker Directory": "/workers",
      "Daily Attendance": undefined,
      "Payroll Summary": undefined,
      "Leave Management": undefined,
      "User Manager": undefined,
    });
  });
});
