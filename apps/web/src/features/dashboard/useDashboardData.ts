import { useEffect, useState } from "react";
import {
  getAttendance,
  getAttendanceSummary,
  type AttendanceSummary,
} from "../../api/attendance";
import { listLeave, type LeaveRequest } from "../../api/leave";
import { getPayroll, type PayrollReport } from "../../api/payroll";

export type Load<T> =
  { status: "loading" } | { status: "error" } | { status: "ready"; value: T };

/** One day of the attendance trend: how many workers were present, absent, or not yet recorded. */
export interface TrendDay {
  date: string;
  /** Short weekday name for the chart axis, e.g. "Mon". */
  label: string;
  present: number;
  absent: number;
  notRecorded: number;
  total: number;
}

const TREND_DAYS = 7;

/** Loads one figure on its own, so a failure in one widget never blanks the others. */
function useLoad<T>(load: () => Promise<T>): Load<T> {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(load)
      .then(
        (value) =>
          !cancelled &&
          setState(
            value === undefined
              ? { status: "error" }
              : { status: "ready", value },
          ),
        () => !cancelled && setState({ status: "error" }),
      );
    return () => {
      cancelled = true;
    };
    // The figures load once when the dashboard opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

/** Today's date and month in the UAE, as yyyy-MM-dd and yyyy-MM. */
export function dubaiToday(): { date: string; month: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    month: `${get("year")}-${get("month")}`,
  };
}

function daysBefore(date: string, count: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - count);
  return value.toISOString().slice(0, 10);
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00Z`));
}

export interface DashboardData {
  /** The last seven days, oldest first; the final entry is today. */
  trend: Load<TrendDay[]>;
  waiting: Load<AttendanceSummary>;
  leave: Load<LeaveRequest[]>;
  payroll: Load<PayrollReport>;
}

export function useDashboardData(): DashboardData {
  const { date, month } = dubaiToday();
  const trend = useLoad(async () => {
    const dates = Array.from({ length: TREND_DAYS }, (_, index) =>
      daysBefore(date, TREND_DAYS - 1 - index),
    );
    const days = await Promise.all(dates.map((day) => getAttendance(day)));
    return days.map((day, index): TrendDay => {
      const present = day.rows.filter(
        (row) => row.record?.status === "Present",
      ).length;
      const absent = day.rows.filter(
        (row) => row.record?.status === "Absent",
      ).length;
      return {
        date: dates[index],
        label: weekday(dates[index]),
        present,
        absent,
        notRecorded: day.rows.length - present - absent,
        total: day.rows.length,
      };
    });
  });
  const waiting = useLoad(() => getAttendanceSummary());
  const leave = useLoad(() => listLeave({ status: "Pending" }));
  const payroll = useLoad(() => getPayroll(month));
  return { trend, waiting, leave, payroll };
}
