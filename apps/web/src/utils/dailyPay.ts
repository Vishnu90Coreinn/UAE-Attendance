import type { AttendanceStatus, DailyPay } from "../api/attendance";
import { isLeaveStatus } from "./leaveStatuses";

/** Preview only. Inputs have at most two decimals; integer hundredths keep midpoint rounding exact. */
export function dailyPay(
  status: AttendanceStatus,
  basicHours: number,
  overtimeHours: number,
  hourlyRate: number,
  companyOvertimeRate: number,
  workerOvertimeRate: number | null = null,
): DailyPay {
  const paidLeave = isLeaveStatus(status) && basicHours > 0;
  if (status !== "Present" && !paidLeave)
    return { basicPay: 0, overtimePay: 0, totalPay: 0, daysWorked: 0 };
  const cents = (hours: number, rate: number) =>
    Math.floor((Math.round(hours * 100) * Math.round(rate * 100) + 50) / 100);
  const basic = cents(basicHours, hourlyRate);
  const overtime = cents(
    paidLeave ? 0 : overtimeHours,
    workerOvertimeRate ?? companyOvertimeRate,
  );
  return {
    basicPay: basic / 100,
    overtimePay: overtime / 100,
    totalPay: (basic + overtime) / 100,
    daysWorked: 1,
  };
}
