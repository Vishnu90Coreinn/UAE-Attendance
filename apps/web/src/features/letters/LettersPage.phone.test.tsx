import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as requestsApi from "../../api/certificateRequests";
import type { CertificateRequest } from "../../api/certificateRequests";
import * as lettersApi from "../../api/letters";
import type { LetterSummary } from "../../api/letters";
import * as workersApi from "../../api/workers";
import { useAuth } from "../../contexts/AuthContext";
import { mockViewport, restoreViewport } from "../../test-viewport";
import { LettersPage } from "./LettersPage";

vi.mock("../../api/letters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/letters")>();
  return { ...actual, previewLetter: vi.fn(), listLetters: vi.fn(), getLetter: vi.fn(), getLetterPdf: vi.fn(), getLetterImage: vi.fn() };
});
vi.mock("../../api/certificateRequests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/certificateRequests")>();
  return { ...actual, createRequest: vi.fn(), listRequests: vi.fn(), getRequest: vi.fn(), approveRequest: vi.fn(), rejectRequest: vi.fn() };
});
vi.mock("../../api/workers");
vi.mock("../../api/documentSettings", () => ({ getDocumentSettings: vi.fn() }));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../payroll/downloadPdf", () => ({ saveBlob: vi.fn() }));

const base: CertificateRequest = {
  id: 1, workerId: 4, workerName: "Sajid Mahmood", workerCode: "EMP-004", letterType: "Salary", reason: "Bank loan", status: "Requested",
  requestedBy: "sup.omar", requestedUtc: "2026-11-10T08:00:00Z", preparedBy: null, preparedUtc: null, reviewedBy: null, reviewedUtc: null,
  reviewNote: "", hasDetails: false, letterId: null, refNo: null,
};
const requested: CertificateRequest = { ...base, id: 1 };
const pending: CertificateRequest = { ...base, id: 2, workerName: "Bilal Raza", workerCode: "EMP-005", status: "PendingApproval", hasDetails: true, preparedBy: "hr.amal" };
const returned: CertificateRequest = { ...base, id: 3, workerName: "Zaid Ali", workerCode: "EMP-006", status: "Returned", reviewedBy: "manager1", reviewNote: "Addressee is wrong" };
const approved: CertificateRequest = { ...base, id: 4, workerName: "Nadia Hamid", workerCode: "EMP-007", status: "Approved", reviewedBy: "manager1", letterId: 11, refNo: "DEAKS/HR/2026/0001" };
const summary: LetterSummary = {
  id: 11, refNo: "DEAKS/HR/2026/0001", letterType: "Salary", workerId: 4, workerName: "Sajid Mahmood", workerCode: "EMP-004",
  issueDate: "2026-11-10", addressedTo: "To Whom It May Concern", issuedBy: "manager1", issuedUtc: "2026-11-10T08:00:00Z",
};

type Role = "Administrator" | "Manager" | "Supervisor" | "HR" | "Viewer";
function signIn(role: Role, username = "someone") {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username, role }, token: "t", login: vi.fn(), logout: vi.fn() });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockViewport("phone");
  vi.mocked(workersApi.listWorkers).mockResolvedValue([
    { id: 4, workerCode: "EMP-004", fullName: "Sajid Mahmood", designation: "Supervisor", hourlyRate: null, overtimeRate: null, effectiveOvertimeRate: null, isActive: true },
    { id: 5, workerCode: "EMP-005", fullName: "Bilal Raza", designation: "Installer", hourlyRate: null, overtimeRate: null, effectiveOvertimeRate: null, isActive: true },
  ]);
  vi.mocked(lettersApi.listLetters).mockResolvedValue([summary]);
  vi.mocked(requestsApi.listRequests).mockResolvedValue([approved, requested, pending, returned]);
  signIn("HR");
});
afterEach(restoreViewport);

async function loaded() {
  const user = userEvent.setup();
  render(<LettersPage />);
  await screen.findByRole("list", { name: "Requests" });
  return user;
}
const card = (name: string) => screen.getByRole("listitem", { name: new RegExp(name) });

describe("HR Letters on a phone", () => {
  it("shows each request as a card, open ones before finished ones, with where it stands in plain words", async () => {
    const user = await loaded();
    await user.click(screen.getByRole("button", { name: /^All/ }));

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const names = screen.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"));
    expect(names[names.length - 1]).toMatch(/Nadia Hamid/);
    expect(within(card("Bilal Raza")).getByText("With manager")).toBeInTheDocument();
    expect(within(card("Sajid Mahmood")).getByText("With HR")).toBeInTheDocument();
    expect(within(card("Nadia Hamid")).getByText("Approved")).toBeInTheDocument();
    expect(within(card("Zaid Ali")).getByText(/Sent back by manager1: Addressee is wrong/)).toBeInTheDocument();
  });

  it("starts HR on what needs them, and gives it a filled Prepare button", async () => {
    await loaded();

    expect(screen.getByRole("button", { name: /^Needs me\s*2/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(within(card("Sajid Mahmood")).getByRole("button", { name: "Open request for Sajid Mahmood" })).toHaveTextContent("Prepare");
    expect(within(card("Zaid Ali")).getByRole("button", { name: "Open request for Zaid Ali" })).toHaveTextContent("Prepare");
  });

  it("starts a Manager on the requests waiting for approval, labelled Review", async () => {
    signIn("Manager", "manager1");
    await loaded();

    expect(screen.getByRole("button", { name: /^Needs me/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(card("Bilal Raza")).getByRole("button", { name: "Open request for Bilal Raza" })).toHaveTextContent("Review");
  });

  it("narrows with the chips and offers a PDF on an approved request", async () => {
    const user = await loaded();

    await user.click(screen.getByRole("button", { name: /^Approved/ }));

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(within(card("Nadia Hamid")).getByRole("button", { name: "Download PDF DEAKS/HR/2026/0001" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("tells a Supervisor where each of their requests is, with no way to open one", async () => {
    signIn("Supervisor", "sup.omar");
    await loaded();

    expect(screen.queryByRole("button", { name: /^Needs me/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^In progress/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Open request/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Approved letters" })).not.toBeInTheDocument();
    expect(within(card("Sajid Mahmood")).getByText(/by you/)).toBeInTheDocument();
  });

  it("opens the request sheet from the floating button, with no certificate chosen for you", async () => {
    signIn("Supervisor", "sup.omar");
    vi.mocked(requestsApi.createRequest).mockResolvedValue({ ...requested, id: 9, workerName: "Bilal Raza" });
    const user = await loaded();

    await user.click(screen.getByRole("button", { name: "Request letter" }));
    const sheet = await screen.findByRole("dialog", { name: "Request a certificate" });
    for (const button of within(sheet).getAllByRole("button", { name: /Certificate|Transfer|Concern/ })) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }

    await user.click(within(sheet).getByRole("button", { name: "Send request" }));
    expect(within(sheet).getByText("Choose a worker.")).toBeInTheDocument();
    expect(within(sheet).getByText("Choose a certificate.")).toBeInTheDocument();
    expect(requestsApi.createRequest).not.toHaveBeenCalled();

    await user.type(await within(sheet).findByLabelText("Search workers"), "bil");
    await user.click(within(sheet).getByRole("button", { name: /Bilal Raza/ }));
    await user.click(within(sheet).getByRole("button", { name: "Service Certificate" }));
    await user.type(within(sheet).getByLabelText(/What is it for/), "Visa renewal");
    await user.click(within(sheet).getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(requestsApi.createRequest).toHaveBeenCalledWith({ workerId: 5, letterType: "Service", reason: "Visa renewal" }));
    expect(await screen.findByText("Request sent to HR for Bilal Raza.")).toBeInTheDocument();
  });

  it("keeps Approve and Send back in a bar that stays in view while a manager reads the letter", async () => {
    signIn("Manager", "manager1");
    vi.mocked(requestsApi.getRequest).mockResolvedValue({
      request: pending,
      details: null,
      document: {
        hasLogo: false, hasSeal: false, hasSignature: false,
        content: {
          letterType: "Salary", title: "SALARY CERTIFICATE", issueDate: "2026-11-10", refNo: "", addressedTo: "To Whom It May Concern",
          companyName: "Co", address1: "", address2: "", mobile: "", email: "", workerName: "Bilal Raza", workerCode: "EMP-005", designation: "Installer",
          paragraphs: [], salary: null, purposeNote: "", signerName: "", signerTitle: "", showSeal: false,
        },
      },
    });
    const user = await loaded();

    await user.click(within(card("Bilal Raza")).getByRole("button", { name: "Open request for Bilal Raza" }));

    const approve = await screen.findByRole("button", { name: "Approve" });
    const sheet = screen.getByText("SALARY CERTIFICATE");
    expect(sheet.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send back" })).toBeInTheDocument();
  });

  it("shows approved letters as cards with Open and PDF, and filters them by type chip", async () => {
    const user = await loaded();
    await user.click(screen.getByRole("tab", { name: "Approved letters" }));

    const list = await screen.findByRole("list", { name: "Approved letters" });
    expect(within(list).getByText("DEAKS/HR/2026/0001")).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Open DEAKS/HR/2026/0001" })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Download PDF DEAKS/HR/2026/0001" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Service Certificate" }));
    await waitFor(() => expect(lettersApi.listLetters).toHaveBeenLastCalledWith(expect.objectContaining({ type: "Service" })));
  });
});
