import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as deductionsApi from "../../api/deductions";
import type { MonthDeductions } from "../../api/deductions";
import { DeductionsPage } from "./DeductionsPage";

vi.mock("../../api/deductions");

const types = [
  { id: 1, name: "Advance / Loan", isActive: true },
  { id: 2, name: "Other Deductions", isActive: true },
];

function monthData(overrides: Partial<MonthDeductions> = {}): MonthDeductions {
  return {
    month: "2026-10",
    isFinalised: false,
    types,
    workers: [
      { workerId: 1, workerCode: "EMP-001", fullName: "Ahmed Khan", isActive: true, entries: [] },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(deductionsApi.listDeductionTypes).mockResolvedValue(types);
  vi.mocked(deductionsApi.getDeductions).mockResolvedValue(monthData());
});

it("asks for a reason before it saves an amount", async () => {
  const user = userEvent.setup();
  render(<DeductionsPage />);
  const amount = await screen.findByLabelText("Advance / Loan amount for Ahmed Khan");
  await user.type(amount, "50");
  await user.click(screen.getByRole("button", { name: "Save deductions" }));

  expect(await screen.findByText(/enter the reason for this deduction/i)).toBeInTheDocument();
  expect(deductionsApi.saveDeductions).not.toHaveBeenCalled();
});

it("saves the amount with its reason for the month", async () => {
  const user = userEvent.setup();
  vi.mocked(deductionsApi.saveDeductions).mockResolvedValue(
    monthData({
      workers: [
        {
          workerId: 1,
          workerCode: "EMP-001",
          fullName: "Ahmed Khan",
          isActive: true,
          entries: [{ deductionTypeId: 1, amount: 50, note: "Agreed advance" }],
        },
      ],
    }),
  );
  render(<DeductionsPage />);
  await user.type(await screen.findByLabelText("Advance / Loan amount for Ahmed Khan"), "50");
  await user.type(screen.getByLabelText("Reason for Advance / Loan for Ahmed Khan"), "Agreed advance");
  await user.click(screen.getByRole("button", { name: "Save deductions" }));

  await waitFor(() =>
    expect(deductionsApi.saveDeductions).toHaveBeenCalledWith("2026-10", [
      { workerId: 1, entries: [{ deductionTypeId: 1, amount: 50, note: "Agreed advance" }] },
    ]),
  );
  expect(await screen.findByText("Deductions saved.")).toBeInTheDocument();
});

it("locks the entries for a finalised month", async () => {
  vi.mocked(deductionsApi.getDeductions).mockResolvedValue(monthData({ isFinalised: true }));
  render(<DeductionsPage />);
  expect(await screen.findByText(/this month is finalised/i)).toBeInTheDocument();
  expect(screen.getByLabelText("Advance / Loan amount for Ahmed Khan")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Save deductions" })).not.toBeInTheDocument();
});
