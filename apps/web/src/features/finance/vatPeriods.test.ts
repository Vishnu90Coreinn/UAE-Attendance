import { expect, it } from "vitest";
import { vatDueDate, vatQuarter } from "./vatPeriods";

it("gives the calendar quarter of a date, and the ones before and after across years", () => {
  expect(vatQuarter("2026-11-26")).toEqual({ from: "2026-10-01", to: "2026-12-31", label: "Q4 2026" });
  expect(vatQuarter("2027-01-01", -1)).toEqual({ from: "2026-10-01", to: "2026-12-31", label: "Q4 2026" });
  expect(vatQuarter("2027-02-14")).toEqual({ from: "2027-01-01", to: "2027-03-31", label: "Q1 2027" });
  expect(vatQuarter("2026-05-31").to).toBe("2026-06-30");
});

it("says the return is due 28 days after the quarter ends", () => {
  expect(vatDueDate("2026-12-31")).toBe("2027-01-28");
  expect(vatDueDate("2027-03-31")).toBe("2027-04-28");
});
