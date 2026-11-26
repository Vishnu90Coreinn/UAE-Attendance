import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as financeApi from "../../api/finance";
import * as invoicesApi from "../../api/invoices";
import type { Invoice } from "../../api/invoices";
import { InvoiceView } from "./InvoiceView";

vi.mock("../../api/invoices");
vi.mock("../../api/finance");
vi.mock("../../api/documentSettings");
vi.mock("../../api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../api/client")>()), apiGetFile: vi.fn().mockRejectedValue(new Error("no logo")) }));

const invoice: Invoice = {
  id: 7, number: "INV-000185", status: "Issued", displayStatus: "Issued", isOverdue: false, clientId: null, clientName: "Acme Glass LLC",
  clientTrn: "100", clientAddress: "Dubai", invoiceDate: "2026-11-01", dueDate: "2026-11-30", paymentTerms: "Net 30", lpoRef: "LPO-1",
  project: "Twilight", scope: "INSTALLATION", notes: "",
  lines: [{ lineNo: 1, description: "Aluminium works", quantity: 1, rate: 100, taxable: 100, vat: 5, amount: 105 }],
  payments: [{ id: 1, paidDate: "2026-11-10", amount: 20, method: "Cash", reference: "", recordedBy: "mgr", inBooks: false }],
  subTotal: 100, vatTotal: 5, total: 105, amountPaid: 20, balanceDue: 85, totalInWords: "x",
  company: { companyName: "DE AKS BE", companySubtitle: "", companyNameAr: "", mobile: "", address1: "", address2: "", email: "", trn: "", bankName: "", accountName: "", accountNumber: "", iban: "", hasLogo: false, hasSeal: false },
  createdBy: "mgr", issuedUtc: null, issuedBy: null, cancelledUtc: null, cancelReason: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(financeApi.listFinAccounts).mockResolvedValue([
    { id: 3, name: "RAKBANK Current Account", kind: "Bank", isActive: true },
    { id: 4, name: "Main cash", kind: "Cash", isActive: true },
    { id: 5, name: "Old account", kind: "Bank", isActive: false },
  ] as financeApi.FinAccount[]);
  vi.mocked(invoicesApi.addPayment).mockResolvedValue({ ...invoice, amountPaid: 105, balanceDue: 0 });
});

it("asks which bank or cash account the money went into, and sends it with the payment", async () => {
  render(<InvoiceView invoice={invoice} canWrite onChanged={() => {}} onEdit={() => {}} onDeleted={() => {}} onOpen={() => {}} />);

  await userEvent.click(screen.getByRole("button", { name: "Record payment" }));
  const account = await screen.findByLabelText("Paid into");
  expect(screen.queryByRole("option", { name: "Old account" })).not.toBeInTheDocument();    // a switched-off account is not offered
  await userEvent.selectOptions(account, "4");
  await userEvent.click(screen.getByRole("button", { name: "Save payment" }));

  await waitFor(() => expect(invoicesApi.addPayment).toHaveBeenCalledWith(7, expect.objectContaining({ amount: 85, accountId: 4 })));
});

it("marks a payment entered before invoices were tied to the books", () => {
  render(<InvoiceView invoice={invoice} canWrite onChanged={() => {}} onEdit={() => {}} onDeleted={() => {}} onOpen={() => {}} />);
  expect(screen.getByText("Not in the books")).toBeInTheDocument();
});

it("requires an explicit receiving account instead of silently selecting the first account", async () => {
  render(<InvoiceView invoice={invoice} canWrite onChanged={() => {}} onEdit={() => {}} onDeleted={() => {}} onOpen={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Record payment" }));
  await screen.findByRole("option", { name: "RAKBANK Current Account" });
  expect(screen.getByLabelText("Paid into")).toHaveValue("");
  await userEvent.click(screen.getByRole("button", { name: "Save payment" }));
  expect(await screen.findByText("Choose the account the money went into.")).toBeInTheDocument();
  expect(invoicesApi.addPayment).not.toHaveBeenCalled();
});

it("blocks saving when receiving accounts cannot be loaded", async () => {
  vi.mocked(financeApi.listFinAccounts).mockRejectedValue(new Error("offline"));
  render(<InvoiceView invoice={invoice} canWrite onChanged={() => {}} onEdit={() => {}} onDeleted={() => {}} onOpen={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Record payment" }));
  expect(await screen.findByText(/Accounts could not be loaded/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save payment" })).toBeDisabled();
  expect(invoicesApi.addPayment).not.toHaveBeenCalled();
});
