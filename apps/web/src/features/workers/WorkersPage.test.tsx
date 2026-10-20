import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../api/auth";
import { ApiError } from "../../api/client";
import * as settingsApi from "../../api/settings";
import * as workersApi from "../../api/workers";
import type { Worker } from "../../api/workers";
import { useAuth } from "../../contexts/AuthContext";
import { WorkersPage } from "./WorkersPage";

vi.mock("../../api/workers");
vi.mock("../../api/settings");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const ahmed: Worker = {
  id: 1,
  workerCode: "EMP-001",
  fullName: "Ahmed Khan",
  designation: "Glass Installer",
  hourlyRate: 12.5,
  overtimeRate: null,
  effectiveOvertimeRate: 2.22,
  isActive: true,
};
const sara: Worker = {
  id: 2,
  workerCode: "EMP-002",
  fullName: "Sara Ali",
  designation: "Fabricator",
  hourlyRate: 9,
  overtimeRate: 3,
  effectiveOvertimeRate: 3,
  isActive: false,
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

function renderPage(role: Role = "HR Staff") {
  signInAs(role);
  return { user: userEvent.setup(), ...render(<WorkersPage />) };
}

async function renderLoaded(role: Role = "HR Staff", workers: Worker[] = [ahmed]) {
  vi.mocked(workersApi.listWorkers).mockResolvedValue(workers);
  const view = renderPage(role);
  await screen.findByRole("table");
  return view;
}

beforeEach(() => {
  vi.resetAllMocks();
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

describe("WorkersPage - content", () => {
  it("shows the title and subtitle, the filter and a loading state while the list loads", async () => {
    let resolve!: (value: Worker[]) => void;
    vi.mocked(workersApi.listWorkers).mockReturnValue(
      new Promise<Worker[]>((r) => {
        resolve = r;
      }),
    );
    renderPage();

    expect(screen.getByRole("heading", { name: "Worker Directory" })).toBeInTheDocument();
    expect(
      screen.getByText("Manage employee profiles, designations, and base pay rates."),
    ).toBeInTheDocument();
    expect(screen.getByText("Loading workers...")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Show inactive workers")).not.toBeChecked();

    await act(async () => resolve([ahmed]));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("Loading workers...")).not.toBeInTheDocument();
  });

  it("loads active workers only by default", async () => {
    await renderLoaded();

    expect(workersApi.listWorkers).toHaveBeenCalledWith(false);
  });

  it("lists workers with the prototype columns and a two-decimal rate", async () => {
    await renderLoaded("Administrator");

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "ID",
      "Full Name",
      "Designation",
      "Base Rate (AED/hr)",
      "Overtime Rate (AED/hr)",
      "Status",
      "Actions",
    ]);
    const row = screen.getByRole("row", { name: /EMP-001/ });
    expect(within(row).getByText("EMP-001")).toBeInTheDocument();
    expect(within(row).getByText("Ahmed Khan")).toBeInTheDocument();
    expect(within(row).getByText("Glass Installer")).toBeInTheDocument();
    expect(within(row).getByText("12.50")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
  });

  it("shows the company overtime rate for a worker without their own, and their own rate otherwise", async () => {
    await renderLoaded("Administrator", [ahmed, { ...sara, isActive: true }]);

    const ahmedRow = screen.getByRole("row", { name: /EMP-001/ });
    expect(within(ahmedRow).getByText("Company rate (2.22)")).toBeInTheDocument();
    const saraRow = screen.getByRole("row", { name: /EMP-002/ });
    expect(within(saraRow).getByText("3.00")).toBeInTheDocument();
    expect(within(saraRow).queryByText(/Company rate/)).not.toBeInTheDocument();
  });

  it("shows an own overtime rate of 0 as 0.00, not as the company rate", async () => {
    await renderLoaded("Viewer", [{ ...ahmed, overtimeRate: 0, effectiveOvertimeRate: 0 }]);

    const row = screen.getByRole("row", { name: /EMP-001/ });
    expect(within(row).getByText("0.00")).toBeInTheDocument();
    expect(within(row).queryByText(/Company rate/)).not.toBeInTheDocument();
  });

  it("keeps the table inside its own horizontal scroll container", async () => {
    await renderLoaded();

    const wrapper = screen.getByRole("table").parentElement;
    expect(wrapper?.className).toContain("overflow-x-auto");
  });

  it("shows the empty state with an Add button to HR Staff", async () => {
    vi.mocked(workersApi.listWorkers).mockResolvedValue([]);
    renderPage("HR Staff");

    expect(await screen.findByText(/No workers yet\./)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add New Worker" })).toHaveLength(1);
  });

  it("shows the empty state without an Add button to a Viewer", async () => {
    vi.mocked(workersApi.listWorkers).mockResolvedValue([]);
    renderPage("Viewer");

    expect(await screen.findByText(/No workers yet\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add New Worker" })).not.toBeInTheDocument();
  });

  it("shows a specific error with a Retry button and recovers on retry", async () => {
    vi.mocked(workersApi.listWorkers)
      .mockRejectedValueOnce(new ApiError(0, "Unable to reach the server."))
      .mockResolvedValueOnce([ahmed]);
    const { user } = renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the server.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(workersApi.listWorkers).toHaveBeenCalledTimes(2);
  });

  it("reloads with inactive workers when the filter is ticked, showing an Inactive badge with text", async () => {
    vi.mocked(workersApi.listWorkers).mockResolvedValueOnce([ahmed]).mockResolvedValueOnce([ahmed, sara]);
    const { user } = renderPage("Administrator");
    await screen.findByRole("table");

    await user.click(screen.getByLabelText("Show inactive workers"));

    const row = await screen.findByRole("row", { name: /EMP-002/ });
    expect(workersApi.listWorkers).toHaveBeenLastCalledWith(true);
    expect(within(row).getByText("Inactive")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Activate Sara Ali" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /^Deactivate/ })).not.toBeInTheDocument();
  });

  it("always has a status region for success messages", async () => {
    await renderLoaded();

    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("WorkersPage - roles", () => {
  it.each(["Administrator", "HR Staff"] as const)("%s sees Add and the row actions", async (role) => {
    await renderLoaded(role);

    expect(screen.getByRole("button", { name: "Add New Worker" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /EMP-001/ });
    expect(within(row).getByRole("button", { name: "Edit Ahmed Khan" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Deactivate Ahmed Khan" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Delete Ahmed Khan" })).toBeInTheDocument();
  });

  it("gives every row action button an accessible name that includes the worker's name, even though the labels are icon-only below xl", async () => {
    await renderLoaded("HR Staff", [ahmed, sara]);

    const expectations = [
      { code: "EMP-001", name: "Ahmed Khan", labels: ["Edit", "Deactivate", "Delete"] },
      { code: "EMP-002", name: "Sara Ali", labels: ["Edit", "Activate", "Delete"] },
    ];
    for (const { code, name, labels } of expectations) {
      const row = screen.getByRole("row", { name: new RegExp(code) });
      const buttons = within(row).getAllByRole("button");
      expect(buttons).toHaveLength(labels.length);
      labels.forEach((label, index) => {
        expect(buttons[index]).toHaveAccessibleName(`${label} ${name}`);
      });
    }
  });

  it("gives a Viewer a read-only table: no Add, no Actions column, no row buttons", async () => {
    await renderLoaded("Viewer");

    expect(screen.getByText("Ahmed Khan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add New Worker" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit|Deactivate|Activate|Delete/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Show inactive workers")).toBeInTheDocument();
  });
});

describe("WorkersPage - add and edit", () => {
  it("adds a worker through the dialog, announces it and reloads the list", async () => {
    vi.mocked(workersApi.createWorker).mockResolvedValue({ ...ahmed, id: 5, workerCode: "EMP-005" });
    const { user } = await renderLoaded("HR Staff");
    vi.mocked(workersApi.listWorkers).mockResolvedValue([ahmed, { ...ahmed, id: 5, workerCode: "EMP-005" }]);

    await user.click(screen.getByRole("button", { name: "Add New Worker" }));
    const dialog = await screen.findByRole("dialog", { name: "Add New Worker" });
    await waitFor(() => expect(within(dialog).getByLabelText("Worker ID")).toHaveValue("EMP-005"));
    await user.type(within(dialog).getByLabelText("Full name"), "Omar");
    await user.type(within(dialog).getByLabelText("Designation"), "Helper");
    await user.type(within(dialog).getByLabelText("Base hourly rate (AED)"), "8");
    await user.click(within(dialog).getByRole("button", { name: "Save worker" }));

    expect(await screen.findByText("Worker added.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Worker added.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(workersApi.createWorker).toHaveBeenCalledWith({
      workerCode: "EMP-005",
      fullName: "Omar",
      designation: "Helper",
      hourlyRate: 8,
      overtimeRate: null,
    });
    await waitFor(() => expect(screen.getByText("EMP-005", { selector: "td" })).toBeInTheDocument());
    expect(workersApi.listWorkers).toHaveBeenCalledTimes(2);
  });

  it("edits a worker through the dialog and announces it", async () => {
    vi.mocked(workersApi.updateWorker).mockResolvedValue({ ...ahmed, hourlyRate: 15 });
    const { user } = await renderLoaded("Administrator");

    await user.click(screen.getByRole("button", { name: "Edit Ahmed Khan" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Worker Profile" });
    expect(within(dialog).getByLabelText("Worker ID")).toHaveValue("EMP-001");
    const rate = within(dialog).getByLabelText("Base hourly rate (AED)");
    await user.clear(rate);
    await user.type(rate, "15");
    await user.click(within(dialog).getByRole("button", { name: "Save worker" }));

    expect(await screen.findByText("Worker updated.")).toBeInTheDocument();
    expect(workersApi.updateWorker).toHaveBeenCalledWith(1, expect.objectContaining({ hourlyRate: 15 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes the dialog on Cancel without saving or announcing", async () => {
    const { user } = await renderLoaded("Administrator");

    await user.click(screen.getByRole("button", { name: "Edit Ahmed Khan" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(workersApi.updateWorker).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("WorkersPage - deactivate and activate", () => {
  it("asks for confirmation before deactivating, then deactivates and announces it", async () => {
    vi.mocked(workersApi.deactivateWorker).mockResolvedValue({ ...ahmed, isActive: false });
    const { user } = await renderLoaded("HR Staff");

    await user.click(screen.getByRole("button", { name: "Deactivate Ahmed Khan" }));
    const dialog = await screen.findByRole("dialog", { name: "Deactivate worker" });
    expect(dialog).toHaveTextContent("Ahmed Khan");
    expect(workersApi.deactivateWorker).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));

    expect(await screen.findByText("Worker deactivated.")).toBeInTheDocument();
    expect(workersApi.deactivateWorker).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does nothing when the deactivate confirmation is cancelled", async () => {
    const { user } = await renderLoaded("HR Staff");

    await user.click(screen.getByRole("button", { name: "Deactivate Ahmed Khan" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(workersApi.deactivateWorker).not.toHaveBeenCalled();
  });

  it("activates straight away, without a confirmation, and announces it", async () => {
    vi.mocked(workersApi.activateWorker).mockResolvedValue({ ...sara, isActive: true });
    vi.mocked(workersApi.listWorkers).mockResolvedValue([sara]);
    const { user } = renderPage("Administrator");
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Activate Sara Ali" }));

    expect(await screen.findByText("Worker activated.")).toBeInTheDocument();
    expect(workersApi.activateWorker).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a failed deactivation in the alert and closes the confirmation", async () => {
    vi.mocked(workersApi.deactivateWorker).mockRejectedValue(new ApiError(404, "Worker not found."));
    const { user } = await renderLoaded("HR Staff");

    await user.click(screen.getByRole("button", { name: "Deactivate Ahmed Khan" }));
    await user.click(await screen.findByRole("button", { name: "Deactivate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Worker not found.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a failed activation in the alert", async () => {
    vi.mocked(workersApi.activateWorker).mockRejectedValue(new ApiError(0, "Unable to reach the server."));
    vi.mocked(workersApi.listWorkers).mockResolvedValue([sara]);
    const { user } = renderPage("Administrator");
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Activate Sara Ali" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the server.");
  });
});

describe("WorkersPage - delete", () => {
  it("asks for confirmation, then deletes, announces it and reloads", async () => {
    vi.mocked(workersApi.deleteWorker).mockResolvedValue(undefined);
    const { user } = await renderLoaded("Administrator");
    vi.mocked(workersApi.listWorkers).mockResolvedValue([]);

    await user.click(screen.getByRole("button", { name: "Delete Ahmed Khan" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete worker" });
    expect(dialog).toHaveTextContent("Ahmed Khan");
    expect(workersApi.deleteWorker).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Worker deleted.")).toBeInTheDocument();
    expect(workersApi.deleteWorker).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByRole("table")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the 409 message in the page alert, closes the confirmation and keeps the row", async () => {
    vi.mocked(workersApi.deleteWorker).mockRejectedValue(
      new ApiError(
        409,
        "This worker has records and cannot be deleted. Deactivate the worker instead.",
      ),
    );
    const { user } = await renderLoaded("Administrator");

    await user.click(screen.getByRole("button", { name: "Delete Ahmed Khan" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This worker has records and cannot be deleted. Deactivate the worker instead.",
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Ahmed Khan")).toBeInTheDocument();
  });

  it("disables the confirmation buttons while the delete is in flight", async () => {
    let resolve!: () => void;
    vi.mocked(workersApi.deleteWorker).mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    const { user } = await renderLoaded("Administrator");

    await user.click(screen.getByRole("button", { name: "Delete Ahmed Khan" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(screen.getByRole("button", { name: "Working..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await act(async () => resolve());
    expect(await screen.findByText("Worker deleted.")).toBeInTheDocument();
  });

  it("clears an earlier failure message when the next action starts", async () => {
    vi.mocked(workersApi.deleteWorker).mockRejectedValueOnce(new ApiError(409, "Has records.")).mockResolvedValue(undefined);
    const { user } = await renderLoaded("Administrator");
    await user.click(screen.getByRole("button", { name: "Delete Ahmed Khan" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Delete Ahmed Khan" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
