import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "../../api/finance";
import { FinanceTaxPeriodCard } from "./FinanceTaxPeriodCard";
import { assignedVatPeriod } from "./vatPeriods";

vi.mock("../../api/finance");
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getFinanceTaxPeriod).mockResolvedValue({ months: 3, startMonth: 1, confirmed: false });
  vi.mocked(api.saveFinanceTaxPeriod).mockImplementation(async (v) => v);
});

it("saves a confirmed quarterly period starting outside January", async () => {
  const user = userEvent.setup();
  render(<FinanceTaxPeriodCard />);
  await user.selectOptions(await screen.findByLabelText("A VAT period starts in"), "2");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Save VAT period" }));
  await waitFor(() => expect(api.saveFinanceTaxPeriod).toHaveBeenCalledWith({ months: 3, startMonth: 2, confirmed: true }));
  expect(await screen.findByText("VAT period saved.")).toBeInTheDocument();
});

it("calculates an assigned quarter across the year boundary", () => {
  expect(assignedVatPeriod("2027-01-10", 3, 2)).toMatchObject({ from: "2026-11-01", to: "2027-01-31" });
});
