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

function setup(role: Role, trend: unknown = empty) {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "boss", role }, token: "t", login: vi.fn(), logout: vi.fn() });
  vi.mocked(data.useDashboardData).mockReturnValue({
    trend: { status: "ready", value: trend },
    waiting: { status: "ready", value: { submitted: [], rejected: [], submittedTotal: 0, rejectedTotal: 0 } },
    leave: { status: "ready", value: [] },
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
