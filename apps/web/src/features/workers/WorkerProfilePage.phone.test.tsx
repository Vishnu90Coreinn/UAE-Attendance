import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../api/auth";
import * as leaveApi from "../../api/leave";
import * as workersApi from "../../api/workers";
import type { Worker } from "../../api/workers";
import { useAuth } from "../../contexts/AuthContext";
import { mockViewport, restoreViewport } from "../../test-viewport";
import { WorkerProfilePage } from "./WorkerProfilePage";

vi.mock("../../api/workers");
vi.mock("../../api/leave");
vi.mock("../../api/settings");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const ahmed: Worker = {
  id: 7,
  workerCode: "EMP-007",
  fullName: "Ahmed Khan",
  designation: "Glass Installer",
  hourlyRate: 12.5,
  monthlySalary: 3000,
  overtimeRate: null,
  effectiveOvertimeRate: 15,
  isActive: true,
  department: "Installation",
  workLocation: "Marina Tower",
  phone: "+971 50 123 4567",
  email: "ahmed@example.com",
  nationality: "Pakistani",
  emiratesId: "784-1990-1234567-1",
  passportNumber: "P4231100",
  bankName: "Emirates NBD",
  bankAccountNumber: "0129384756",
  iban: "AE070331234567890123456",
  contractSigned: true,
  badgeIssued: true,
};

function renderAt(role: Role = "Manager", worker: Worker = ahmed) {
  vi.mocked(workersApi.listWorkers).mockResolvedValue([worker]);
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "someone", role }, token: "tok", login: vi.fn(), logout: vi.fn() });
  return {
    user: userEvent.setup(),
    ...render(
      <MemoryRouter initialEntries={["/workers/7"]}>
        <Routes>
          <Route path="/workers" element={<p>directory</p>} />
          <Route path="/workers/:id" element={<WorkerProfilePage />} />
        </Routes>
      </MemoryRouter>,
    ),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockViewport("phone");
  vi.mocked(leaveApi.listLeave).mockResolvedValue([]);
});
afterEach(restoreViewport);

describe("Worker profile on a phone", () => {
  it("leads with who they are and a one-tap Call, then the work and contact details", async () => {
    renderAt();

    expect(await screen.findByRole("heading", { name: "Ahmed Khan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Call Ahmed Khan" })).toHaveAttribute("href", "tel:+971501234567");
    expect(screen.getByRole("link", { name: "All workers" })).toHaveAttribute("href", "/workers");
    const groups = screen.getAllByRole("region").map((g) => g.getAttribute("aria-label"));
    expect(groups.indexOf("Work")).toBeLessThan(groups.indexOf("Personal"));
    expect(screen.getByRole("tablist", { name: "Worker record" })).toBeInTheDocument();
  });

  it("hides the Emirates ID and passport until asked, showing only the last four characters", async () => {
    const { user } = renderAt();
    await screen.findByRole("heading", { name: "Ahmed Khan" });

    expect(screen.queryByText("784-1990-1234567-1")).not.toBeInTheDocument();
    expect(screen.getByText(/•••• 67-1/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show Emirates ID" }));
    expect(screen.getByText("784-1990-1234567-1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide Emirates ID" }));
    expect(screen.queryByText("784-1990-1234567-1")).not.toBeInTheDocument();
  });

  it("shows pay and bank to a Manager with the account numbers hidden", async () => {
    const { user } = renderAt("Manager");
    await screen.findByRole("heading", { name: "Ahmed Khan" });

    await user.click(screen.getByRole("tab", { name: "Pay & bank" }));

    expect(screen.getAllByText("AED 3000.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Emirates NBD")).toBeInTheDocument();
    expect(screen.queryByText("0129384756")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show Account number" }));
    expect(screen.getByText("0129384756")).toBeInTheDocument();
  });

  it("gives a Supervisor the call button but no pay, edit or download", async () => {
    renderAt("Supervisor");
    await screen.findByRole("heading", { name: "Ahmed Khan" });

    expect(screen.getByRole("link", { name: "Call Ahmed Khan" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Pay & bank" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit worker" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("opens the edit form from the Edit button", async () => {
    const { user } = renderAt("Manager");
    await screen.findByRole("heading", { name: "Ahmed Khan" });

    await user.click(screen.getByRole("button", { name: "Edit worker" }));

    expect(await screen.findByRole("dialog", { name: "Edit Worker Profile" })).toBeInTheDocument();
  });

  it("lists the onboarding checklist with Done and To do, not just a count", async () => {
    const { user } = renderAt();
    await screen.findByRole("heading", { name: "Ahmed Khan" });

    await user.click(screen.getByRole("tab", { name: "Onboarding" }));

    expect(screen.getByText("2 of 6 complete")).toBeInTheDocument();
    expect(within(screen.getByText("Contract signed").closest("li")!).getByText("Done")).toBeInTheDocument();
    expect(within(screen.getByText("WPS registered").closest("li")!).getByText("To do")).toBeInTheDocument();
  });

  it("shows leave as cards with the status beside the type, newest first", async () => {
    vi.mocked(leaveApi.listLeave).mockResolvedValue([
      { id: 1, workerId: 7, workerCode: "EMP-007", workerName: "Ahmed Khan", workerIsActive: true, leaveType: "Annual Leave", startDate: "2026-03-01", endDate: "2026-03-04", days: 4, status: "Approved", createdBy: "a", createdUtc: "", decidedBy: "m", decidedUtc: "", hasAttachment: false },
      { id: 2, workerId: 7, workerCode: "EMP-007", workerName: "Ahmed Khan", workerIsActive: true, leaveType: "Sick Leave", startDate: "2026-06-10", endDate: "2026-06-10", days: 1, status: "Pending", createdBy: "a", createdUtc: "", decidedBy: null, decidedUtc: null, hasAttachment: false },
    ]);
    const { user } = renderAt();
    await screen.findByRole("heading", { name: "Ahmed Khan" });

    await user.click(screen.getByRole("tab", { name: "Leave" }));

    expect(await screen.findByText("2 requests · 4 approved days")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"));
    expect(rows).toEqual(["Sick Leave, Pending", "Annual Leave, Approved"]);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
