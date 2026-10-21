import { describe, expect, it } from "vitest";
import { stepHours } from "./attendanceForm";

describe("stepHours", () => {
  it("moves the value by the step", () => {
    expect(stepHours("8", 0.5, 24)).toBe("8.5");
    expect(stepHours("8", -0.5, 24)).toBe("7.5");
  });

  it("starts from zero when the field is empty or not a number", () => {
    expect(stepHours("", 0.5, 24)).toBe("0.5");
    expect(stepHours("abc", 0.5, 24)).toBe("0.5");
  });

  it("never goes below zero", () => {
    expect(stepHours("0", -0.5, 24)).toBe("0");
    expect(stepHours("0.25", -0.5, 24)).toBe("0");
  });

  it("never goes above the maximum", () => {
    expect(stepHours("8", 0.5, 8)).toBe("8");
    expect(stepHours("7.75", 0.5, 8)).toBe("8");
  });

  it("keeps at most two decimals so the value stays valid", () => {
    expect(stepHours("1.1", 0.1, 24)).toBe("1.2");
    expect(stepHours("0.1", 0.2, 24)).toBe("0.3");
  });
});
