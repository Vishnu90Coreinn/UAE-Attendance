import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as staffApi from "../../api/staff";
import { mockViewport, restoreViewport } from "../../test-viewport";
import { MyLeavePage } from "./MyLeavePage";

vi.mock("../../api/staff");

function request(over: Partial<staffApi.StaffLeave>): staffApi.StaffLeave {
  return {
    id: 1, workerId: 1, code: "EMP-001", name: "Layla", department: null, leaveTypeId: 1, leaveType: "Annual Leave",
    startDate: "2026-12-01", endDate: "2026-12-03", days: 3, reason: "Family event", status: "Pending", createdBy: "layla",
    createdUtc: "", decidedBy: null, decidedUtc: null, decisionNote: null, hasAttachment: false, ...over,
  } as staffApi.StaffLeave;
}

function data(requests: staffApi.StaffLeave[]): staffApi.StaffMyLeave {
  return {
    balances: [
      { leaveTypeId: 1, leaveType: "Annual Leave", entitlement: 30, used: 0, pending: 3, remaining: 27 },
      { leaveTypeId: 2, leaveType: "Sick Leave", entitlement: 15, used: 0, pending: 0, remaining: 15 },
    ],
    types: [
      { id: 1, name: "Annual Leave", yearlyDays: 30, isActive: true, requiresDocument: false },
      { id: 2, name: "Sick Leave", yearlyDays: 15, isActive: true, requiresDocument: true },
    ],
    requests,
  } as unknown as staffApi.StaffMyLeave;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockViewport("phone");
});
afterEach(restoreViewport);

describe("My Leave on a phone", () => {
  it("shows what is left as tiles and each request with its status in words", async () => {
    vi.mocked(staffApi.getMyLeave).mockResolvedValue(data([request({}), request({ id: 2, status: "Rejected", decidedBy: "Manager", decisionNote: "Busy week" })]));
    render(<MyLeavePage />);

    const tiles = within(await screen.findByRole("list", { name: "Leave balances" })).getAllByRole("listitem");
    expect(tiles).toHaveLength(2);
    expect(screen.getByRole("listitem", { name: "Annual Leave, Pending" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Annual Leave, Rejected" })).toHaveTextContent("Busy week");
  });

  it("sends a request from the sheet once a reason is given", async () => {
    vi.mocked(staffApi.getMyLeave).mockResolvedValue(data([request({})]));
    vi.mocked(staffApi.requestLeave).mockResolvedValue(request({ id: 9 }));
    const user = userEvent.setup();
    render(<MyLeavePage />);

    await user.click(await screen.findByRole("button", { name: "Request leave" }));
    const send = screen.getByRole("button", { name: "Send request" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Reason"), "Wedding");
    expect(send).toBeEnabled();
    await user.click(send);

    expect(staffApi.requestLeave).toHaveBeenCalledWith(expect.objectContaining({ leaveTypeId: 1, reason: "Wedding" }));
    expect(await screen.findByText("Leave request sent to your manager.")).toBeInTheDocument();
  });

  it("asks for a document on sick leave before it can be sent", async () => {
    vi.mocked(staffApi.getMyLeave).mockResolvedValue(data([request({})]));
    const user = userEvent.setup();
    render(<MyLeavePage />);

    await user.click(await screen.findByRole("button", { name: "Request leave" }));
    await user.click(screen.getByRole("button", { name: /Sick Leave/ }));
    await user.type(screen.getByLabelText("Reason"), "Fever");

    expect(screen.getByText(/Sick Leave: document/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send request" })).toBeDisabled();
  });

  it("confirms before cancelling a pending request", async () => {
    vi.mocked(staffApi.getMyLeave).mockResolvedValue(data([request({})]));
    vi.mocked(staffApi.cancelMyLeave).mockResolvedValue(request({ status: "Cancelled" }));
    const user = userEvent.setup();
    render(<MyLeavePage />);

    await user.click(await screen.findByRole("button", { name: "Cancel request" }));
    expect(staffApi.cancelMyLeave).not.toHaveBeenCalled();
    const sheet = screen.getByRole("dialog", { name: "Cancel this request?" });
    await user.click(within(sheet).getByRole("button", { name: "Cancel request" }));

    expect(staffApi.cancelMyLeave).toHaveBeenCalledWith(1);
  });

  it("invites the first request when there are none", async () => {
    vi.mocked(staffApi.getMyLeave).mockResolvedValue(data([]));
    render(<MyLeavePage />);

    expect(await screen.findByText("No leave requested yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Request leave" })).toHaveLength(1);
  });
});
