import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import * as leaveApi from "../../api/leave";
import { LeaveBalances } from "./LeaveBalances";

vi.mock("../../api/leave");

beforeEach(() => {
  vi.resetAllMocks();
});

it("shows what is left of each paid allowance and when annual leave unlocks", async () => {
  vi.mocked(leaveApi.getLeaveBalances).mockResolvedValue([
    {
      workerId: 1,
      workerCode: "W001",
      workerName: "Ahmed Khan",
      joinDate: "2025-01-01",
      balances: [
        { leaveType: "Annual Leave", allowance: 30, used: 4, remaining: 26, available: true, eligibleFrom: "2025-11-01", periodStart: "2026-01-01", periodEnd: "2026-12-31" },
        { leaveType: "Sick Leave", allowance: 15, used: 2, remaining: 13, available: true, eligibleFrom: "2025-01-01", periodStart: "2026-01-01", periodEnd: "2026-12-31" },
        { leaveType: "Emergency Leave", allowance: 5, used: 5, remaining: 0, available: true, eligibleFrom: "2025-01-01", periodStart: "2026-01-01", periodEnd: "2026-12-31" },
      ],
    },
    {
      workerId: 2,
      workerCode: "W002",
      workerName: "Bilal Raza",
      joinDate: "2026-06-01",
      balances: [
        { leaveType: "Annual Leave", allowance: 30, used: 0, remaining: 0, available: false, eligibleFrom: "2027-04-01", periodStart: null, periodEnd: null },
        { leaveType: "Sick Leave", allowance: 15, used: 0, remaining: 15, available: true, eligibleFrom: "2026-06-01", periodStart: "2026-06-01", periodEnd: "2027-05-31" },
        { leaveType: "Emergency Leave", allowance: 5, used: 0, remaining: 5, available: true, eligibleFrom: "2026-06-01", periodStart: "2026-06-01", periodEnd: "2027-05-31" },
      ],
    },
  ]);
  render(<LeaveBalances />);
  expect(await screen.findByText("Leave balances")).toBeInTheDocument();
  expect(screen.getByText(/4 of 30 used/)).toBeInTheDocument();
  expect(screen.getByText(/5 of 5 used/)).toBeInTheDocument();
  expect(screen.getByText("From 2027-04-01")).toBeInTheDocument();
});

it("shows nothing when there are no workers", async () => {
  vi.mocked(leaveApi.getLeaveBalances).mockResolvedValue([]);
  render(<LeaveBalances />);
  await Promise.resolve();
  expect(screen.queryByText("Leave balances")).not.toBeInTheDocument();
});
