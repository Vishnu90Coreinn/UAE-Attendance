import { describe, expect, it } from "vitest";
import { dailyPay } from "./dailyPay";
import vectors from "../../../../docs/payroll-test-vectors.json";
import type { AttendanceStatus } from "../api/attendance";

describe("dailyPay preview", () => {
  it.each(vectors.daily)("matches shared server vector: $name", (vector) => {
    expect(
      dailyPay(
        vector.status as AttendanceStatus,
        vector.basicHours,
        vector.overtimeHours,
        vector.hourlyRate,
        vector.companyOvertimeRate,
        vector.workerOvertimeRate,
      ),
    ).toEqual(vector.expected);
  });
  it.each(vectors.monthly)("sums rounded daily components: $name", (vector) => {
    const sums = { basicPay: 0, overtimePay: 0, totalPay: 0, daysWorked: 0 };
    for (const input of vector.days) {
      const pay = dailyPay(
        input.status as AttendanceStatus,
        input.basicHours,
        input.overtimeHours,
        input.hourlyRate,
        input.companyOvertimeRate,
        input.workerOvertimeRate,
      );
      sums.basicPay += Math.round(pay.basicPay * 100) * input.repeat;
      sums.overtimePay += Math.round(pay.overtimePay * 100) * input.repeat;
      sums.totalPay += Math.round(pay.totalPay * 100) * input.repeat;
      sums.daysWorked += pay.daysWorked * input.repeat;
    }
    expect({
      ...sums,
      basicPay: sums.basicPay / 100,
      overtimePay: sums.overtimePay / 100,
      totalPay: sums.totalPay / 100,
    }).toEqual(vector.expected);
  });
  it("rounds components separately, half away from zero", () => {
    expect(dailyPay("Present", 7.75, 0.25, 10.5, 2.22)).toEqual({
      basicPay: 81.38,
      overtimePay: 0.56,
      totalPay: 81.94,
      daysWorked: 1,
    });
  });
  it("uses an explicit zero overtime override", () => {
    expect(dailyPay("Present", 8, 2, 12.5, 2.22, 0).totalPay).toBe(100);
  });
  it.each([null, "Absent"] as const)(
    "gives no pay or worked day for %s",
    (status) => {
      expect(dailyPay(status, 8, 2, 12.5, 2.22)).toEqual({
        basicPay: 0,
        overtimePay: 0,
        totalPay: 0,
        daysWorked: 0,
      });
    },
  );
  it.each(["Annual Leave", "Sick Leave", "Emergency Leave"] as const)(
    "pays %s at basic hours only and counts a worked day",
    (status) => {
      expect(dailyPay(status, 8, 2, 12.5, 2.22)).toEqual({
        basicPay: 100,
        overtimePay: 0,
        totalPay: 100,
        daysWorked: 1,
      });
      expect(dailyPay(status, 0, 0, 12.5, 2.22).totalPay).toBe(0);
    },
  );
});
