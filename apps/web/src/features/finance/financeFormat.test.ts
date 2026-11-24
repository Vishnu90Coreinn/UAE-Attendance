import { describe, expect, it } from "vitest";
import { formatDay, formatMoney, parseMoneyInput, sharePercent, sumMoney } from "./financeFormat";

describe("financeFormat", () => {
  it("formats AED with two decimals and thousands separators", () => {
    expect(formatMoney(1234567.5)).toBe("1,234,567.50");
    expect(formatMoney(0)).toBe("0.00");
    expect(formatMoney(-50.75)).toBe("-50.75");
  });

  it("adds amounts without floating-point drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the problem being avoided
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([950.25, 250, -50.75])).toBe(1149.5);
    expect(sumMoney([])).toBe(0);
  });

  it("works out a whole-number share and never divides by zero", () => {
    expect(sharePercent(250, 1000)).toBe(25);
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(10, 0)).toBe(0);
    expect(sharePercent(-5, 100)).toBe(0);
  });

  it("reads typed money and refuses anything else", () => {
    expect(parseMoneyInput("1,500.50")).toBe(1500.5);
    expect(parseMoneyInput(" 20 ")).toBe(20);
    expect(parseMoneyInput("-5.25")).toBe(-5.25);
    expect(parseMoneyInput("1.005")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("12.")).toBeNull();
  });

  it("writes a date as text so no time zone can move the day", () => {
    expect(formatDay("2026-08-05")).toBe("5 Aug 2026");
    expect(formatDay("2026-12-31")).toBe("31 Dec 2026");
    expect(formatDay("nonsense")).toBe("nonsense");
  });
});
