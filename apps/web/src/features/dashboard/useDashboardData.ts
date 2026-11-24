import { useEffect, useRef, useState } from "react";
import {
  getAttendanceSummary,
  getAttendanceTrend,
  type AttendanceSummary,
} from "../../api/attendance";
import { listLeave, type LeaveRequest } from "../../api/leave";
import { listInvoices, type InvoiceSummary } from "../../api/invoices";
import { getPayroll, type PayrollReport } from "../../api/payroll";
import { getStaffDashboard, getStaffPayroll, listStaffLeave, type StaffDashboard, type StaffLeave, type StaffPayrollSummary } from "../../api/staff";

export type Load<T> =
  { status: "loading" } | { status: "error" } | { status: "ready"; value: T };

/** One day of the attendance trend: how many workers were present, absent, or not yet recorded. */
export interface TrendDay {
  date: string;
  /** Short weekday name for the chart axis, e.g. "Mon". */
  label: string;
  present: number;
  absent: number;
  /** Annual, sick or emergency leave. */
  onLeave: number;
  notRecorded: number;
  total: number;
}

const TREND_DAYS = 7;

/**
 * Loads one figure on its own, so a failure in one widget never blanks the others. A refresh keeps the figure on screen
 * while it reloads, and a failed refresh keeps the last good figure rather than replacing it with an error.
 */
function useLoad<T>(load: () => Promise<T>, version: number, onSettled: () => void): Load<T> {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(load)
      .then(
        (value) => {
          if (cancelled) return;
          setState(value === undefined ? { status: "error" } : { status: "ready", value });
          onSettled();
        },
        () => {
          if (cancelled) return;
          setState((previous) => (previous.status === "ready" ? previous : { status: "error" }));
          onSettled();
        },
      );
    return () => {
      cancelled = true;
    };
    // Reloads when the refresh counter moves; the loader itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
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
  /** Office employees' payroll for the same month; added to the site payroll on the dashboard. */
  staffPayroll: Load<StaffPayrollSummary>;
  /** Office employees today: signed in, late, absent, on leave. */
  staff: Load<StaffDashboard>;
  staffLeave: Load<StaffLeave[]>;
  /** Every tax invoice; the dashboard totals what is billed, outstanding and overdue. */
  invoices: Load<InvoiceSummary[]>;
  /** When every figure last finished loading; null until the first load completes. */
  updatedAt: Date | null;
  refreshing: boolean;
  refresh: () => void;
}

const LOADS = 8;

export function useDashboardData(): DashboardData {
  const { date, month } = dubaiToday();
  const [version, setVersion] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pending = useRef(LOADS);
  const settled = () => {
    pending.current -= 1;
    if (pending.current <= 0) {
      setUpdatedAt(new Date());
      setRefreshing(false);
    }
  };
  const trend = useLoad(async () => {
    const days = await getAttendanceTrend(date, TREND_DAYS);
    return days.map((day): TrendDay => ({ ...day, label: weekday(day.date) }));
  }, version, settled);
  const waiting = useLoad(() => getAttendanceSummary(), version, settled);
  const leave = useLoad(() => listLeave({ status: "Pending" }), version, settled);
  const payroll = useLoad(() => getPayroll(month), version, settled);
  const staffPayroll = useLoad(() => getStaffPayroll(month), version, settled);
  const staff = useLoad(() => getStaffDashboard(), version, settled);
  const staffLeave = useLoad(() => listStaffLeave({ status: "Pending" }), version, settled);
  const invoices = useLoad(() => listInvoices(), version, settled);
  const refresh = () => {
    if (refreshing) return;
    pending.current = LOADS;
    setRefreshing(true);
    setVersion((v) => v + 1);
  };
  return { trend, waiting, leave, payroll, staffPayroll, staff, staffLeave, invoices, updatedAt, refreshing, refresh };
}
