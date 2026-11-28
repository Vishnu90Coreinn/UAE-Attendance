import { expect, it } from "vitest";
import { presetRange, rangeProblem } from "./reportPeriods";

it("this month runs from the 1st to today", () => expect(presetRange("month", "2026-11-25")).toEqual({ from: "2026-11-01", to: "2026-11-25" }));
it("this year runs from 1 January to today", () => expect(presetRange("year", "2026-11-25")).toEqual({ from: "2026-01-01", to: "2026-11-25" }));
it("last month is the whole previous month, leap February included", () => {
  expect(presetRange("last", "2026-11-25")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  expect(presetRange("last", "2028-03-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
});
it("last month in January is December of the year before", () => expect(presetRange("last", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" }));
it("refuses a missing, backwards or future range", () => {
  expect(rangeProblem({ from: "", to: "2026-11-01" }, "2026-11-25")).toMatch(/both dates/);
  expect(rangeProblem({ from: "2026-11-02", to: "2026-11-01" }, "2026-11-25")).toMatch(/before the start/);
  expect(rangeProblem({ from: "2026-11-01", to: "2026-11-26" }, "2026-11-25")).toMatch(/future/);
  expect(rangeProblem({ from: "2026-11-01", to: "2026-11-25" }, "2026-11-25")).toBeNull();
});
