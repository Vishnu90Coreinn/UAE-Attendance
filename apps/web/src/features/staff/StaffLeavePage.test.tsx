import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as staffApi from "../../api/staff";
import type { StaffLeave } from "../../api/staff";
import { useAuth } from "../../contexts/AuthContext";
import { StaffLeavePage } from "./StaffLeavePage";
import { leaveDates, leaveDay } from "./leaveFormat";

vi.mock("../../api/staff");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const year = new Date().getFullYear();
const request = (overrides: Partial<StaffLeave> = {}): StaffLeave => ({
  id: 1, workerId: 1, code: "OFF-1", name: "Fatima Khan", department: "HR", leaveTypeId: 2, leaveType: "Sick Leave",
  startDate: `${year}-12-14`, endDate: `${year}-12-15`, days: 2, reason: "Fever", status: "Pending", createdBy: "fatima",
  createdUtc: `${year}-11-20T08:00:00Z`, decidedBy: null, decidedUtc: null, decisionNote: null, hasAttachment: false, ...overrides,
});
const balance = { leaveTypeId: 2, leaveType: "Sick Leave", entitlement: 15, used: 13, pending: 2, remaining: 2 };

function setup(role: "Manager" | "HR", requests: StaffLeave[]) {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "u", role }, token: "t", login: vi.fn(), logout: vi.fn() });
  vi.mocked(staffApi.listStaffLeave).mockResolvedValue(requests);
  vi.mocked(staffApi.getLeaveBalances).mockResolvedValue([{ workerId: 1, code: "OFF-1", name: "Fatima Khan", department: "HR", balances: [balance] }]);
  vi.mocked(staffApi.listLeaveTypes).mockResolvedValue([{ id: 2, name: "Sick Leave", yearlyDays: 15, isActive: true, requiresDocument: true }]);
  render(<MemoryRouter><StaffLeavePage /></MemoryRouter>);
}

beforeEach(() => vi.resetAllMocks());

describe("leave dates", () => {
  it("names the weekday and leaves the year out when it is this one", () => {
    expect(leaveDay("2026-11-24", 2026)).toBe("Tue 24 Nov");
    expect(leaveDates("2026-12-14", "2026-12-15", 2026)).toBe("Mon 14 – Tue 15 Dec");
    expect(leaveDates("2026-11-30", "2026-12-02", 2026)).toBe("Mon 30 Nov – Wed 2 Dec");
    expect(leaveDay("2027-01-04", 2026)).toBe("Mon 4 Jan 2027");
  });
});

describe("StaffLeavePage", () => {
  it("shows what a decision turns on, and keeps the pending request out of the list", async () => {
    setup("Manager", [request(), request({ id: 2, workerId: 2, name: "Sara Ali", status: "Approved", decidedBy: "boss", decidedUtc: `${year}-11-01T00:00:00Z` })]);
    const card = await screen.findByRole("listitem", { name: "Fatima Khan, Sick Leave" });

    expect(card).toHaveTextContent(`Sick Leave left in ${year}: 2 → 0 days after approval`);
    expect(card).toHaveTextContent("Also away in HR: Sara Ali");
    expect(card).toHaveTextContent("Document missing");
    expect(within(screen.getByRole("table")).queryByText("Fatima Khan")).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText(/boss ·/)).toBeInTheDocument();
  });

  it("rejects only with a reason of at least three characters", async () => {
    vi.mocked(staffApi.rejectStaffLeave).mockResolvedValue(request({ status: "Rejected" }));
    const user = userEvent.setup();
    setup("Manager", [request()]);
    vi.mocked(staffApi.rejectStaffLeave).mockResolvedValue(request({ status: "Rejected" }));
    await user.click(await screen.findByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Reason for rejecting"), "no");
    expect(within(dialog).getByRole("button", { name: "Reject" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Reason for rejecting"), "t now");
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(staffApi.rejectStaffLeave).toHaveBeenCalledWith(1, "not now"));
    expect(await screen.findByText("Fatima Khan: Sick Leave rejected.")).toBeInTheDocument();
  });

  it("filters, counts and resets the list, and exports with the same filters", async () => {
    const user = userEvent.setup();
    setup("HR", [request(), request({ id: 2, name: "Sara Ali", status: "Rejected", decidedBy: "boss", decisionNote: "Too busy" })]);
    vi.mocked(staffApi.getStaffLeaveFile).mockResolvedValue(new Blob());
    expect(await screen.findByText("2 requests")).toBeInTheDocument();
    expect(screen.getByText("Rejected: Too busy")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search employee"), "sara");
    expect(screen.getByText("1 request")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "Excel" }));
    expect(staffApi.getStaffLeaveFile).toHaveBeenCalledWith("excel", year, undefined, expect.objectContaining({ search: "sara" }));
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByText("2 requests")).toBeInTheDocument();
  });

  it("shows used out of total and marks a low balance on its own tab", async () => {
    const user = userEvent.setup();
    setup("Manager", []);
    await user.click(await screen.findByRole("tab", { name: "Balances" }));

    expect(screen.getByText("2 left · low · 2 pending")).toBeInTheDocument();
    expect(screen.getByText("13").closest("td")).toHaveAttribute("data-low", "true");
  });

  it("asks before switching a leave type off, and refuses a duplicate name", async () => {
    const user = userEvent.setup();
    setup("Manager", []);
    vi.mocked(staffApi.updateLeaveType).mockResolvedValue({ id: 2, name: "Sick Leave", yearlyDays: 15, isActive: false, requiresDocument: true });
    await user.click(await screen.findByRole("tab", { name: "Leave types" }));
    expect(screen.getByText("Changes apply to every employee.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("New leave type"), "sick leave");
    await user.type(screen.getByRole("spinbutton", { name: "Days a year" }), "3");
    await user.click(screen.getByRole("button", { name: "Add type" }));
    expect(screen.getByText("A leave type with that name already exists.")).toBeInTheDocument();
    expect(staffApi.addLeaveType).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Switch off" }));
    expect(staffApi.updateLeaveType).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Switch off" }));
    await waitFor(() => expect(staffApi.updateLeaveType).toHaveBeenCalledWith(2, "Sick Leave", 15, false, true));
  });
});
