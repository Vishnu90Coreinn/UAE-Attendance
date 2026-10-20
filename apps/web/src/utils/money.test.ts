import { describe, expect, it } from "vitest";
import { formatRate } from "./money";

describe("formatRate", () => {
  it("always shows two decimals", () => {
    expect(formatRate(12)).toBe("12.00");
    expect(formatRate(12.5)).toBe("12.50");
    expect(formatRate(2.22)).toBe("2.22");
  });

  it("rounds to two decimals", () => {
    expect(formatRate(12.345)).toBe("12.35");
  });

  it("keeps small and large rates readable", () => {
    expect(formatRate(0.5)).toBe("0.50");
    expect(formatRate(999.99)).toBe("999.99");
  });
});
