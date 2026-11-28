import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
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

/** The dashboard with only the parts a test cares about changed. */
function setupWith({ trend, staff = {}, leave = [], invoices = [], lines = [] }: { trend: unknown; staff?: object; leave?: unknown[]; invoices?: unknown[]; lines?: unknown[] }) {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "boss", role: "Manager" }, token: "t", login: vi.fn(), logout: vi.fn() });
  vi.mocked(data.useDashboardData).mockReturnValue({
    trend: { status: "ready", value: trend },
    waiting: { status: "ready", value: { submitted: [], rejected: [], submittedTotal: 0, rejectedTotal: 0 } },
    leave: { status: "ready", value: leave },
    staff: { status: "ready", value: { date: "2026-11-22", dayType: null, total: 4, signedIn: 3, late: 1, absent: 0, outsideOffice: 0, missingSignOut: 0, onLeave: 0, notInYet: 1, attention: [], ...staff } },
    staffLeave: { status: "ready", value: [] },
    invoices: { status: "ready", value: invoices },
    payroll: { status: "ready", value: { period: "2026-11", status: "Draft", totals: { netPay: 0, basicPay: 0, overtimePay: 0, totalDeductions: 0 }, lines } },
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

describe("DashboardPage, today and what waits", () => {
  const marked = empty.map((d, i) => (i === 6 ? { ...d, present: 5, notRecorded: 0 } : d));

  it("says attendance is not marked yet instead of showing 0%", () => {
    setupWith({ staff: { signedIn: 0 }, trend: marked.map((d, i) => (i === 6 ? empty[6] : { ...d, present: 3, notRecorded: 2 })) });
    expect(screen.getByText("Attendance not marked yet")).toBeInTheDocument();
    expect(screen.getByText(/Attendance isn't marked yet today/)).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "D6 2026-11-07: not recorded" })).toBeInTheDocument();
  });

  it("switches the quick action off once everybody is marked", () => {
    setupWith({ trend: marked });
    expect(screen.getByRole("button", { name: "Attendance marked" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Mark attendance" })).not.toBeInTheDocument();
  });

  it("lists what waits oldest first and tags the late ones", () => {
    const request = (id: number, name: string, createdUtc: string, startDate: string, endDate: string) => ({ id, workerName: name, leaveType: "Sick Leave", startDate, endDate, days: 2, createdUtc });
    setupWith({ trend: marked, leave: [request(1, "Newer", "2999-01-01T00:00:00Z", "2999-12-14", "2999-12-15"), request(2, "Older", "2020-01-01T00:00:00Z", "2020-01-14", "2020-01-15")] });
    const rows = screen.getAllByRole("link").filter((l) => /Newer|Older/.test(l.textContent ?? ""));
    expect(rows[0]).toHaveTextContent("Older");
    expect(rows[0]).toHaveTextContent("Overdue");
    expect(rows[0]).toHaveTextContent("14–15 Jan · 2 days");
    expect(rows[1]).not.toHaveTextContent("Overdue");
  });

  it("keeps pay by name hidden until asked, and splits what is owed by lateness", async () => {
    const user = userEvent.setup();
    setupWith({
      trend: marked,
      lines: [{ workerName: "Top Earner", netPay: 9000 }],
      invoices: [{ id: 1, number: "INV-1", status: "Issued", displayStatus: "Issued", isOverdue: true, clientName: "C", project: "", lpoRef: "", invoiceDate: "2020-01-01", dueDate: "2020-02-01", total: 1000, amountPaid: 0, balanceDue: 1000 }],
    });
    expect(screen.queryByText("Top Earner")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show highest net pay" }));
    expect(screen.getByText("Top Earner")).toBeInTheDocument();
    expect(screen.getByText("Over 30 days late").nextSibling).toHaveTextContent("1,000.00");
  });
});
