import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/leave";
import type { LeaveRequest } from "../../api/leave";
import * as workersApi from "../../api/workers";
import { mockViewport, restoreViewport } from "../../test-viewport";
import { LeavePage } from "./LeavePage";
import { formatRange } from "./LeavePhone";

vi.mock("../../api/leave", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/leave")>()),
  listLeave: vi.fn(),
  createLeave: vi.fn(),
  approveLeave: vi.fn(),
  rejectLeave: vi.fn(),
  deleteLeave: vi.fn(),
  getLeaveBalances: vi.fn(),
  getLeaveExport: vi.fn(),
}));
vi.mock("../../api/workers");
const auth = vi.hoisted(() => ({ role: "Manager", username: "boss" }));
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { role: auth.role, username: auth.username } }),
}));

function leave(id: number, extra: Partial<LeaveRequest>): LeaveRequest {
  return {
    id,
    workerId: 7,
    workerCode: "EMP-007",
    workerName: "Ahmed Khan",
    workerIsActive: true,
    leaveType: "Annual Leave",
    startDate: "2026-10-21",
    endDate: "2026-10-23",
    days: 3,
    status: "Pending",
    createdBy: "sup.omar",
    createdUtc: "2026-10-20T10:00:00Z",
    decidedBy: null,
    decidedUtc: null,
    hasAttachment: false,
    ...extra,
  };
}
const rows = [
  leave(1, {}),
  leave(2, { workerId: 8, workerCode: "EMP-008", workerName: "Bilal Raza", leaveType: "Sick Leave", startDate: "2026-10-05", endDate: "2026-10-05", days: 1, status: "Approved", decidedBy: "boss", hasAttachment: true }),
  leave(3, { workerId: 8, workerCode: "EMP-008", workerName: "Bilal Raza", startDate: "2026-09-01", endDate: "2026-09-02", days: 2, status: "Rejected", decidedBy: "boss" }),
];

beforeEach(() => {
  vi.resetAllMocks();
  mockViewport("phone");
  auth.role = "Manager";
  auth.username = "boss";
  vi.mocked(api.listLeave).mockResolvedValue(rows);
  vi.mocked(api.getLeaveBalances).mockResolvedValue([]);
  vi.mocked(workersApi.listWorkers).mockResolvedValue([
    { id: 7, workerCode: "EMP-007", fullName: "Ahmed Khan", designation: "Installer", hourlyRate: null, overtimeRate: null, effectiveOvertimeRate: null, isActive: true },
    { id: 8, workerCode: "EMP-008", fullName: "Bilal Raza", designation: "Fabricator", hourlyRate: null, overtimeRate: null, effectiveOvertimeRate: null, isActive: true },
  ]);
});
afterEach(restoreViewport);

async function loaded() {
  const user = userEvent.setup();
  render(<LeavePage />);
  await screen.findByRole("list", { name: /Needs your decision|Waiting for approval|Requests/ });
  return user;
}

describe("formatRange", () => {
  it("says dates the way people do", () => {
    const year = new Date().getUTCFullYear();
    expect(formatRange(`${year}-11-24`, `${year}-11-24`)).toBe("24 Nov");
    expect(formatRange(`${year}-11-25`, `${year}-11-28`)).toBe("25–28 Nov");
    expect(formatRange(`${year}-11-28`, `${year}-12-02`)).toBe("28 Nov – 2 Dec");
    expect(formatRange("2025-12-30", "2026-01-02")).toMatch(/30 Dec 2025 – 2 Jan/);
  });
});

describe("Leave on a phone", () => {
  it("puts what is waiting for a decision first, in its own group", async () => {
    await loaded();

    expect(screen.getByRole("list", { name: "Needs your decision · 1" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Decided" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const pending = screen.getByRole("listitem", { name: "Ahmed Khan, Annual Leave" });
    expect(within(pending).getByText("Pending")).toBeInTheDocument();
    expect(within(pending).getByText(/3 days/)).toBeInTheDocument();
    expect(within(pending).getByText(/Requested by sup\.omar/)).toBeInTheDocument();
  });

  it("lets a Manager approve or reject a pending request from its card", async () => {
    vi.mocked(api.approveLeave).mockResolvedValue(undefined as never);
    const user = await loaded();

    await user.click(screen.getByRole("button", { name: /^Approve leave for Ahmed Khan/ }));

    expect(api.approveLeave).toHaveBeenCalledWith(1);
    expect(await screen.findByText("Leave approved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Reject leave for Ahmed Khan/ })).toBeInTheDocument();
  });

  it("tells a Supervisor what the request is waiting for and gives no decision buttons", async () => {
    auth.role = "Supervisor";
    auth.username = "sup.omar";
    await loaded();

    expect(screen.getByRole("list", { name: "Waiting for approval · 1" })).toBeInTheDocument();
    expect(screen.getByText(/Waiting for a manager's decision/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve leave/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reject leave/ })).not.toBeInTheDocument();
  });

  it("lets a Supervisor delete their own pending request only", async () => {
    auth.role = "Supervisor";
    auth.username = "sup.omar";
    await loaded();

    expect(screen.getByRole("button", { name: "More actions for Ahmed Khan starting 2026-10-21" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^More actions for Bilal Raza/ })).not.toBeInTheDocument();
  });

  it("narrows the list with the status chips and keeps every count", async () => {
    const user = await loaded();
    expect(screen.getByRole("button", { name: /^All 3/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Approved/ }));

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem", { name: "Bilal Raza, Sick Leave" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Pending 1/ })).toBeInTheDocument();
    expect(api.listLeave).toHaveBeenCalledTimes(1);
  });

  it("offers the attached note as a button on the request", async () => {
    await loaded();

    const approved = screen.getByRole("listitem", { name: "Bilal Raza, Sick Leave" });
    expect(within(approved).getByRole("button", { name: /^View photo for Bilal Raza/ })).toBeInTheDocument();
  });

  it("opens the monthly report from the header menu", async () => {
    const user = await loaded();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Monthly report" }));

    const sheet = await screen.findByRole("dialog", { name: "Monthly leave report" });
    expect(within(sheet).getByRole("button", { name: "Print PDF" })).toBeInTheDocument();
    expect(within(sheet).getByText(/for all workers/)).toBeInTheDocument();
  });

  it("hides the New request button from HR", async () => {
    auth.role = "HR";
    await loaded();

    expect(screen.queryByRole("button", { name: "New request" })).not.toBeInTheDocument();
  });

  describe("the New request sheet", () => {
    async function openSheet() {
      const user = await loaded();
      await waitFor(() => expect(screen.getByRole("button", { name: "New request" })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: "New request" }));
      const sheet = await screen.findByRole("dialog", { name: "New Leave Request" });
      return { user, sheet };
    }

    it("finds a worker by searching, then shows them as a card with Change", async () => {
      const { user, sheet } = await openSheet();

      await user.type(within(sheet).getByLabelText("Search workers"), "bil");
      expect(within(sheet).queryByRole("button", { name: /Ahmed Khan/ })).not.toBeInTheDocument();
      await user.click(within(sheet).getByRole("button", { name: /Bilal Raza/ }));

      expect(within(sheet).getByText("EMP-008")).toBeInTheDocument();
      await user.click(within(sheet).getByRole("button", { name: "Change worker" }));
      expect(within(sheet).getByLabelText("Search workers")).toBeInTheDocument();
    });

    it("counts the days live and keeps the end date from falling before the start", async () => {
      const { user, sheet } = await openSheet();
      const start = within(sheet).getByLabelText("Start date");
      const end = within(sheet).getByLabelText("End date");

      await user.clear(start);
      await user.type(start, "2026-11-24");
      await user.clear(end);
      await user.type(end, "2026-11-27");
      expect(within(sheet).getByText("4 days")).toBeInTheDocument();

      await user.clear(start);
      await user.type(start, "2026-12-01");
      expect(end).toHaveValue("2026-12-01");
      expect(within(sheet).getByText("1 day")).toBeInTheDocument();
    });

    it("asks for the doctor's note only on sick leave", async () => {
      const { user, sheet } = await openSheet();
      expect(within(sheet).queryByText(/Doctor's note/)).not.toBeInTheDocument();

      await user.click(within(sheet).getByRole("button", { name: "Sick Leave" }));
      expect(within(sheet).getByText(/Doctor's note/)).toBeInTheDocument();
      expect(within(sheet).getByText("Take photo")).toBeInTheDocument();

      await user.click(within(sheet).getByRole("button", { name: "Annual Leave" }));
      expect(within(sheet).queryByText(/Doctor's note/)).not.toBeInTheDocument();
    });

    it("refuses to submit without a worker, then sends the request and confirms with a toast", async () => {
      vi.mocked(api.createLeave).mockResolvedValue(undefined as never);
      const { user, sheet } = await openSheet();

      await user.click(within(sheet).getByRole("button", { name: "Submit request" }));
      expect(within(sheet).getByText("Choose a worker.")).toBeInTheDocument();
      expect(api.createLeave).not.toHaveBeenCalled();

      await user.click(within(sheet).getByRole("button", { name: /Ahmed Khan/ }));
      await user.click(within(sheet).getByRole("button", { name: "Emergency Leave" }));
      await user.click(within(sheet).getByRole("button", { name: "Submit request" }));

      await waitFor(() => expect(api.createLeave).toHaveBeenCalled());
      expect(vi.mocked(api.createLeave).mock.calls[0][0]).toMatchObject({ workerId: 7, leaveType: "Emergency Leave" });
      expect(await screen.findByText("Leave request created.")).toBeInTheDocument();
    });
  });
});
