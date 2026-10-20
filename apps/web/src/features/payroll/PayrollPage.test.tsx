import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "../../api/payroll";
import { ApiError } from "../../api/client";
import type { PayrollReport } from "../../api/payroll";
import { PayrollPage } from "./PayrollPage";

vi.mock("../../api/payroll");
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
      daysWorked: 22,
      basicHours: 176,
      overtimeHours: 10,
      basicPay: 2200,
      overtimePay: 22.2,
      totalPay: 2222.2,
    },
  ],
  totals: {
    daysWorked: 22,
    basicHours: 176,
    overtimeHours: 10,
    basicPay: 2200,
    overtimePay: 22.2,
    totalPay: 2222.2,
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getPayroll).mockResolvedValue(report);
  vi.mocked(api.getPayrollPdf).mockResolvedValue(
    new Blob(["%PDF-1.7"], { type: "application/pdf" }),
  );
  vi.spyOn(window, "print").mockImplementation(() => {});
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
it("shows loading and prevents print/export until ready", () => {
  vi.mocked(api.getPayroll).mockReturnValue(new Promise(() => {}));
  render(<PayrollPage />);
  expect(screen.getByText("Loading payroll...")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();
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
it("prints the same displayed report", async () => {
  const user = await loaded();
  await user.click(screen.getByRole("button", { name: "Print" }));
  expect(window.print).toHaveBeenCalledOnce();
  expect(screen.getAllByText("2,222.20")).toHaveLength(2);
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
  expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();
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
    },
  });
  await loaded();
  expect(screen.getByText("No workers for this month.")).toBeInTheDocument();
  expect(screen.getAllByText("0.00")).toHaveLength(3);
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
