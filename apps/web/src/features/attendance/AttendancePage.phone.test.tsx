import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/attendance";
import type { AttendanceDay, AttendanceRow } from "../../api/attendance";
import { getPayrollSettings } from "../../api/settings";
import { useAuth } from "../../contexts/AuthContext";
import { mockViewport, restoreViewport } from "../../test-viewport";
import { AttendancePage } from "./AttendancePage";

vi.mock("../../api/attendance");
vi.mock("../../api/settings");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

function worker(id: number, fullName: string): AttendanceRow["worker"] {
  return {
    id,
    workerCode: `EMP-00${id}`,
    fullName,
    designation: "Installer",
    hourlyRate: 12.5,
    overtimeRate: null,
    effectiveOvertimeRate: 2.22,
    isActive: true,
  };
}
const noPay = { basicPay: 0, overtimePay: 0, totalPay: 0, daysWorked: 0 };
function record(
  status: "Present" | "Absent",
  approvalStatus: "Submitted" | "Approved" | "Rejected",
  basicHours = 8,
  rejectionReason: string | null = null,
) {
  return { status, basicHours, overtimeHours: 0, approvalStatus, rejectionReason };
}
const day: AttendanceDay = {
  date: "2026-10-19",
  isFinalised: false,
  pendingCount: 0,
  rows: [
    { worker: worker(1, "Ahmed Khan"), record: null, dailyPay: noPay },
    { worker: worker(2, "Bilal Raza"), record: null, dailyPay: noPay },
  ],
};

function signIn(role: "Manager" | "Supervisor") {
  vi.mocked(useAuth).mockReturnValue({
    status: "signedIn",
    user: { id: 1, username: "someone", role },
    token: "t",
    login: vi.fn(),
    logout: vi.fn(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockViewport("phone");
  signIn("Manager");
  vi.mocked(api.getAttendance).mockResolvedValue(day);
  vi.mocked(api.saveAttendance).mockResolvedValue(day);
  vi.mocked(getPayrollSettings).mockResolvedValue({
    companyName: "Company",
    tagline: "",
    contactEmail: "hr@example.com",
    overtimeRatePerHour: 2.22,
    maxBasicHoursPerDay: 8,
    shiftDescription: "06:00 AM - 05:30 PM",
    preparedByLabel: "HR Department",
    approvedByLabel: "General Manager",
  });
});

afterEach(restoreViewport);

async function loaded() {
  const user = userEvent.setup();
  render(<AttendancePage />);
  await screen.findByRole("list", { name: /Daily attendance/ });
  return user;
}
const card = (name: string) => screen.getByRole("listitem", { name: new RegExp(name) });

describe("Daily Attendance on a phone", () => {
  it("shows each worker as a card instead of a table", async () => {
    await loaded();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Ahmed Khan")).toBeInTheDocument();
    expect(within(cards[0]).getByText(/EMP-001 · Installer/)).toBeInTheDocument();
  });

  it("starts with nothing recorded and no hours to fill in", async () => {
    await loaded();

    const first = card("Ahmed Khan");
    expect(within(first).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "false");
    expect(within(first).getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "false");
    expect(within(first).queryByLabelText("Basic hours for Ahmed Khan")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save day" })).toBeDisabled();
  });

  it("fills in the standard shift when a worker is marked Present", async () => {
    const user = await loaded();

    await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));

    expect(within(card("Ahmed Khan")).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Basic hours for Ahmed Khan")).not.toBeInTheDocument();
    expect(within(card("Ahmed Khan")).getByText("8.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Overtime hours for Ahmed Khan")).toHaveValue(0);
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save day" })).toBeEnabled();
  });

  it("steps overtime up and down in half hours within the limits", async () => {
    const user = await loaded();
    await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));
    const overtime = screen.getByLabelText("Overtime hours for Ahmed Khan");

    await user.click(screen.getByRole("button", { name: "Increase overtime hours for Ahmed Khan" }));
    await user.click(screen.getByRole("button", { name: "Increase overtime hours for Ahmed Khan" }));
    expect(overtime).toHaveValue(1);

    await user.click(screen.getByRole("button", { name: "Decrease overtime hours for Ahmed Khan" }));
    expect(overtime).toHaveValue(0.5);

    await user.click(screen.getByRole("button", { name: "Decrease overtime hours for Ahmed Khan" }));
    expect(screen.getByRole("button", { name: "Decrease overtime hours for Ahmed Khan" })).toBeDisabled();
  });

  it("marks a worker Absent with no hours, and tapping the choice again clears it", async () => {
    const user = await loaded();
    const first = card("Ahmed Khan");

    await user.click(within(first).getByRole("button", { name: "Absent" }));
    expect(within(first).getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
    expect(within(first).queryByLabelText("Basic hours for Ahmed Khan")).not.toBeInTheDocument();

    await user.click(within(first).getByRole("button", { name: "Absent" }));
    expect(within(first).getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Save day" })).toBeDisabled();
  });

  it("saves the day from the bar pinned above the tab bar", async () => {
    const user = await loaded();
    await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));
    await user.click(screen.getByRole("button", { name: "Increase overtime hours for Ahmed Khan" }));
    await user.click(within(card("Bilal Raza")).getByRole("button", { name: "Absent" }));
    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save day" }));

    expect(api.saveAttendance).toHaveBeenCalledWith(expect.any(String), [
      { workerId: 1, status: "Present", basicHours: 8, overtimeHours: 0.5 },
      { workerId: 2, status: "Absent", basicHours: 0, overtimeHours: 0 },
    ]);
    expect(await screen.findByText("Attendance saved.")).toBeInTheDocument();
  });

  it("shows a Manager the live pay for a card and a Supervisor none", async () => {
    const user = await loaded();
    await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));
    expect(within(card("Ahmed Khan")).getByText("Total pay (AED)")).toBeInTheDocument();
    expect(within(card("Ahmed Khan")).getByText("100.00")).toBeInTheDocument();
  });

  it("never shows pay to a Supervisor", async () => {
    signIn("Supervisor");
    const user = await loaded();
    await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));

    expect(screen.queryByText("Total pay (AED)")).not.toBeInTheDocument();
    expect(screen.queryByText("100.00")).not.toBeInTheDocument();
  });

  it("lets a Manager approve or send back a submitted entry from its card", async () => {
    vi.mocked(api.getAttendance).mockResolvedValue({
      ...day,
      pendingCount: 1,
      rows: [{ ...day.rows[0], record: record("Present", "Submitted") }, day.rows[1]],
    });
    vi.mocked(api.approveAttendance).mockResolvedValue(day);
    const user = await loaded();
    const first = card("Ahmed Khan");

    expect(within(first).getByText("Waiting for approval")).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "Send back Ahmed Khan" })).toBeInTheDocument();
    await user.click(within(first).getByRole("button", { name: "Approve Ahmed Khan" }));

    expect(api.approveAttendance).toHaveBeenCalledWith(expect.any(String), [1]);
  });

  it("shows a Supervisor why an entry was sent back and lets them resubmit it", async () => {
    signIn("Supervisor");
    vi.mocked(api.getAttendance).mockResolvedValue({
      ...day,
      rows: [{ ...day.rows[0], record: record("Present", "Rejected", 8, "Check the hours") }, day.rows[1]],
    });
    vi.mocked(api.saveAttendance).mockResolvedValue(day);
    const user = await loaded();
    const first = card("Ahmed Khan");

    expect(within(first).getByText("Sent back")).toBeInTheDocument();
    expect(within(first).getByText("Reason: Check the hours")).toBeInTheDocument();
    await user.click(within(first).getByRole("button", { name: "Resubmit Ahmed Khan" }));

    expect(api.saveAttendance).toHaveBeenCalled();
  });

  it("keeps an approved entry read-only for a Supervisor", async () => {
    signIn("Supervisor");
    vi.mocked(api.getAttendance).mockResolvedValue({
      ...day,
      rows: [{ ...day.rows[0], record: record("Present", "Approved") }, day.rows[1]],
    });
    await loaded();
    const first = card("Ahmed Khan");

    expect(within(first).queryByRole("button", { name: "Present" })).not.toBeInTheDocument();
    expect(within(first).getByText("Present")).toBeInTheDocument();
    expect(within(first).getByText("Approved")).toBeInTheDocument();
    expect(within(first).getByText("8.00")).toBeInTheDocument();
  });

  it("locks every card when the month is finalised", async () => {
    vi.mocked(api.getAttendance).mockResolvedValue({ ...day, isFinalised: true });
    await loaded();

    expect(screen.getByText("This month is finalised. Attendance is locked.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Present" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save day" })).not.toBeInTheDocument();
  });

  describe("date stepper", () => {
    const shift = (value: string, days: number) => {
      const date = new Date(`${value}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };

    it("goes back a day and forward again, but not past today", async () => {
      const user = await loaded();
      const input = screen.getByLabelText("Work date") as HTMLInputElement;
      const today = input.value;
      expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();

      await user.click(screen.getByRole("button", { name: "Previous day" }));
      await waitFor(() => expect(api.getAttendance).toHaveBeenLastCalledWith(shift(today, -1)));
      expect(input.value).toBe(shift(today, -1));

      await user.click(screen.getByRole("button", { name: "Next day" }));
      await waitFor(() => expect(api.getAttendance).toHaveBeenLastCalledWith(today));
      expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
    });

    it("asks before discarding unsaved edits when stepping to another day", async () => {
      const user = await loaded();
      await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));

      await user.click(screen.getByRole("button", { name: "Previous day" }));

      expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    });
  });
});
