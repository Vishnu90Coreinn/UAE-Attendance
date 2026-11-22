import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../api/auth";
import { useAuth } from "../../contexts/AuthContext";
import { DashboardPage } from "./DashboardPage";
import * as data from "./useDashboardData";

vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("./useDashboardData");

const empty = Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, label: `D${i}`, present: 0, absent: 0, onLeave: 0, notRecorded: 5, total: 5 }));

function setup(role: Role, trend: unknown = empty, invoices: unknown[] = []) {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "boss", role }, token: "t", login: vi.fn(), logout: vi.fn() });
  vi.mocked(data.useDashboardData).mockReturnValue({
    trend: { status: "ready", value: trend },
    waiting: { status: "ready", value: { submitted: [], rejected: [], submittedTotal: 0, rejectedTotal: 0 } },
    leave: { status: "ready", value: [] },
    staff: { status: "ready", value: { date: "2026-11-22", dayType: null, total: 4, signedIn: 3, late: 1, absent: 0, outsideOffice: 0, missingSignOut: 0, onLeave: 0, notInYet: 1, attention: [] } },
    staffLeave: { status: "ready", value: [] },
    invoices: { status: "ready", value: invoices },
    payroll: { status: "ready", value: { period: "2026-11", status: "Draft", totals: { netPay: 0, basicPay: 0, overtimePay: 0, totalDeductions: 0 }, lines: [] } },
  } as never);
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.resetAllMocks());

describe("DashboardPage", () => {
  it("puts what needs attention first, with quick actions beside it", () => {
    setup("Manager");
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf("Needs your attention")).toBeLessThan(headings.indexOf("Payroll this month (AED)") === -1 ? 99 : headings.indexOf("Payroll this month (AED)"));
    expect(screen.getByRole("link", { name: "Mark attendance" })).toHaveAttribute("href", "/attendance");
    expect(screen.getByRole("link", { name: "Add worker" })).toHaveAttribute("href", "/workers?new=1");
    expect(screen.getByRole("link", { name: "New invoice" })).toHaveAttribute("href", "/invoices?new=1");
    expect(screen.getByRole("link", { name: "New leave" })).toHaveAttribute("href", "/leave?new=1");
  });

  it("shows the office staff alongside the site workers", () => {
    setup("Manager");
    expect(screen.getByRole("heading", { name: "Office today" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /On the job today/ })).toHaveAttribute("href", "/attendance");
    expect(screen.getByText(/3 of 4 office employees signed in/)).toBeInTheDocument();
  });

  it("totals the tax invoices: billed this month, outstanding and overdue", () => {
    setup("Manager", empty, [
      { id: 1, number: "INV-1", status: "Issued", displayStatus: "Issued", isOverdue: true, clientName: "Marina Towers", project: "", lpoRef: "", invoiceDate: "2020-01-01", dueDate: "2020-02-01", total: 1000, amountPaid: 0, balanceDue: 1000 },
      { id: 2, number: "INV-2", status: "Issued", displayStatus: "PartPaid", isOverdue: false, clientName: "Palm Villas", project: "", lpoRef: "", invoiceDate: "2020-01-05", dueDate: "2999-01-01", total: 500, amountPaid: 200, balanceDue: 300 },
    ]);
    expect(screen.getByRole("heading", { name: "Tax invoices" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Invoices outstanding/ })).toHaveAttribute("href", "/invoices");
    expect(screen.getAllByText("1,300.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/1 overdue · AED 1,000.00/)).toBeInTheDocument();
    expect(screen.getByText(/INV-1/)).toBeInTheDocument();
  });

  it("replaces the empty chart row with a one-line prompt", () => {
    setup("Manager");
    expect(screen.getByText("No attendance recorded in the last 7 days.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Record attendance/ })).toHaveAttribute("href", "/attendance");
    expect(screen.queryByText("Attendance, last 7 days")).not.toBeInTheDocument();
  });

  it("offers a Viewer no actions", () => {
    setup("Viewer");
    expect(screen.queryByText("Quick actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Record attendance/ })).not.toBeInTheDocument();
  });

  it("offers HR only what HR may do", () => {
    setup("HR");
    expect(screen.queryByRole("link", { name: "Add worker" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New invoice" })).not.toBeInTheDocument();
  });
});
