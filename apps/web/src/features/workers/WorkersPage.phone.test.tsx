import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../api/auth";
import * as settingsApi from "../../api/settings";
import * as workersApi from "../../api/workers";
import type { Worker } from "../../api/workers";
import { useAuth } from "../../contexts/AuthContext";
import { mockViewport, restoreViewport } from "../../test-viewport";
import { WorkersPage } from "./WorkersPage";

vi.mock("../../api/workers");
vi.mock("../../api/settings");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

function worker(id: number, fullName: string, extra: Partial<Worker> = {}): Worker {
  return {
    id,
    workerCode: `EMP-00${id}`,
    fullName,
    designation: "Installer",
    hourlyRate: null,
    monthlySalary: null,
    overtimeRate: null,
    effectiveOvertimeRate: null,
    isActive: true,
    ...extra,
  };
}
const workers = [
  worker(1, "Zaid Ali", { phone: "+971 50 111 2222", emiratesId: "784-1990-1234567-1" }),
  worker(2, "Ahmed Khan", { designation: "Fabricator", department: "Installation", workLocation: "Marina Tower" }),
  worker(3, "Sara Accountant", { category: "Employee", designation: "Accountant" }),
];

function signInAs(role: Role) {
  vi.mocked(useAuth).mockReturnValue({
    status: "signedIn",
    user: { id: 1, username: "someone", role },
    token: "tok",
    login: vi.fn(),
    logout: vi.fn(),
  });
}

async function renderLoaded(role: Role = "Supervisor") {
  signInAs(role);
  vi.mocked(workersApi.listWorkers).mockResolvedValue(workers);
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <WorkersPage />
    </MemoryRouter>,
  );
  await screen.findByRole("list", { name: "Workers" });
  return user;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockViewport("phone");
  vi.mocked(workersApi.getNextWorkerCode).mockResolvedValue("EMP-005");
  vi.mocked(settingsApi.getPayrollSettings).mockResolvedValue({
    companyName: "Company",
    tagline: "",
    contactEmail: "hr@example.com",
    overtimeRatePerHour: 2.22,
    maxBasicHoursPerDay: 8,
    shiftDescription: "06:00 AM - 05:30 PM",
    preparedByLabel: "HR Department",
    approvedByLabel: "General Manager",
  });
});

afterEach(restoreViewport);

describe("Workers on a phone", () => {
  it("lists people alphabetically as rows instead of a table or stat cards", async () => {
    await renderLoaded();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("Total workers")).not.toBeInTheDocument();
    expect(screen.getByText("3 people")).toBeInTheDocument();
    const names = screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"));
    expect(names).toEqual(["Ahmed Khan", "Sara Accountant", "Zaid Ali"]);
  });

  it("opens a worker's profile from the row and offers a one-tap call", async () => {
    await renderLoaded();
    const row = screen.getByRole("listitem", { name: "Zaid Ali" });

    expect(within(row).getByRole("link", { name: "Open Zaid Ali" })).toHaveAttribute("href", "/workers/1");
    expect(within(row).getByRole("link", { name: "Call Zaid Ali" })).toHaveAttribute("href", "tel:+971501112222");
    expect(within(screen.getByRole("listitem", { name: "Ahmed Khan" })).queryByRole("link", { name: /^Call/ })).not.toBeInTheDocument();
  });

  it("never prints the Emirates ID in the list", async () => {
    await renderLoaded();

    expect(screen.queryByText(/784-1990/)).not.toBeInTheDocument();
  });

  it("filters by what you type and by the Site and Office chips", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: /^Office/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem", { name: "Sara Accountant" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^All/ }));
    await user.type(screen.getByLabelText("Search workers"), "zaid");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem", { name: "Zaid Ali" })).toBeInTheDocument();
  });

  it("gives a Supervisor no edit menu, and a Manager one with Edit", async () => {
    await renderLoaded("Supervisor");
    expect(screen.queryByRole("button", { name: /^More actions for/ })).not.toBeInTheDocument();
  });

  it("shows a Manager the edit menu and the Add button", async () => {
    const user = await renderLoaded("Manager");

    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More actions for Ahmed Khan" }));
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Deactivate" })).toBeInTheDocument();
  });
});
