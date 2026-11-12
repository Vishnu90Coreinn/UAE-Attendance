import { describe, expect, it } from "vitest";
import { formatDisplayDate } from "./date";

describe("formatDisplayDate", () => {
  it("writes a calendar date as day, short month and year", () => {
    expect(formatDisplayDate("2026-12-01")).toBe("1 Dec 2026");
    expect(formatDisplayDate("2026-10-20")).toBe("20 Oct 2026");
  });
  it("is empty for a missing date and leaves other text alone", () => {
    expect(formatDisplayDate(null)).toBe("");
    expect(formatDisplayDate(undefined)).toBe("");
    expect(formatDisplayDate("n/a")).toBe("n/a");
  });
});
