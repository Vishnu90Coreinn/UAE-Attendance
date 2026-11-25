import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import { YearEndTab } from "./YearEndTab";

vi.mock("../../api/finance");

const open2025: financeApi.FinYear = { year: 2025, status: "Open", revenue: 20000, expenses: 5000, netResult: 15000, journalNumber: null, closedBy: null, closedUtc: null, canClose: true, canReopen: false, blocker: null };
const closed2024: financeApi.FinYear = { year: 2024, status: "Closed", revenue: 30000, expenses: 12000, netResult: 18000, journalNumber: "JNL-000042", closedBy: "manager1", closedUtc: "2026-01-05T08:00:00Z", canClose: false, canReopen: true, blocker: null };
const current: financeApi.FinYear = { year: 2026, status: "Open", revenue: 0, expenses: 0, netResult: 0, journalNumber: null, closedBy: null, closedUtc: null, canClose: false, canReopen: false, blocker: "2026 is not over yet. It can be closed from 1 January 2027." };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.listFinYears).mockResolvedValue([closed2024, open2025, current]);
});

it("lists each year with its result, who closed it, and why the current year cannot close yet", async () => {
  render(<YearEndTab canClose canReopen onChanged={() => {}} />);

  expect(await screen.findByText("Year 2025")).toBeInTheDocument();
  expect(screen.getByText(/Closed by manager1/)).toBeInTheDocument();
  expect(screen.getByText(/2026 is not over yet/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close 2025" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Close 2026" })).not.toBeInTheDocument();
});

it("asks to confirm, spelling out the consequence, before closing a year", async () => {
  const onChanged = vi.fn();
  vi.mocked(financeApi.closeFinYear).mockResolvedValue({ ...open2025, status: "Closed" });
  render(<YearEndTab canClose canReopen onChanged={onChanged} />);

  await userEvent.click(await screen.findByRole("button", { name: "Close 2025" }));
  expect(screen.getByText(/a profit of AED 15,000.00 moves to retained earnings/)).toBeInTheDocument();
  expect(financeApi.closeFinYear).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Yes, close 2025" }));

  await waitFor(() => expect(financeApi.closeFinYear).toHaveBeenCalledWith(2025));
  expect(await screen.findByText("2025 is closed.")).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalled();
});

it("needs a reason to reopen, and only an Administrator sees the button", async () => {
  vi.mocked(financeApi.reopenFinYear).mockResolvedValue({ ...closed2024, status: "Open" });
  const { unmount } = render(<YearEndTab canClose canReopen={false} onChanged={() => {}} />);
  await screen.findByText("Year 2024");
  expect(screen.queryByRole("button", { name: "Reopen 2024" })).not.toBeInTheDocument();
  unmount();

  render(<YearEndTab canClose canReopen onChanged={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "Reopen 2024" }));
  expect(screen.getByRole("button", { name: "Reopen 2024" })).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Reason for reopening"), "Late invoice");
  await userEvent.click(screen.getByRole("button", { name: "Reopen 2024" }));

  await waitFor(() => expect(financeApi.reopenFinYear).toHaveBeenCalledWith(2024, "Late invoice"));
});

it("shows the server's sentence when closing is refused", async () => {
  const { ApiError } = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  vi.mocked(financeApi.closeFinYear).mockRejectedValue(new ApiError(409, "2 staff expenses dated in 2025 still wait for approval."));
  render(<YearEndTab canClose canReopen onChanged={() => {}} />);

  await userEvent.click(await screen.findByRole("button", { name: "Close 2025" }));
  await userEvent.click(screen.getByRole("button", { name: "Yes, close 2025" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("still wait for approval");
});
