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
/** Overtime and leave live in a panel behind the row's "..." button. */
const openMore = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(within(card(name)).getByRole("button", { name: `Leave and overtime for ${name}` }));

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
    expect(screen.queryByRole("button", { name: "Save day" })).not.toBeInTheDocument();
  });

  it("fills in the standard shift when a worker is marked Present", async () => {
    const user = await loaded();

    await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));

    expect(within(card("Ahmed Khan")).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Basic hours for Ahmed Khan")).not.toBeInTheDocument();
    expect(within(card("Ahmed Khan")).getByText("8.00")).toBeInTheDocument();
    expect(screen.queryByLabelText("Overtime hours for Ahmed Khan")).not.toBeInTheDocument();
    await openMore(user, "Ahmed Khan");
    expect(screen.getByLabelText("Overtime hours for Ahmed Khan")).toHaveValue(0);
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save day" })).toBeEnabled();
  });

  it("steps overtime up and down in half hours within the limits", async () => {
    const user = await loaded();
    await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));
    await openMore(user, "Ahmed Khan");
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
    expect(screen.queryByRole("button", { name: "Save day" })).not.toBeInTheDocument();
  });

  it("saves the day from the bar pinned above the tab bar", async () => {
    const user = await loaded();
    await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));
    await openMore(user, "Ahmed Khan");
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

  it("records a leave type from the row's panel and closes it", async () => {
    const user = await loaded();
    await openMore(user, "Ahmed Khan");

    await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Sick Leave" }));

    expect(within(card("Ahmed Khan")).getByText("Sick Leave")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Leave for Ahmed Khan" })).not.toBeInTheDocument();
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
  });

  it("shows how many are recorded and narrows the list with the chips", async () => {
    const user = await loaded();
    expect(screen.getByText("0 of 2 marked")).toBeInTheDocument();
    await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));
    expect(screen.getByText("1 of 2 marked")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Not marked/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(card("Bilal Raza")).toBeInTheDocument();

    // Tapping the chosen chip again shows everyone.
    await user.click(screen.getByRole("button", { name: /^Not marked/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("marks the unrecorded workers present from the bar, and undoes it", async () => {
    const user = await loaded();
    await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Absent" }));

    await user.click(screen.getByRole("button", { name: "Mark 1 present" }));

    expect(within(card("Bilal Raza")).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
    expect(within(card("Ahmed Khan")).getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Marked 1 present")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Mark \d* ?(all )?present/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(within(card("Bilal Raza")).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Mark 1 present" })).toBeInTheDocument();
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

  it("shows a submitted entry for review: no tick or cross, pay beside the status, text-only Approve and Send back", async () => {
    vi.mocked(api.getAttendance).mockResolvedValue({
      ...day,
      pendingCount: 1,
      rows: [{ ...day.rows[0], record: record("Present", "Submitted") }, day.rows[1]],
    });
    await loaded();
    const first = card("Ahmed Khan");

    expect(within(first).queryByRole("button", { name: "Present" })).not.toBeInTheDocument();
    expect(within(first).queryByRole("button", { name: "Absent" })).not.toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "Leave and overtime for Ahmed Khan" })).toBeInTheDocument();
    expect(within(first).getByText("Waiting for approval")).toBeInTheDocument();
    expect(within(first).getByText("Total pay (AED)")).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "Approve Ahmed Khan" })).toHaveTextContent(/^Approve$/);
    expect(within(first).getByRole("button", { name: "Send back Ahmed Khan" })).toHaveTextContent(/^Send back$/);
    // The unrecorded worker next to it still has the ordinary tick and cross.
    expect(within(card("Bilal Raza")).getByRole("button", { name: "Present" })).toBeInTheDocument();
  });

  it("lets a Manager change a submitted entry from its menu, which holds the approval until it is saved", async () => {
    vi.mocked(api.getAttendance).mockResolvedValue({
      ...day,
      pendingCount: 1,
      rows: [{ ...day.rows[0], record: record("Present", "Submitted") }, day.rows[1]],
    });
    const user = await loaded();
    const first = card("Ahmed Khan");

    await openMore(user, "Ahmed Khan");
    const entry = within(first).getByRole("group", { name: "Status for Ahmed Khan" });
    expect(within(entry).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(entry).getByRole("button", { name: "Absent" }));

    expect(within(first).queryByRole("button", { name: "Approve Ahmed Khan" })).not.toBeInTheDocument();
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
  });

  it("shows a Supervisor why an entry was sent back and lets them resubmit it", async () => {
    signIn("Supervisor");
    vi.mocked(api.getAttendance).mockResolvedValue({
      ...day,
      rows: [{ ...day.rows[0], record: record("Present", "Rejected", 8, "Check the hours") }, day.rows[1]],
    });
    vi.mocked(api.saveAttendance).mockResolvedValue(day);
    const user = await loaded();

    // A sent-back tile does not flip on a tap; it opens what needs fixing.
    await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Details for Ahmed Khan" }));
    const sheet = await screen.findByRole("dialog", { name: "Ahmed Khan" });

    expect(within(sheet).getByText("Sent back")).toBeInTheDocument();
    expect(within(sheet).getByText("Reason: Check the hours")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Resubmit Ahmed Khan" }));

    expect(api.saveAttendance).toHaveBeenCalled();
  });

  it("keeps an approved entry read-only for a Supervisor", async () => {
    signIn("Supervisor");
    vi.mocked(api.getAttendance).mockResolvedValue({
      ...day,
      rows: [{ ...day.rows[0], record: record("Present", "Approved") }, day.rows[1]],
    });
    const user = await loaded();
    const first = card("Ahmed Khan");

    expect(within(first).queryByRole("button", { name: /^Present:/ })).not.toBeInTheDocument();
    expect(within(first).queryByRole("button", { name: /Absent, leave or overtime/ })).not.toBeInTheDocument();
    await user.click(within(first).getByRole("button", { name: "Details for Ahmed Khan" }));
    const sheet = await screen.findByRole("dialog", { name: "Ahmed Khan" });

    expect(within(sheet).getByText("Approved")).toBeInTheDocument();
    expect(within(sheet).getByText("8.00")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Absent" })).not.toBeInTheDocument();
  });

  describe("Supervisor people list", () => {
    beforeEach(() => signIn("Supervisor"));

    it("shows each person as a row with Present, Absent and Leave controls", async () => {
      await loaded();
      const row = card("Ahmed Khan");

      expect(within(row).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "false");
      expect(within(row).getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "false");
      expect(within(row).getByRole("button", { name: "Leave or overtime" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save day" })).not.toBeInTheDocument();
    });

    it("marks present with one tap, and a second tap clears it", async () => {
      const user = await loaded();
      const present = () => within(card("Ahmed Khan")).getByRole("button", { name: "Present" });

      await user.click(present());
      expect(present()).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save day" })).toBeEnabled();

      await user.click(present());
      expect(present()).toHaveAttribute("aria-pressed", "false");
      expect(screen.queryByRole("button", { name: "Save day" })).not.toBeInTheDocument();
    });

    it("marks everyone unmarked present from the summary, and undoes it", async () => {
      const user = await loaded();

      await user.click(screen.getByRole("button", { name: "Mark 2 present" }));

      expect(within(card("Ahmed Khan")).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
      expect(within(card("Bilal Raza")).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("Marked 2 present")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Undo" }));

      expect(within(card("Bilal Raza")).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "false");
    });

    it("marks only the unmarked ones absent", async () => {
      const user = await loaded();
      await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));

      await user.click(screen.getByRole("button", { name: "Mark 1 absent" }));

      expect(within(card("Bilal Raza")).getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
      expect(within(card("Ahmed Khan")).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByRole("button", { name: /^Mark \d+ (present|absent)/ })).not.toBeInTheDocument();
    });

    it("records leave from the sheet and closes it", async () => {
      const user = await loaded();

      await user.click(within(card("Bilal Raza")).getByRole("button", { name: "Leave or overtime" }));
      const sheet = await screen.findByRole("dialog", { name: "Bilal Raza" });
      await user.click(within(sheet).getByRole("button", { name: "Sick Leave" }));

      expect(within(card("Bilal Raza")).getByText("Sick Leave")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Bilal Raza" })).not.toBeInTheDocument();
    });

    it("sets overtime for a present worker from the row's sheet", async () => {
      const user = await loaded();
      await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));

      await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Details for Ahmed Khan" }));
      await user.click(await screen.findByRole("button", { name: "Increase overtime hours for Ahmed Khan" }));
      await user.click(screen.getByRole("button", { name: "Increase overtime hours for Ahmed Khan" }));

      expect(screen.getByLabelText("Overtime hours for Ahmed Khan")).toHaveValue(1);
    });
  });

  it("locks every card when the month is finalised", async () => {
    vi.mocked(api.getAttendance).mockResolvedValue({ ...day, isFinalised: true });
    await loaded();

    expect(screen.getByText("This month is finalised. Attendance is locked.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Present" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save day" })).not.toBeInTheDocument();
  });

  describe("day strip", () => {
    const shift = (value: string, days: number) => {
      const date = new Date(`${value}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const label = (value: string) =>
      new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
        new Date(`${value}T00:00:00Z`),
      );

    it("jumps to an earlier day and back to today, and offers nothing after today", async () => {
      const user = await loaded();
      const input = screen.getByLabelText("Work date") as HTMLInputElement;
      const today = input.value;
      const strip = screen.getByRole("group", { name: "Choose a day" });
      expect(within(strip).getAllByRole("button")).toHaveLength(7);
      expect(within(strip).getByRole("button", { name: `${label(today)}, today` })).toHaveAttribute("aria-pressed", "true");
      expect(within(strip).queryByRole("button", { name: label(shift(today, 1)) })).not.toBeInTheDocument();

      await user.click(within(strip).getByRole("button", { name: label(shift(today, -1)) }));
      await waitFor(() => expect(api.getAttendance).toHaveBeenLastCalledWith(shift(today, -1)));
      expect(input.value).toBe(shift(today, -1));

      await user.click(within(strip).getByRole("button", { name: `${label(today)}, today` }));
      await waitFor(() => expect(api.getAttendance).toHaveBeenLastCalledWith(today));
    });

    it("asks before discarding unsaved edits when choosing another day", async () => {
      const user = await loaded();
      const today = (screen.getByLabelText("Work date") as HTMLInputElement).value;
      await user.click(within(card("Ahmed Khan")).getByRole("button", { name: "Present" }));

      await user.click(screen.getByRole("button", { name: label(shift(today, -1)) }));

      expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    });
  });
});
