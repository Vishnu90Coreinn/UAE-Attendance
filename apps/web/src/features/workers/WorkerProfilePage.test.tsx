import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../api/auth";
import * as leaveApi from "../../api/leave";
import * as workersApi from "../../api/workers";
import type { Worker } from "../../api/workers";
import { useAuth } from "../../contexts/AuthContext";
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
  emiratesId: "784-1990-1234567-1",
  bankName: "Emirates NBD",
  contractSigned: true,
  badgeIssued: true,
};

function signInAs(role: Role) {
  vi.mocked(useAuth).mockReturnValue({
    status: "signedIn",
    user: { id: 1, username: "someone", role },
    token: "tok",
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function renderAt(path: string, role: Role = "Manager") {
  signInAs(role);
  return {
    user: userEvent.setup(),
    ...render(
      <MemoryRouter initialEntries={[path]}>
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
  vi.mocked(workersApi.listWorkers).mockResolvedValue([ahmed]);
  vi.mocked(leaveApi.listLeave).mockResolvedValue([]);
});

describe("WorkerProfilePage", () => {
  it("shows the worker's details on the overview tab", async () => {
    renderAt("/workers/7");
    expect(await screen.findByRole("heading", { name: "Ahmed Khan" })).toBeInTheDocument();
    expect(screen.getByText("EMP-007")).toBeInTheDocument();
    expect(screen.getByText("784-1990-1234567-1")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows pay and bank to people who may see pay", async () => {
    const { user } = renderAt("/workers/7");
    await user.click(await screen.findByRole("tab", { name: "Pay & bank" }));
    expect(screen.getByText("AED 3000.00")).toBeInTheDocument();
    expect(screen.getByText("Emirates NBD")).toBeInTheDocument();
  });

  it("hides the pay tab from a Supervisor", async () => {
    renderAt("/workers/7", "Supervisor");
    await screen.findByRole("heading", { name: "Ahmed Khan" });
    expect(screen.queryByRole("tab", { name: "Pay & bank" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit worker" })).not.toBeInTheDocument();
  });

  it("lets a Viewer look but not edit", async () => {
    renderAt("/workers/7", "Viewer");
    await screen.findByRole("heading", { name: "Ahmed Khan" });
    expect(screen.getByRole("tab", { name: "Pay & bank" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit worker" })).not.toBeInTheDocument();
  });

  it("counts the onboarding checklist", async () => {
    const { user } = renderAt("/workers/7");
    await user.click(await screen.findByRole("tab", { name: "Onboarding" }));
    expect(screen.getByText("2 of 6 complete")).toBeInTheDocument();
    expect(screen.getByText("Contract signed")).toBeInTheDocument();
  });

  it("loads this worker's leave on the leave tab", async () => {
    const { user } = renderAt("/workers/7");
    await user.click(await screen.findByRole("tab", { name: "Leave" }));
    expect(await screen.findByText("No leave recorded for this worker.")).toBeInTheDocument();
    expect(leaveApi.listLeave).toHaveBeenCalledWith({ workerId: 7 });
  });

  it("says so when the worker does not exist", async () => {
    renderAt("/workers/99");
    expect(await screen.findByRole("alert")).toHaveTextContent("This worker could not be found.");
    expect(screen.getByRole("link", { name: "All workers" })).toHaveAttribute("href", "/workers");
  });
});
