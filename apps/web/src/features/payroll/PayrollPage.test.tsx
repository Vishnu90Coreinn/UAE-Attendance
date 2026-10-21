import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "../../api/payroll";
import { ApiError } from "../../api/client";
import type { PayrollReport } from "../../api/payroll";
import { PayrollPage } from "./PayrollPage";

vi.mock("../../api/payroll");
const authRole = vi.hoisted(() => ({ current: "Administrator" }));
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { role: authRole.current } }),
}));
const report: PayrollReport = {
  period: "2026-10",
  status: "Draft",
  revision: "revision-1",
  company: {
    companyName: "Gulf Glass LLC",
    tagline: "Official HR & Payroll System",
    contactEmail: "hr@example.com",
    preparedByLabel: "HR Department",
    approvedByLabel: "General Manager",
  },
  lines: [
    {
      workerId: 1,
      workerCode: "EMP-001",
      workerName: "Ahmed Khan",
      designation: "Glass Installer",
      hourlyRate: 12.5,
      overtimeRate: 2.22,
      deductions: [],
      daysWorked: 22,
      basicHours: 176,
      overtimeHours: 10,
      basicPay: 2200,
      overtimePay: 22.2,
      totalPay: 2222.2,
      totalDeductions: 0,
      netPay: 2222.2,
    },
  ],
  totals: {
    daysWorked: 22,
    basicHours: 176,
    overtimeHours: 10,
    basicPay: 2200,
    overtimePay: 22.2,
    totalPay: 2222.2,
    totalDeductions: 0,
    netPay: 2222.2,
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  authRole.current = "Administrator";
  vi.mocked(api.getPayroll).mockResolvedValue(report);
  vi.mocked(api.getPayrollPdf).mockResolvedValue(
    new Blob(["%PDF-1.7"], { type: "application/pdf" }),
  );
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:payroll"),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function loaded() {
  const user = userEvent.setup();
  render(<PayrollPage />);
  await screen.findByRole("table");
  return user;
}
it("shows loading and prevents export until ready", () => {
  vi.mocked(api.getPayroll).mockReturnValue(new Promise(() => {}));
  render(<PayrollPage />);
  expect(screen.getByText("Loading payroll...")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Export PDF" })).toBeDisabled();
});
it("uses the current UAE month at the UTC month boundary", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T20:30:00Z"));
  try {
    render(<PayrollPage />);
    expect(screen.getByLabelText("Payroll month")).toHaveValue("2026-10");
    expect(api.getPayroll).toHaveBeenCalledWith("2026-10");
    await act(async () => {});
  } finally {
    vi.useRealTimers();
  }
});
it("renders the server's report, exact column labels, totals and signature blocks", async () => {
  await loaded();
  const table = screen.getByRole("table");
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent),
  ).toEqual([
    "Worker Name",
    "Designation",
    "Days Worked",
    "Basic Pay",
    "OT Pay",
    "Deductions",
    "Total Net Salary",
  ]);
  expect(screen.getByText("Gulf Glass LLC")).toBeInTheDocument();
  expect(
    screen.getByText("Email: hr@example.com • United Arab Emirates"),
  ).toBeInTheDocument();
  expect(screen.getByText("Month: 2026-10")).toBeInTheDocument();
  expect(screen.getByText("Draft")).toBeInTheDocument();
  expect(within(table).getAllByText("2,222.20")).toHaveLength(2);
  expect(screen.getByText("TOTAL PAYROLL")).toBeInTheDocument();
  expect(screen.getByText("Prepared By: HR Department")).toBeInTheDocument();
  expect(screen.getByText("Approved By: General Manager")).toBeInTheDocument();
  expect(screen.getByText("Signature & Date")).toBeInTheDocument();
  expect(screen.getByText("Signature & Stamp")).toBeInTheDocument();
});
it("shows the total net payroll in the phone summary as well as the report", async () => {
  await loaded();
  expect(screen.queryByRole("button", { name: "Print" })).not.toBeInTheDocument();
  expect(screen.getAllByText("2,222.20")).toHaveLength(3);
});
it("exports the visible period/revision and names the downloaded file", async () => {
  const user = await loaded();
  await user.click(screen.getByRole("button", { name: "Export PDF" }));
  expect(api.getPayrollPdf).toHaveBeenCalledWith("2026-10", "revision-1");
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock
    .instances[0] as HTMLAnchorElement;
  expect(anchor.download).toBe("Payroll_2026-10.pdf");
  expect(await screen.findByText("PDF downloaded.")).toBeInTheDocument();
});
it("keeps report visible when export fails, and requests reload for a revision conflict", async () => {
  vi.mocked(api.getPayrollPdf).mockRejectedValue(
    new ApiError(409, "Payroll changed. Reload the report before exporting."),
  );
  const user = await loaded();
  await user.click(screen.getByRole("button", { name: "Export PDF" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Payroll changed. Reload the report before exporting.",
  );
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Export PDF" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Reload report" }));
  await screen.findByRole("table");
  expect(api.getPayroll).toHaveBeenCalledTimes(2);
});
it("loads a newly selected month without showing the old report", async () => {
  await loaded();
  vi.mocked(api.getPayroll).mockReturnValue(new Promise(() => {}));
  fireEvent.change(screen.getByLabelText("Payroll month"), {
    target: { value: "2026-09" },
  });
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("Loading payroll...")).toBeInTheDocument();
  expect(api.getPayroll).toHaveBeenLastCalledWith("2026-09");
});
it("ignores a previous month's response arriving late", async () => {
  let resolve!: (value: PayrollReport) => void;
  vi.mocked(api.getPayroll).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(<PayrollPage />);
  fireEvent.change(screen.getByLabelText("Payroll month"), {
    target: { value: "2026-09" },
  });
  await screen.findByRole("table");
  await act(async () => resolve({ ...report, period: "2000-01" }));
  expect(screen.queryByText("Month: 2000-01")).not.toBeInTheDocument();
});
it("offers retry after a loading error", async () => {
  vi.mocked(api.getPayroll).mockRejectedValueOnce(
    new ApiError(0, "Unable to reach the server."),
  );
  const user = userEvent.setup();
  render(<PayrollPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to reach the server.",
  );
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("table")).toBeInTheDocument();
});
it("renders an empty report with zero totals and explanation", async () => {
  vi.mocked(api.getPayroll).mockResolvedValue({
    ...report,
    lines: [],
    totals: {
      daysWorked: 0,
      basicHours: 0,
      overtimeHours: 0,
      basicPay: 0,
      overtimePay: 0,
      totalPay: 0,
      totalDeductions: 0,
      netPay: 0,
    },
  });
  await loaded();
  expect(screen.getByText("No workers for this month.")).toBeInTheDocument();
  expect(screen.getAllByText("0.00")).toHaveLength(5);
});
it("locks month and duplicate export while downloading", async () => {
  let resolve!: (value: Blob) => void;
  vi.mocked(api.getPayrollPdf).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const user = await loaded();
  await user.click(screen.getByRole("button", { name: "Export PDF" }));
  expect(screen.getByRole("button", { name: "Exporting..." })).toBeDisabled();
  expect(screen.getByLabelText("Payroll month")).toBeDisabled();
  await act(async () => resolve(new Blob(["%PDF-"])));
});

const frozen: PayrollReport = {
  ...report,
  status: "Finalised",
  revision: "frozen-1",
  finalisedBy: "payroll.admin",
  finalisedUtc: "2026-10-20T10:15:00Z",
};
it("confirms displayed totals and revision before finalising, then shows frozen metadata", async () => {
  vi.mocked(api.finalisePayroll).mockResolvedValue(frozen);
  const user = await loaded();
  await user.click(screen.getByRole("button", { name: "Finalise month" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("2026-10");
  expect(dialog).toHaveTextContent("2,200.00");
  expect(dialog).toHaveTextContent("22.20");
  expect(dialog).toHaveTextContent("2,222.20");
  expect(dialog).toHaveTextContent(/attendance.*lock/i);
  expect(api.finalisePayroll).not.toHaveBeenCalled();
  await user.click(
    within(dialog).getByRole("button", { name: "Finalise month" }),
  );
  expect(api.finalisePayroll).toHaveBeenCalledWith("2026-10", "revision-1");
  expect(
    await screen.findByText("Payroll month finalised."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("article")).toHaveTextContent(
    /Finalised by payroll.admin on 20 Oct 2026/,
  );
  expect(screen.getByRole("button", { name: "Reopen month" })).toBeEnabled();
});
it("offers Finalise month and Reopen month to a Manager", async () => {
  authRole.current = "Manager";
  await loaded();
  expect(
    screen.getByRole("button", { name: "Finalise month" }),
  ).toBeInTheDocument();
  vi.mocked(api.getPayroll).mockResolvedValue(frozen);
  fireEvent.click(screen.getByRole("button", { name: "Reload report" }));
  await screen.findByText(/Finalised by payroll.admin/);
  expect(
    screen.getByRole("button", { name: "Reopen month" }),
  ).toBeInTheDocument();
});
it.each(["Supervisor"])(
  "keeps finalisation actions unavailable to %s",
  async (role) => {
    authRole.current = role;
    await loaded();
    expect(
      screen.queryByRole("button", { name: "Finalise month" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeEnabled();
    vi.mocked(api.getPayroll).mockResolvedValue(frozen);
    fireEvent.click(screen.getByRole("button", { name: "Reload report" }));
    await screen.findByText(/Finalised by payroll.admin/);
    expect(
      screen.queryByRole("button", { name: "Reopen month" }),
    ).not.toBeInTheDocument();
  },
);
it("requires a nonblank reason to reopen and replaces the frozen report with current draft", async () => {
  vi.mocked(api.getPayroll).mockResolvedValue(frozen);
  vi.mocked(api.reopenPayroll).mockResolvedValue({
    ...report,
    revision: "draft-2",
  });
  const user = await loaded();
  await user.click(screen.getByRole("button", { name: "Reopen month" }));
  const dialog = screen.getByRole("dialog");
  const confirm = within(dialog).getByRole("button", { name: "Reopen month" });
  expect(confirm).toBeDisabled();
  await user.type(screen.getByLabelText("Reason for reopening"), "   ");
  expect(confirm).toBeDisabled();
  await user.type(
    screen.getByLabelText("Reason for reopening"),
    "Correct missed attendance  ",
  );
  await user.click(confirm);
  expect(api.reopenPayroll).toHaveBeenCalledWith(
    "2026-10",
    "Correct missed attendance",
  );
  expect(
    await screen.findByText("Payroll month reopened."),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/Finalised by payroll.admin/),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Finalise month" })).toBeEnabled();
});
it("keeps finalise errors in the dialog and reloads a stale report before retrying", async () => {
  vi.mocked(api.finalisePayroll).mockRejectedValue(
    new ApiError(409, "Payroll changed. Reload the report before finalising."),
  );
  const user = await loaded();
  await user.click(screen.getByRole("button", { name: "Finalise month" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Finalise month",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Payroll changed.",
  );
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByRole("button", { name: "Finalise month" }),
  ).toBeDisabled();
  await user.click(
    within(dialog).getByRole("button", { name: "Reload report" }),
  );
  await screen.findByRole("table");
  expect(api.getPayroll).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("disables conflicting controls and dismissal while finalising", async () => {
  let resolve!: (value: PayrollReport) => void;
  vi.mocked(api.finalisePayroll).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const user = await loaded();
  await user.click(screen.getByRole("button", { name: "Finalise month" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Finalise month",
    }),
  );
  expect(screen.getByLabelText("Payroll month")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Export PDF" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => resolve(frozen));
});
it("prevents finalising a future month", async () => {
  vi.mocked(api.getPayroll).mockResolvedValue({ ...report, period: "9999-12" });
  await loaded();
  expect(screen.getByRole("button", { name: "Finalise month" })).toBeDisabled();
  expect(
    screen.getByText("Future months cannot be finalised."),
  ).toBeInTheDocument();
});
