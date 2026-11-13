import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as settingsApi from "../../api/settings";
import * as workersApi from "../../api/workers";
import type { Worker } from "../../api/workers";
import { WorkerFormDialog } from "./WorkerFormDialog";
import { toWorkerInput, validateWorker, type WorkerFormValues } from "./workerValidation";

vi.mock("../../api/workers");
vi.mock("../../api/settings");

const existing: Worker = {
  id: 7,
  workerCode: "EMP-007",
  fullName: "Ahmed Khan",
  designation: "Glass Installer",
  hourlyRate: 12.5,
  monthlySalary: 3000,
  overtimeRate: null,
  effectiveOvertimeRate: 2.22,
  isActive: true,
  nationality: "Pakistani",
  housingAllowance: 800,
  transportAllowance: 0,
  otherAllowance: 200,
  bankName: "Emirates NBD",
  bankAccountNumber: "0129",
  iban: "AE03",
};

function setup(worker: Worker | null) {
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(<WorkerFormDialog open worker={worker} onClose={vi.fn()} onSaved={onSaved} />);
  return { user, onSaved };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(workersApi.getNextWorkerCode).mockResolvedValue("EMP-005");
  vi.mocked(settingsApi.getPayrollSettings).mockResolvedValue({
    companyName: "C", tagline: "", contactEmail: "", overtimeRatePerHour: 2.22, maxBasicHoursPerDay: 8,
    shiftDescription: "", preparedByLabel: "", approvedByLabel: "",
  });
});

describe("worker form - letter details", () => {
  it("shows the saved nationality, allowances and bank details, with blank for a zero allowance", async () => {
    setup(existing);

    expect(await screen.findByLabelText("Nationality")).toHaveValue("Pakistani");
    expect(screen.getByLabelText("Housing allowance (AED)")).toHaveValue("800.00");
    expect(screen.getByLabelText("Transport allowance (AED)")).toHaveValue("");
    expect(screen.getByLabelText("Other allowance (AED)")).toHaveValue("200.00");
    expect(screen.getByLabelText("Bank name")).toHaveValue("Emirates NBD");
    expect(screen.getByLabelText("Bank account number")).toHaveValue("0129");
    expect(screen.getByLabelText("IBAN")).toHaveValue("AE03");
  });

  it("sends edited values, with blank allowances as 0 and blank text as null", async () => {
    vi.mocked(workersApi.updateWorker).mockResolvedValue(existing);
    const { user, onSaved } = setup(existing);
    await screen.findByLabelText("Nationality");

    await user.clear(screen.getByLabelText("Housing allowance (AED)"));
    await user.type(screen.getByLabelText("Transport allowance (AED)"), "400");
    await user.clear(screen.getByLabelText("IBAN"));
    await user.clear(screen.getByLabelText("Nationality"));
    await user.type(screen.getByLabelText("Nationality"), " Indian ");
    await user.click(screen.getByRole("button", { name: "Save worker" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(workersApi.updateWorker).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        housingAllowance: 0, transportAllowance: 400, otherAllowance: 200, nationality: "Indian", iban: null, bankName: "Emirates NBD",
      }),
    );
  });

  it("refuses a bad allowance without calling the server", async () => {
    const { user } = setup(existing);
    await screen.findByLabelText("Nationality");

    await user.type(screen.getByLabelText("Transport allowance (AED)"), "-5");
    await user.click(screen.getByRole("button", { name: "Save worker" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Transport allowance cannot be negative.");
    expect(workersApi.updateWorker).not.toHaveBeenCalled();
  });
});

describe("validateWorker - letter details", () => {
  const base: WorkerFormValues = {
    workerCode: "EMP-1", fullName: "A", designation: "B", hourlyRate: "5", monthlySalary: "1200", basicSalary: "", overtimeRate: "",
    housingAllowance: "", transportAllowance: "", otherAllowance: "", joinDate: "", department: "", emiratesId: "",
    passportNumber: "", nationality: "", bankName: "", bankAccountNumber: "", iban: "", exchangeName: "", cardNumber: "", exchangeAccountNumber: "", phone: "", email: "",
    emergencyContact: "", workLocation: "", notes: "",
  };

  it("accepts blanks and rejects over-long text, decimals and too-large amounts", () => {
    expect(validateWorker(base)).toEqual({});
    const errors = validateWorker({
      ...base, nationality: "n".repeat(61), iban: "A".repeat(41), housingAllowance: "1.234", otherAllowance: "100000",
    });
    expect(errors.nationality).toBe("Nationality must be at most 60 characters.");
    expect(errors.iban).toBe("IBAN must be at most 40 characters.");
    expect(errors.housingAllowance).toBe("Housing allowance can have at most 2 decimal places.");
    expect(errors.otherAllowance).toContain("must be at most");
  });

  it("builds the request with numeric allowances", () => {
    const input = toWorkerInput({ ...base, housingAllowance: "800", bankName: " Mashreq " });
    expect(input).toMatchObject({ housingAllowance: 800, transportAllowance: 0, bankName: "Mashreq", iban: null, nationality: null });
  });
});
