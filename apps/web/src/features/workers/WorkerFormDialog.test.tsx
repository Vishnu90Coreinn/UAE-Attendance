import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import * as settingsApi from "../../api/settings";
import * as workersApi from "../../api/workers";
import type { Worker } from "../../api/workers";
import { WorkerFormDialog } from "./WorkerFormDialog";

vi.mock("../../api/workers");
vi.mock("../../api/settings");

const companySettings: settingsApi.PayrollSettings = {
  companyName: "Company",
  tagline: "",
  contactEmail: "hr@example.com",
  overtimeRatePerHour: 2.22,
  maxBasicHoursPerDay: 8,
  shiftDescription: "06:00 AM - 05:30 PM",
  preparedByLabel: "HR Department",
  approvedByLabel: "General Manager",
};

const existing: Worker = {
  id: 7,
  workerCode: "EMP-007",
  fullName: "Ahmed Khan",
  designation: "Glass Installer",
  hourlyRate: 12.5,
  overtimeRate: null,
  effectiveOvertimeRate: 2.22,
  isActive: true,
};

function setup(worker: Worker | null = null) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(<WorkerFormDialog open worker={worker} onClose={onClose} onSaved={onSaved} />);
  return { user, onClose, onSaved };
}

const code = () => screen.getByLabelText("Worker ID");
const name = () => screen.getByLabelText("Full name");
const role = () => screen.getByLabelText("Designation");
const rate = () => screen.getByLabelText("Base hourly rate (AED)");
const overtime = () => screen.getByLabelText("Overtime rate (AED/hr) - optional");
const save = () => screen.getByRole("button", { name: "Save worker" });

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(code()).toHaveValue("EMP-005"));
  await user.clear(code());
  await user.type(code(), "EMP-009");
  await user.type(name(), "  Sara Ali  ");
  await user.type(role(), "Fabricator");
  await user.type(rate(), "11.5");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(workersApi.getNextWorkerCode).mockResolvedValue("EMP-005");
  vi.mocked(settingsApi.getPayrollSettings).mockResolvedValue(companySettings);
});

describe("WorkerFormDialog - add", () => {
  it("is a labelled modal titled Add New Worker with visible labels and the prototype placeholder", async () => {
    setup();

    const dialog = await screen.findByRole("dialog", { name: "Add New Worker" });
    expect(within(dialog).getByLabelText("Worker ID")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Full name")).toBeInTheDocument();
    expect(role()).toHaveAttribute("placeholder", "e.g. Glass Installer, Aluminum Fabricator");
    expect(rate()).toHaveAttribute("inputmode", "decimal");
    expect(code()).toHaveFocus();
  });

  it("prefills the Worker ID from the next-code endpoint", async () => {
    setup();

    await waitFor(() => expect(code()).toHaveValue("EMP-005"));
    expect(workersApi.getNextWorkerCode).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite an ID the user already started typing", async () => {
    let resolve!: (value: string) => void;
    vi.mocked(workersApi.getNextWorkerCode).mockReturnValue(
      new Promise<string>((r) => {
        resolve = r;
      }),
    );
    const { user } = setup();
    await user.type(code(), "MINE-1");

    await act(async () => resolve("EMP-005"));

    expect(code()).toHaveValue("MINE-1");
  });

  it("leaves the ID empty, without an error, when the next code cannot be read", async () => {
    vi.mocked(workersApi.getNextWorkerCode).mockRejectedValue(new ApiError(0, "Unable to reach the server."));
    setup();

    await waitFor(() => expect(workersApi.getNextWorkerCode).toHaveBeenCalled());

    expect(code()).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("creates the worker with trimmed text and a numeric rate, then reports it saved", async () => {
    const created: Worker = { ...existing, id: 9, workerCode: "EMP-009", fullName: "Sara Ali", designation: "Fabricator", hourlyRate: 11.5 };
    vi.mocked(workersApi.createWorker).mockResolvedValue(created);
    const { user, onSaved } = setup();
    await fillValid(user);

    await user.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(workersApi.createWorker).toHaveBeenCalledTimes(1);
    expect(workersApi.createWorker).toHaveBeenCalledWith({
      workerCode: "EMP-009",
      fullName: "Sara Ali",
      designation: "Fabricator",
      hourlyRate: 11.5,
      overtimeRate: null,
      joinDate: null,
      department: null,
      emiratesId: null,
      passportNumber: null,
      phone: null,
      email: null,
      emergencyContact: null,
      workLocation: null,
      notes: null,
      contractSigned: false,
      visaMedicalCleared: false,
      safetyGearIssued: false,
      siteOrientationDone: false,
      wpsRegistered: false,
      badgeIssued: false,
    });
    expect(workersApi.updateWorker).not.toHaveBeenCalled();
  });

  it("shows a disabled Saving... button while the request is pending", async () => {
    let resolve!: (value: Worker) => void;
    vi.mocked(workersApi.createWorker).mockReturnValue(
      new Promise<Worker>((r) => {
        resolve = r;
      }),
    );
    const { user, onSaved } = setup();
    await fillValid(user);

    await user.click(save());

    const pending = screen.getByRole("button", { name: "Saving..." });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

    await act(async () => resolve(existing));
    expect(onSaved).toHaveBeenCalledWith(existing);
  });
});

describe("WorkerFormDialog - edit", () => {
  it("is titled Edit Worker Profile and shows the current values, without asking for a next code", async () => {
    setup(existing);

    await screen.findByRole("dialog", { name: "Edit Worker Profile" });
    expect(code()).toHaveValue("EMP-007");
    expect(name()).toHaveValue("Ahmed Khan");
    expect(role()).toHaveValue("Glass Installer");
    expect(rate()).toHaveValue("12.50");
    expect(workersApi.getNextWorkerCode).not.toHaveBeenCalled();
  });

  it("updates the worker by id with the edited fields", async () => {
    const updated = { ...existing, hourlyRate: 14 };
    vi.mocked(workersApi.updateWorker).mockResolvedValue(updated);
    const { user, onSaved } = setup(existing);

    await user.clear(rate());
    await user.type(rate(), "14");
    await user.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect(workersApi.updateWorker).toHaveBeenCalledWith(7, {
      workerCode: "EMP-007",
      fullName: "Ahmed Khan",
      designation: "Glass Installer",
      hourlyRate: 14,
      overtimeRate: null,
      joinDate: null,
      department: null,
      emiratesId: null,
      passportNumber: null,
      phone: null,
      email: null,
      emergencyContact: null,
      workLocation: null,
      notes: null,
      contractSigned: false,
      visaMedicalCleared: false,
      safetyGearIssued: false,
      siteOrientationDone: false,
      wpsRegistered: false,
      badgeIssued: false,
    });
    expect(workersApi.createWorker).not.toHaveBeenCalled();
  });

  it("prefills the worker's own overtime rate to two decimals", async () => {
    setup({ ...existing, overtimeRate: 3 });

    await screen.findByRole("dialog", { name: "Edit Worker Profile" });
    expect(overtime()).toHaveValue("3.00");
  });

  it("leaves the overtime rate blank for a worker who uses the company rate", async () => {
    setup(existing);

    await screen.findByRole("dialog", { name: "Edit Worker Profile" });
    expect(overtime()).toHaveValue("");
  });

  it("sends null when the overtime rate is cleared so the worker falls back to the company rate", async () => {
    vi.mocked(workersApi.updateWorker).mockResolvedValue(existing);
    const { user, onSaved } = setup({ ...existing, overtimeRate: 3 });

    await user.clear(overtime());
    await user.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(workersApi.updateWorker).toHaveBeenCalledWith(7, expect.objectContaining({ overtimeRate: null }));
  });
});

describe("WorkerFormDialog - overtime rate", () => {
  it("is an optional, labelled decimal field with the company rate in its hint", async () => {
    setup();

    expect(overtime()).toHaveAttribute("inputmode", "decimal");
    expect(overtime()).toHaveValue("");
    expect(overtime()).not.toBeRequired();
    expect(await screen.findByText("Leave blank to use the company rate (2.22)")).toBeInTheDocument();
    expect(overtime()).toHaveAccessibleDescription("Leave blank to use the company rate (2.22)");
    expect(settingsApi.getPayrollSettings).toHaveBeenCalledTimes(1);
  });

  it("shows the company rate with two decimals", async () => {
    vi.mocked(settingsApi.getPayrollSettings).mockResolvedValue({ ...companySettings, overtimeRatePerHour: 2.5 });
    setup();

    expect(await screen.findByText("Leave blank to use the company rate (2.50)")).toBeInTheDocument();
  });

  it("shows the hint without a rate when the company settings cannot be read, and still works", async () => {
    vi.mocked(settingsApi.getPayrollSettings).mockRejectedValue(new ApiError(0, "Unable to reach the server."));
    vi.mocked(workersApi.createWorker).mockResolvedValue(existing);
    const { user } = setup();
    await fillValid(user);

    await waitFor(() => expect(settingsApi.getPayrollSettings).toHaveBeenCalled());
    expect(screen.getByText("Leave blank to use the company rate")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(save());
    await waitFor(() => expect(workersApi.createWorker).toHaveBeenCalled());
  });

  it("sends the ticked onboarding checklist items", async () => {
    vi.mocked(workersApi.createWorker).mockResolvedValue(existing);
    const { user } = setup();
    await fillValid(user);
    await user.click(screen.getByLabelText("Labor Contract Signed"));
    await user.click(screen.getByLabelText("ID Badge Printed & Issued"));
    await user.click(save());

    await waitFor(() =>
      expect(workersApi.createWorker).toHaveBeenCalledWith(
        expect.objectContaining({ contractSigned: true, badgeIssued: true, wpsRegistered: false }),
      ),
    );
  });

  it("sends the typed overtime rate as a number", async () => {
    vi.mocked(workersApi.createWorker).mockResolvedValue(existing);
    const { user } = setup();
    await fillValid(user);
    await user.type(overtime(), " 3.5 ");

    await user.click(save());

    await waitFor(() => expect(workersApi.createWorker).toHaveBeenCalledTimes(1));
    expect(workersApi.createWorker).toHaveBeenCalledWith(expect.objectContaining({ overtimeRate: 3.5 }));
  });

  it("accepts 0 (no overtime pay) and sends it as 0, not null", async () => {
    vi.mocked(workersApi.createWorker).mockResolvedValue(existing);
    const { user } = setup();
    await fillValid(user);
    await user.type(overtime(), "0");

    await user.click(save());

    await waitFor(() => expect(workersApi.createWorker).toHaveBeenCalledTimes(1));
    expect(workersApi.createWorker).toHaveBeenCalledWith(expect.objectContaining({ overtimeRate: 0 }));
  });

  it.each([
    ["abc", "Enter the overtime rate as a number, for example 2.50."],
    ["-1", "Overtime rate cannot be negative."],
    ["1000", "Overtime rate must be at most 999.99."],
    ["2.345", "Overtime rate can have at most 2 decimal places."],
  ])("rejects the overtime rate %s without calling the API", async (value, message) => {
    const { user } = setup();
    await fillValid(user);
    await user.type(overtime(), value);

    await user.click(save());

    expect(overtime()).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(overtime()).toHaveAttribute("aria-invalid", "true");
    expect(overtime()).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(workersApi.createWorker).not.toHaveBeenCalled();
  });

  it("shows the overtime error as soon as the user leaves the field", async () => {
    const { user } = setup();
    await user.type(overtime(), "-4");
    await user.tab();

    expect(overtime()).toHaveAccessibleDescription(expect.stringContaining("Overtime rate cannot be negative."));
  });

  it("shows a server overtimeRate error under the field and keeps the form open", async () => {
    vi.mocked(workersApi.createWorker).mockRejectedValue(
      new ApiError(400, "Overtime rate is too high.", undefined, undefined, {
        overtimeRate: ["Overtime rate is too high."],
      }),
    );
    const { user, onSaved } = setup();
    await fillValid(user);
    await user.type(overtime(), "5");

    await user.click(save());

    await screen.findByText("Overtime rate is too high.", { selector: "p[id]" });
    expect(overtime()).toHaveAccessibleDescription(expect.stringContaining("Overtime rate is too high."));
    expect(overtime()).toHaveAttribute("aria-invalid", "true");
    expect(overtime()).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Overtime rate is too high.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("WorkerFormDialog - validation", () => {
  async function submitWith(values: { code?: string; name?: string; role?: string; rate?: string }) {
    const { user } = setup();
    await waitFor(() => expect(code()).toHaveValue("EMP-005"));
    await user.clear(code());
    if (values.code) fireEvent.change(code(), { target: { value: values.code } });
    if (values.name) fireEvent.change(name(), { target: { value: values.name } });
    if (values.role) fireEvent.change(role(), { target: { value: values.role } });
    if (values.rate) fireEvent.change(rate(), { target: { value: values.rate } });
    await user.click(save());
    return user;
  }

  const valid = { code: "EMP-1", name: "Sara", role: "Fabricator", rate: "10" };

  it("requires every field and focuses the first invalid one without calling the API", async () => {
    await submitWith({});

    expect(code()).toHaveAccessibleDescription("Enter a worker ID.");
    expect(name()).toHaveAccessibleDescription("Enter the full name.");
    expect(role()).toHaveAccessibleDescription("Enter the designation.");
    expect(rate()).toHaveAccessibleDescription("Enter the base hourly rate.");
    [code(), name(), role(), rate()].forEach((field) => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(code()).toHaveFocus();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Enter a worker ID.");
    expect(alert).toHaveTextContent("Enter the base hourly rate.");
    expect(workersApi.createWorker).not.toHaveBeenCalled();
  });

  it("treats a blank name as missing", async () => {
    await submitWith({ ...valid, name: "   " });

    expect(name()).toHaveAccessibleDescription("Enter the full name.");
    expect(workersApi.createWorker).not.toHaveBeenCalled();
  });

  it("rejects a Worker ID with characters other than letters, digits, hyphen and underscore", async () => {
    await submitWith({ ...valid, code: "EMP 1!" });

    expect(code()).toHaveAccessibleDescription(
      "Worker ID can only contain letters, numbers, hyphens and underscores.",
    );
    expect(workersApi.createWorker).not.toHaveBeenCalled();
  });

  it("rejects a Worker ID longer than 20 characters", async () => {
    await submitWith({ ...valid, code: "A".repeat(21) });

    expect(code()).toHaveAccessibleDescription("Worker ID must be at most 20 characters.");
  });

  it("rejects a name longer than 120 and a designation longer than 80 characters", async () => {
    await submitWith({ ...valid, name: "N".repeat(121), role: "D".repeat(81) });

    expect(name()).toHaveAccessibleDescription("Full name must be at most 120 characters.");
    expect(role()).toHaveAccessibleDescription("Designation must be at most 80 characters.");
  });

  it.each([
    ["abc", "Enter the rate as a number, for example 12.50."],
    ["0", "Rate must be greater than 0."],
    ["-5", "Rate must be greater than 0."],
    ["1000", "Rate must be at most 999.99."],
    ["12.345", "Rate can have at most 2 decimal places."],
  ])("rejects the rate %s", async (value, message) => {
    await submitWith({ ...valid, rate: value });

    expect(rate()).toHaveAccessibleDescription(message);
    expect(workersApi.createWorker).not.toHaveBeenCalled();
  });

  it.each(["0.01", "999.99", "12", "12.5", ".5"])("accepts the rate %s", async (value) => {
    vi.mocked(workersApi.createWorker).mockResolvedValue(existing);
    await submitWith({ ...valid, rate: value });

    await waitFor(() => expect(workersApi.createWorker).toHaveBeenCalledTimes(1));
    expect(workersApi.createWorker).toHaveBeenCalledWith(expect.objectContaining({ hourlyRate: Number(value) }));
  });

  it("shows a field's error as soon as the user leaves that field", async () => {
    const { user } = setup();
    await user.click(name());
    await user.tab();

    expect(name()).toHaveAccessibleDescription("Enter the full name.");
  });
});

describe("WorkerFormDialog - server errors", () => {
  it("shows a duplicate Worker ID under that field, in the alert, and keeps the form open", async () => {
    vi.mocked(workersApi.createWorker).mockRejectedValue(
      new ApiError(400, "Worker ID already exists.", undefined, undefined, {
        workerCode: ["Worker ID already exists."],
      }),
    );
    const { user, onSaved, onClose } = setup();
    await fillValid(user);

    await user.click(save());

    expect(await screen.findByText("Worker ID already exists.", { selector: "p[id]" })).toBeInTheDocument();
    expect(code()).toHaveAccessibleDescription("Worker ID already exists.");
    expect(code()).toHaveAttribute("aria-invalid", "true");
    expect(rate()).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Worker ID already exists.");
    expect(code()).toHaveFocus();
    expect(save()).toBeEnabled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("maps the other server field errors to their fields", async () => {
    vi.mocked(workersApi.createWorker).mockRejectedValue(
      new ApiError(400, "Rate is too high.", undefined, undefined, {
        hourlyRate: ["Rate is too high."],
        fullName: ["Name is not allowed."],
        designation: ["Designation is not allowed."],
      }),
    );
    const { user } = setup();
    await fillValid(user);

    await user.click(save());

    await screen.findByText("Rate is too high.", { selector: "p[id]" });
    expect(rate()).toHaveAccessibleDescription("Rate is too high.");
    expect(name()).toHaveAccessibleDescription("Name is not allowed.");
    expect(role()).toHaveAccessibleDescription("Designation is not allowed.");
  });

  it("clears a server error once the user edits that field", async () => {
    vi.mocked(workersApi.createWorker).mockRejectedValue(
      new ApiError(400, "Worker ID already exists.", undefined, undefined, {
        workerCode: ["Worker ID already exists."],
      }),
    );
    const { user } = setup();
    await fillValid(user);
    await user.click(save());
    await screen.findByText("Worker ID already exists.", { selector: "p[id]" });

    await user.type(code(), "9");

    expect(code()).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows a general failure (for example the server being unreachable) in the alert", async () => {
    vi.mocked(workersApi.updateWorker).mockRejectedValue(new ApiError(0, "Unable to reach the server."));
    const { user } = setup(existing);

    await user.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the server.");
    expect(save()).toBeEnabled();
  });

  it("shows the not-found message when the worker no longer exists", async () => {
    vi.mocked(workersApi.updateWorker).mockRejectedValue(new ApiError(404, "Worker not found."));
    const { user } = setup(existing);

    await user.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("Worker not found.");
  });
});

describe("WorkerFormDialog - closing", () => {
  it("calls onClose on Cancel", async () => {
    const { user, onClose } = setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", async () => {
    const { user, onClose } = setup(existing);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts empty, without errors, each time it is reopened", async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const { rerender } = render(<WorkerFormDialog open worker={existing} onClose={onClose} onSaved={onSaved} />);
    await userEvent.setup().type(name(), "XYZ");
    fireEvent.change(rate(), { target: { value: "abc" } });
    fireEvent.blur(rate());
    expect(rate()).toHaveAttribute("aria-invalid", "true");

    rerender(<WorkerFormDialog open={false} worker={existing} onClose={onClose} onSaved={onSaved} />);
    rerender(<WorkerFormDialog open worker={existing} onClose={onClose} onSaved={onSaved} />);

    expect(name()).toHaveValue("Ahmed Khan");
    expect(rate()).toHaveValue("12.50");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
