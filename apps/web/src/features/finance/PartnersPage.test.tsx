import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import type { FinAccount, FinCapitalEntry, FinPartners } from "../../api/finance";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { PartnersPage } from "./PartnersPage";

vi.mock("../../api/finance");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../utils/useIsDesktop", () => ({ useIsDesktop: () => true }));

const partners: FinPartners = {
  totalCapital: 100000,
  partners: [
    { id: 1, name: "Anil Kumar", openingCapital: 50000, isActive: true, sortOrder: 0, added: 10000, returned: 0, netCapital: 60000, share: 60, movementCount: 1, lastMovementDate: "2026-11-20" },
    { id: 2, name: "Rafi Khan", openingCapital: 30000, isActive: true, sortOrder: 1, added: 0, returned: 0, netCapital: 30000, share: 30, movementCount: 0, lastMovementDate: null },
    { id: 3, name: "Sara Noor", openingCapital: 10000, isActive: true, sortOrder: 2, added: 0, returned: 0, netCapital: 10000, share: 10, movementCount: 0, lastMovementDate: null },
  ],
};
const account: FinAccount = { id: 1, name: "RAKBANK Current", kind: "Bank", bankName: null, accountNumber: null, iban: null, openingBalance: 0, openingDate: "2026-08-05", isActive: true, sortOrder: 0, balance: 100, entryCount: 1 };
const movement: FinCapitalEntry = {
  id: 5, kind: "Capital", entryNo: "CAP-000001", entryDate: "2026-11-20", categoryId: 11, categoryName: "Capital contribution", party: "Anil Kumar", accountId: 1, accountName: "RAKBANK Current",
  amount: 10000, reference: "DEP 44", notes: null, status: "Active", voidReason: null, createdBy: "m", createdUtc: "2026-11-20T08:00:00Z", attachments: [],
  voidedBy: null, voidedUtc: null, replacesEntryId: null, replacesEntryNo: null, replacedByEntryNo: null, partnerId: 1,
};

function signIn(role: "Manager" | "Viewer") {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "u", role }, token: "t", login: vi.fn(), logout: vi.fn() });
}

beforeEach(() => {
  vi.resetAllMocks();
  signIn("Manager");
  vi.mocked(financeApi.listFinPartners).mockResolvedValue(partners);
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([account]);
  vi.mocked(financeApi.listFinCapital).mockResolvedValue({ items: [movement], total: 10000, count: 1, truncated: false });
});

it("shows the total capital and each partner's exact share and amounts", async () => {
  render(<PartnersPage />);
  const panel = await screen.findByRole("region", { name: /total capital/i });
  expect(within(panel).getByText("100,000.00")).toBeInTheDocument();
  expect(within(panel).getByText("60.00%")).toBeInTheDocument();
  const anil = screen.getByRole("article", { name: "Anil Kumar" });
  expect(within(anil).getByText("60.00%")).toBeInTheDocument();
  expect(within(anil).getByText("60,000.00")).toBeInTheDocument();
  expect(within(anil).getByText("AED 50,000.00")).toBeInTheDocument(); // opening capital
  expect(within(anil).getByText("+ AED 10,000.00")).toBeInTheDocument();
  expect(within(anil).getByText("20 Nov 2026")).toBeInTheDocument();
});

it("lists the capital movements with a sign and a word for each, and the net total", async () => {
  render(<PartnersPage />);
  const row = (await screen.findByText("CAP-000001")).closest("li")!;
  expect(within(row).getByText("Capital added")).toBeInTheDocument();
  expect(within(row).getByText(/added capital/)).toBeInTheDocument();
  expect(screen.getByText(/Net in this list/)).toHaveTextContent("AED 10,000.00");
});

it("filters the movements by partner and can show voided ones", async () => {
  render(<PartnersPage />);
  await screen.findByText("CAP-000001");
  await userEvent.selectOptions(screen.getByLabelText("Partner"), "2");
  await waitFor(() => expect(financeApi.listFinCapital).toHaveBeenLastCalledWith({ partnerId: 2, includeVoided: false }));
  await userEvent.click(screen.getByLabelText("Show voided entries"));
  await waitFor(() => expect(financeApi.listFinCapital).toHaveBeenLastCalledWith({ partnerId: 2, includeVoided: true }));
});

it("adds capital for a partner with an amount, an account and a date", async () => {
  vi.mocked(financeApi.addFinCapital).mockResolvedValue({ ...movement, id: 6, entryNo: "CAP-000002", amount: 2500.5 });
  render(<PartnersPage />);
  await screen.findByText("CAP-000001");
  await userEvent.click(screen.getByRole("button", { name: "Add capital for Rafi Khan" }));
  await userEvent.type(screen.getByLabelText("Amount (AED)"), "2500.50");
  await userEvent.selectOptions(screen.getByLabelText("Paid into"), "1");
  await userEvent.click(screen.getByRole("button", { name: "Save capital" }));
  await waitFor(() => expect(financeApi.addFinCapital).toHaveBeenCalledWith("Capital", expect.objectContaining({ partnerId: 2, accountId: 1, amount: 2500.5, files: [] })));
  expect(await screen.findByText(/CAP-000002/)).toBeInTheDocument();
});

it("refuses an empty capital form without calling the server", async () => {
  render(<PartnersPage />);
  await screen.findByText("CAP-000001");
  await userEvent.click(screen.getByRole("button", { name: "Add capital" }));
  await userEvent.click(screen.getByRole("button", { name: "Save capital" }));
  expect(await screen.findByText(/amount above zero/i)).toBeInTheDocument();
  expect(screen.getByText("Choose the partner.")).toBeInTheDocument();
  expect(financeApi.addFinCapital).not.toHaveBeenCalled();
});

it("returns capital with its own wording", async () => {
  render(<PartnersPage />);
  await screen.findByText("CAP-000001");
  await userEvent.click(screen.getByRole("button", { name: "Return capital" }));
  expect(screen.getByLabelText("Paid from")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save return" })).toBeInTheDocument();
});

it("voids a movement with a reason", async () => {
  vi.mocked(financeApi.voidFinCapital).mockResolvedValue({ ...movement, status: "Voided" });
  render(<PartnersPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Void CAP-000001" }));
  await userEvent.type(screen.getByLabelText(/reason/i), "Entered twice");
  await userEvent.click(screen.getByRole("button", { name: "Void" }));
  await waitFor(() => expect(financeApi.voidFinCapital).toHaveBeenCalledWith(5, "Entered twice"));
});

it("adds a partner with an opening capital", async () => {
  vi.mocked(financeApi.createFinPartner).mockResolvedValue({ ...partners.partners[0], id: 9, name: "New Partner" });
  render(<PartnersPage />);
  await screen.findByText("CAP-000001");
  await userEvent.click(screen.getByRole("button", { name: "Add partner" }));
  await userEvent.type(screen.getByLabelText("Partner name"), "New Partner");
  await userEvent.clear(screen.getByLabelText("Opening capital (AED)"));
  await userEvent.type(screen.getByLabelText("Opening capital (AED)"), "12000");
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add partner" }));
  await waitFor(() => expect(financeApi.createFinPartner).toHaveBeenCalledWith({ name: "New Partner", openingCapital: 12000, isActive: true }));
});

it("is read-only for a Partner (Viewer): every figure, no buttons that change anything", async () => {
  signIn("Viewer");
  render(<PartnersPage />);
  expect(await screen.findByRole("article", { name: "Rafi Khan" })).toBeInTheDocument();
  expect(screen.getByText("CAP-000001")).toBeInTheDocument();
  for (const name of [/add capital/i, /return capital/i, /add partner/i, /edit/i, /correct/i, /^void/i]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  expect(financeApi.listFinAccounts).not.toHaveBeenCalled();
});

it("shows an empty state with a first-partner button, and an error with retry", async () => {
  vi.mocked(financeApi.listFinPartners).mockResolvedValueOnce({ partners: [], totalCapital: 0 });
  const { unmount } = render(<PartnersPage />);
  expect(await screen.findByText("No partners yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add the first partner" })).toBeInTheDocument();
  unmount();

  vi.mocked(financeApi.listFinPartners).mockRejectedValueOnce(new ApiError(500, "Server error"));
  render(<PartnersPage />);
  expect(await screen.findByText(/server error/i)).toBeInTheDocument();
});
