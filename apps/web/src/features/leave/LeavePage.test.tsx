import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "../../api/leave";
import * as workersApi from "../../api/workers";
import { ApiError } from "../../api/client";
import { LeavePage } from "./LeavePage";
import type { LeaveRequest } from "../../api/leave";
vi.mock("../../api/leave", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/leave")>()),
  listLeave: vi.fn(),
  createLeave: vi.fn(),
  approveLeave: vi.fn(),
  rejectLeave: vi.fn(),
  deleteLeave: vi.fn(),
}));
vi.mock("../../api/workers");
const auth = vi.hoisted(() => ({ role: "Administrator", username: "admin" }));
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { role: auth.role, username: auth.username } }),
}));
const row: LeaveRequest = {
  id: 1,
  workerId: 7,
  workerCode: "EMP-007",
  workerName: "Ahmed Khan",
  workerIsActive: true,
  leaveType: "Annual Leave",
  startDate: "2026-10-21",
  endDate: "2026-10-23",
  days: 3,
  status: "Pending",
  createdBy: "admin",
  createdUtc: "2026-10-20T10:00:00Z",
  decidedBy: null,
  decidedUtc: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  auth.role = "Administrator";
  auth.username = "admin";
  vi.mocked(api.listLeave).mockResolvedValue([row]);
  vi.mocked(workersApi.listWorkers).mockResolvedValue([
    {
      id: 7,
      workerCode: "EMP-007",
      fullName: "Ahmed Khan",
      designation: "Installer",
      hourlyRate: 12.5,
      overtimeRate: null,
      effectiveOvertimeRate: 2.22,
      isActive: true,
    },
    {
      id: 8,
      workerCode: "EMP-008",
      fullName: "Inactive Worker",
      designation: "Installer",
      hourlyRate: 12.5,
      overtimeRate: null,
      effectiveOvertimeRate: 2.22,
      isActive: false,
    },
  ]);
});
async function setup() {
  const user = userEvent.setup();
  render(<LeavePage />);
  await screen.findByRole("table");
  return user;
}
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "New Leave Request" }));
  return screen.getByRole("dialog", { name: "New Leave Request" });
}
function dates(start = "2026-11-01", end = "2026-11-02") {
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: start },
  });
  fireEvent.change(screen.getByLabelText("End date"), {
    target: { value: end },
  });
}
it("renders the authoritative calendar days and all prototype columns", async () => {
  await setup();
  expect(screen.getByRole("table")).toHaveTextContent("Ahmed Khan");
  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
    [
      "Worker",
      "Leave Type",
      "Start Date",
      "End Date",
      "Days",
      "Status",
      "Actions",
    ],
  );
  expect(
    screen.getByRole("cell", { name: "3" }),
  ).toBeInTheDocument();
});
it("submits active workers only and preserves server-calculated days", async () => {
  vi.mocked(api.createLeave).mockResolvedValue({ ...row, days: 2 });
  const user = await setup();
  const dialog = await openForm(user);
  const worker = within(dialog).getByLabelText("Worker");
  expect(within(worker).queryByText(/Inactive Worker/)).not.toBeInTheDocument();
  await user.selectOptions(worker, "7");
  dates();
  await user.selectOptions(screen.getByLabelText("Leave type"), "Sick Leave");
  await user.click(
    within(dialog).getByRole("button", { name: "Submit request" }),
  );
  expect(api.createLeave).toHaveBeenCalledWith({
    workerId: 7,
    leaveType: "Sick Leave",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
  });
  expect(await screen.findByText("Leave request created.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("rejects reversed dates locally and keeps overlap errors and inputs in the dialog", async () => {
  vi.mocked(api.createLeave).mockRejectedValue(
    new ApiError(409, "This worker already has overlapping leave."),
  );
  const user = await setup();
  const dialog = await openForm(user);
  await user.selectOptions(within(dialog).getByLabelText("Worker"), "7");
  dates("2026-11-02", "2026-11-01");
  await user.click(
    within(dialog).getByRole("button", { name: "Submit request" }),
  );
  expect(
    screen.getByText("End date must be on or after start date."),
  ).toBeInTheDocument();
  expect(api.createLeave).not.toHaveBeenCalled();
  dates();
  await user.click(
    within(dialog).getByRole("button", { name: "Submit request" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "overlapping leave",
  );
  expect(screen.getByLabelText("Start date")).toHaveValue("2026-11-01");
});
it("shows server field errors and does not dismiss while a request is pending", async () => {
  let reject!: (e: unknown) => void;
  vi.mocked(api.createLeave).mockReturnValue(
    new Promise((_, r) => {
      reject = r;
    }),
  );
  const user = await setup();
  const dialog = await openForm(user);
  await user.selectOptions(within(dialog).getByLabelText("Worker"), "7");
  dates();
  await user.click(
    within(dialog).getByRole("button", { name: "Submit request" }),
  );
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(dialog).toBeInTheDocument();
  await act(async () =>
    reject(
      new ApiError(400, "Validation failed", undefined, undefined, {
        workerId: ["Choose an active worker."],
      }),
    ),
  );
  expect(
    await screen.findByText("Choose an active worker."),
  ).toBeInTheDocument();
});
it("approves and rejects requests, refreshing their server state", async () => {
  vi.mocked(api.approveLeave).mockResolvedValue({ ...row, status: "Approved" });
  vi.mocked(api.rejectLeave).mockResolvedValue({ ...row, status: "Rejected" });
  const user = await setup();
  await user.click(screen.getByRole("button", { name: /Approve leave/ }));
  expect(api.approveLeave).toHaveBeenCalledWith(1);
  await screen.findByText("Leave approved.");
  await screen.findByRole("table");
  await user.click(screen.getByRole("button", { name: /Reject leave/ }));
  expect(api.rejectLeave).toHaveBeenCalledWith(1);
  expect(await screen.findByText("Leave rejected.")).toBeInTheDocument();
});
it.each(["Manager", "Administrator"])(
  "%s can delete pending leave only after confirmation",
  async (role) => {
    auth.role = role;
    vi.mocked(api.deleteLeave).mockResolvedValue();
    const user = await setup();
    await user.click(screen.getByRole("button", { name: /Delete leave/ }));
    expect(api.deleteLeave).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(api.deleteLeave).toHaveBeenCalledWith(1);
    expect(
      await screen.findByText("Leave request deleted."),
    ).toBeInTheDocument();
  },
);
it.each(["Manager", "Administrator"])(
  "%s can delete decided leave of anyone and change a decision",
  async (role) => {
    auth.role = role;
    auth.username = "boss";
    vi.mocked(api.listLeave).mockResolvedValue([
      { ...row, status: "Approved", createdBy: "someone.else" },
    ]);
    await setup();
    expect(
      screen.getByRole("button", { name: /Delete leave/ }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: /Reject leave/ })).toBeEnabled();
  },
);
it("a Supervisor can request leave but never sees Approve or Reject", async () => {
  auth.role = "Supervisor";
  auth.username = "sup.omar";
  const user = await setup();
  expect(
    screen.getByRole("button", { name: "New Leave Request" }),
  ).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: /Approve|Reject/ }),
  ).not.toBeInTheDocument();
  await openForm(user);
});
it("a Supervisor can delete their own pending request, after confirmation", async () => {
  auth.role = "Supervisor";
  auth.username = "sup.omar";
  vi.mocked(api.listLeave).mockResolvedValue([{ ...row, createdBy: "sup.omar" }]);
  vi.mocked(api.deleteLeave).mockResolvedValue();
  const user = await setup();
  expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Delete leave/ }));
  expect(api.deleteLeave).not.toHaveBeenCalled();
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }),
  );
  expect(api.deleteLeave).toHaveBeenCalledWith(1);
});
it.each([
  ["someone else's pending request", { createdBy: "other.user", status: "Pending" as const }],
  ["their own decided request", { createdBy: "sup.omar", status: "Approved" as const }],
])("a Supervisor gets no delete button on %s", async (_name, patch) => {
  auth.role = "Supervisor";
  auth.username = "sup.omar";
  vi.mocked(api.listLeave).mockResolvedValue([{ ...row, ...patch }]);
  await setup();
  expect(
    screen.queryByRole("button", { name: /Delete leave|Approve|Reject/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
});
it("a Supervisor can still filter and read", async () => {
  auth.role = "Supervisor";
  auth.username = "sup.omar";
  const user = await setup();
  await user.selectOptions(
    screen.getByLabelText("Filter by status"),
    "Approved",
  );
  await screen.findByRole("table");
  await user.selectOptions(screen.getByLabelText("Filter by worker"), "7");
  expect(api.listLeave).toHaveBeenLastCalledWith({
    status: "Approved",
    workerId: 7,
  });
});
it("offers retry and an empty state without repeating the worker lookup", async () => {
  vi.mocked(api.listLeave)
    .mockRejectedValueOnce(new ApiError(0, "Unable to reach the server."))
    .mockResolvedValue([]);
  const user = userEvent.setup();
  render(<LeavePage />);
  await screen.findByText("Unable to reach the server.");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByText("No leave requests match these filters."),
  ).toBeInTheDocument();
  expect(workersApi.listWorkers).toHaveBeenCalledTimes(1);
});
it("ignores a stale filter response", async () => {
  let resolve!: (r: LeaveRequest[]) => void;
  vi.mocked(api.listLeave)
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValue([]);
  render(<LeavePage />);
  fireEvent.change(screen.getByLabelText("Filter by status"), {
    target: { value: "Rejected" },
  });
  await screen.findByText("No leave requests match these filters.");
  await act(async () => resolve([row]));
  expect(screen.queryByText("Ahmed Khan")).not.toBeInTheDocument();
});
it("reports a conflicting decision and reloads the authoritative list", async () => {
  vi.mocked(api.approveLeave).mockRejectedValue(
    new ApiError(409, "Leave overlaps another request."),
  );
  const user = await setup();
  await user.click(screen.getByRole("button", { name: /Approve leave/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Leave overlaps another request.",
  );
  expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(api.listLeave).toHaveBeenCalledTimes(2);
});
