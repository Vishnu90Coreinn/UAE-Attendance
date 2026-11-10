import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as invoicesApi from "../../api/invoices";
import * as settingsApi from "../../api/documentSettings";
import type { Invoice, InvoiceSummary } from "../../api/invoices";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { InvoicesPage } from "./InvoicesPage";

vi.mock("../../api/invoices");
vi.mock("../../api/documentSettings");
vi.mock("../../api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../api/client")>()), apiGetFile: vi.fn().mockRejectedValue(new Error("no logo")) }));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const summary: InvoiceSummary = {
  id: 7, number: "INV-000185", status: "Issued", displayStatus: "PartPaid", isOverdue: true, clientName: "Acme Glass LLC",
  project: "Twilight", lpoRef: "LPO-1", invoiceDate: "2026-11-01", dueDate: "2026-11-30", total: 105, amountPaid: 50, balanceDue: 55,
};

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 7, number: "INV-000185", status: "Issued", displayStatus: "Issued", isOverdue: false, clientId: null, clientName: "Acme Glass LLC",
    clientTrn: "100", clientAddress: "Dubai", invoiceDate: "2026-11-01", dueDate: "2026-11-30", paymentTerms: "Net 30", lpoRef: "LPO-1",
    project: "Twilight", scope: "INSTALLATION", notes: "Thanks",
    lines: [{ lineNo: 1, description: "Aluminium works", quantity: 1, rate: 100, taxable: 100, vat: 5, amount: 105 }],
    payments: [], subTotal: 100, vatTotal: 5, total: 105, amountPaid: 0, balanceDue: 105,
    totalInWords: "UAE Dirham One Hundred Five",
    company: { companyName: "DE AKS BE", companySubtitle: "", companyNameAr: "", mobile: "", address1: "", address2: "", email: "", trn: "", bankName: "ADCB", accountName: "", accountNumber: "", iban: "", hasLogo: false },
    createdBy: "mgr", issuedUtc: null, issuedBy: null, cancelledUtc: null, cancelReason: null,
    ...overrides,
  };
}

function signIn(role: "Manager" | "HR") {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "u", role }, token: "t", login: vi.fn(), logout: vi.fn() });
}

beforeEach(() => {
  vi.resetAllMocks();
  signIn("Manager");
  vi.mocked(invoicesApi.listInvoices).mockResolvedValue([summary]);
  vi.mocked(invoicesApi.listInvoiceClients).mockResolvedValue([]);
  vi.mocked(invoicesApi.getInvoice).mockResolvedValue(invoice());
  vi.mocked(settingsApi.getDocumentSettings).mockResolvedValue({
    companyName: "DE AKS BE", companySubtitle: "", companyNameAr: "", mobile: "", address1: "", address2: "", email: "", trn: "", bankName: "",
    accountName: "", accountNumber: "", iban: "", defaultPaymentTerms: "Due on Receipt", defaultInvoiceNotes: "Thank you!", nextInvoiceNumber: 185,
    signerName: "", signerTitle: "", hasLogo: false, hasSeal: false, hasSignature: false,
  });
});

describe("InvoicesPage list", () => {
  it("shows invoices with a status word and an overdue flag, not colour alone", async () => {
    render(<InvoicesPage />);
    const row = (await screen.findByRole("button", { name: /INV-000185/ })).closest("tr")!;
    expect(within(row).getByText("Part-paid")).toBeInTheDocument();
    expect(within(row).getByText("Overdue")).toBeInTheDocument();
    expect(within(row).getByText("55.00")).toBeInTheDocument();
  });

  it("offers New invoice to a Manager but not to HR", async () => {
    const { unmount } = render(<InvoicesPage />);
    expect(await screen.findByRole("button", { name: "New invoice" })).toBeInTheDocument();
    unmount();
    signIn("HR");
    render(<InvoicesPage />);
    await screen.findByRole("button", { name: /INV-000185/ });
    expect(screen.queryByRole("button", { name: "New invoice" })).not.toBeInTheDocument();
  });

  it("sends the chosen status to the server", async () => {
    const user = userEvent.setup();
    render(<InvoicesPage />);
    await screen.findByRole("button", { name: /INV-000185/ });
    await user.selectOptions(screen.getByLabelText("Status"), "Overdue");
    await waitFor(() => expect(invoicesApi.listInvoices).toHaveBeenLastCalledWith({ status: "Overdue" }));
  });

  it("shows an empty state, and an error with Retry", async () => {
    vi.mocked(invoicesApi.listInvoices).mockResolvedValueOnce([]);
    const { unmount } = render(<InvoicesPage />);
    expect(await screen.findByText("No invoices found")).toBeInTheDocument();
    unmount();
    vi.mocked(invoicesApi.listInvoices).mockRejectedValueOnce(new ApiError(500, "Server down"));
    render(<InvoicesPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Server down");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("invoice view", () => {
  it("shows the document and only the actions that fit an issued invoice", async () => {
    const user = userEvent.setup();
    render(<InvoicesPage />);
    await user.click(await screen.findByRole("button", { name: /INV-000185/ }));
    expect(await screen.findByRole("article", { name: "Tax invoice INV-000185" })).toBeInTheDocument();
    expect(screen.getByText("UAE Dirham One Hundred Five")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record payment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel invoice" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Issue invoice" })).not.toBeInTheDocument();
  });

  it("gives HR the document, print and PDF but no write actions", async () => {
    signIn("HR");
    const user = userEvent.setup();
    render(<InvoicesPage />);
    await user.click(await screen.findByRole("button", { name: /INV-000185/ }));
    expect(await screen.findByRole("button", { name: "Download PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print" })).not.toBeInTheDocument();
    for (const name of ["Record payment", "Cancel invoice", "Duplicate", "Edit", "Issue invoice"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("asks before issuing a draft and then shows the new number", async () => {
    vi.mocked(invoicesApi.getInvoice).mockResolvedValue(invoice({ number: null, status: "Draft", displayStatus: "Draft" }));
    vi.mocked(invoicesApi.issueInvoice).mockResolvedValue(invoice({ number: "INV-000185" }));
    const user = userEvent.setup();
    render(<InvoicesPage />);
    await user.click(await screen.findByRole("button", { name: /INV-000185/ }));
    await user.click(await screen.findByRole("button", { name: "Issue invoice" }));
    const dialog = await screen.findByRole("dialog", { name: "Issue this invoice?" });
    expect(invoicesApi.issueInvoice).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Issue invoice" }));
    await waitFor(() => expect(invoicesApi.issueInvoice).toHaveBeenCalledWith(7));
    expect(await screen.findByText("Invoice issued.")).toBeInTheDocument();
  });

  it("refuses a payment above the balance without calling the server", async () => {
    const user = userEvent.setup();
    render(<InvoicesPage />);
    await user.click(await screen.findByRole("button", { name: /INV-000185/ }));
    await user.click(await screen.findByRole("button", { name: "Record payment" }));
    const dialog = await screen.findByRole("dialog", { name: "Record payment" });
    const amount = within(dialog).getByLabelText("Amount (AED)");
    await user.clear(amount);
    await user.type(amount, "200");
    await user.click(within(dialog).getByRole("button", { name: "Save payment" }));
    expect(await within(dialog).findByText(/more than the balance due/)).toBeInTheDocument();
    expect(invoicesApi.addPayment).not.toHaveBeenCalled();
  });

  it("needs a reason to cancel", async () => {
    const user = userEvent.setup();
    render(<InvoicesPage />);
    await user.click(await screen.findByRole("button", { name: /INV-000185/ }));
    await user.click(await screen.findByRole("button", { name: "Cancel invoice" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel this invoice?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel invoice" }));
    expect(await within(dialog).findByText("Enter the reason for cancelling.")).toBeInTheDocument();
    expect(invoicesApi.cancelInvoice).not.toHaveBeenCalled();
  });
});

describe("new invoice form", () => {
  it("validates before sending and shows the totals preview", async () => {
    const user = userEvent.setup();
    render(<InvoicesPage />);
    await user.click(await screen.findByRole("button", { name: "New invoice" }));
    await user.click(await screen.findByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Choose or enter the client.")).toBeInTheDocument();
    expect(screen.getByText("Enter a description.")).toBeInTheDocument();
    expect(invoicesApi.createInvoice).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Description, line 1"), "Works");
    const qty = screen.getByLabelText("Quantity, line 1");
    const rate = screen.getByLabelText("Rate, line 1");
    await user.clear(qty);
    await user.type(qty, "572.51");
    await user.clear(rate);
    await user.type(rate, "105");
    const totals = screen.getByLabelText("Totals preview");
    expect(totals).toHaveTextContent("63,119.23");
  });

  it("sends the typed invoice and opens it", async () => {
    vi.mocked(invoicesApi.createInvoice).mockResolvedValue(invoice({ number: null, status: "Draft", displayStatus: "Draft" }));
    const user = userEvent.setup();
    render(<InvoicesPage />);
    await user.click(await screen.findByRole("button", { name: "New invoice" }));
    await user.type(await screen.findByLabelText("Client name"), "Acme Glass LLC");
    await user.type(screen.getByLabelText("Description, line 1"), "Works");
    const rate = screen.getByLabelText("Rate, line 1");
    await user.clear(rate);
    await user.type(rate, "100");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(invoicesApi.createInvoice).toHaveBeenCalled());
    const body = vi.mocked(invoicesApi.createInvoice).mock.calls[0][0];
    expect(body.clientName).toBe("Acme Glass LLC");
    expect(body.lines).toEqual([{ description: "Works", quantity: 1, rate: 100 }]);
    expect(await screen.findByRole("button", { name: "Issue invoice" })).toBeInTheDocument();
  });

  it("shows a server field error next to the field", async () => {
    vi.mocked(invoicesApi.createInvoice).mockRejectedValue(new ApiError(400, "bad", undefined, undefined, { dueDate: ["The due date cannot be before the invoice date."] }));
    const user = userEvent.setup();
    render(<InvoicesPage />);
    await user.click(await screen.findByRole("button", { name: "New invoice" }));
    await user.type(await screen.findByLabelText("Client name"), "Acme");
    await user.type(screen.getByLabelText("Description, line 1"), "Works");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("The due date cannot be before the invoice date.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Please fix the highlighted fields.");
  });
});
