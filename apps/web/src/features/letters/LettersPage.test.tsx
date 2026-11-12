import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import * as requestsApi from "../../api/certificateRequests";
import type { CertificateRequest, CertificateRequestDetail } from "../../api/certificateRequests";
import * as lettersApi from "../../api/letters";
import type { LetterDocument, LetterRecord, LetterSummary } from "../../api/letters";
import { getDocumentSettings } from "../../api/documentSettings";
import * as workersApi from "../../api/workers";
import type { Worker } from "../../api/workers";
import { useAuth } from "../../contexts/AuthContext";
import { LettersPage } from "./LettersPage";

vi.mock("../../api/letters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/letters")>();
  return { ...actual, previewLetter: vi.fn(), listLetters: vi.fn(), getLetter: vi.fn(), getLetterPdf: vi.fn(), getLetterImage: vi.fn() };
});
vi.mock("../../api/certificateRequests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/certificateRequests")>();
  return {
    ...actual,
    createRequest: vi.fn(),
    listRequests: vi.fn(),
    getRequest: vi.fn(),
    saveDetails: vi.fn(),
    submitRequest: vi.fn(),
    approveRequest: vi.fn(),
    rejectRequest: vi.fn(),
  };
});
vi.mock("../../api/workers");
vi.mock("../../api/documentSettings", () => ({ getDocumentSettings: vi.fn() }));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../payroll/downloadPdf", () => ({ saveBlob: vi.fn() }));

const worker: Worker = {
  id: 4, workerCode: "EMP-004", fullName: "Sajid Mahmood", designation: "Supervisor", hourlyRate: 6.67, overtimeRate: null,
  effectiveOvertimeRate: 2.22, isActive: true, bankName: "Emirates NBD", bankAccountNumber: "0129", iban: "AE03",
};

function documentFor(refNo: string, title = "SALARY CERTIFICATE"): LetterDocument {
  return {
    hasLogo: false, hasSeal: false, hasSignature: false,
    content: {
      letterType: "Salary", title, issueDate: "2026-11-10", refNo, addressedTo: "To Whom It May Concern",
      companyName: "DE AKS BE GLASS & ALUMINIUM", address1: "Um Hurair Second", address2: "Dubai", mobile: "+971557884821", email: "hr@example.com",
      workerName: "Sajid Mahmood", workerCode: "EMP-004", designation: "Supervisor",
      paragraphs: [[{ text: "This is to certify that ", bold: false }, { text: "Mr. Sajid Mahmood", bold: true }, { text: ".", bold: false }]],
      salary: { basic: 1600, housing: 800, transport: 400, other: 200, total: 3000 },
      purposeNote: "Issued on request.", signerName: "Eng. Signer", signerTitle: "General Manager", showSeal: true,
    },
  };
}

const record: LetterRecord = {
  id: 11, refNo: "DEAKS/HR/2026/0001", letterType: "Salary", workerId: 4, issueDate: "2026-11-10", issuedBy: "manager1",
  issuedUtc: "2026-11-10T08:00:00Z", document: documentFor("DEAKS/HR/2026/0001"),
};
const summary: LetterSummary = {
  id: 11, refNo: "DEAKS/HR/2026/0001", letterType: "Salary", workerId: 4, workerName: "Sajid Mahmood", workerCode: "EMP-004",
  issueDate: "2026-11-10", addressedTo: "To Whom It May Concern", issuedBy: "manager1", issuedUtc: "2026-11-10T08:00:00Z",
};

const requested: CertificateRequest = {
  id: 7, workerId: 4, workerName: "Sajid Mahmood", workerCode: "EMP-004", letterType: "Salary", reason: "Bank loan", status: "Requested",
  requestedBy: "sup.omar", requestedUtc: "2026-11-10T08:00:00Z", preparedBy: null, preparedUtc: null, reviewedBy: null, reviewedUtc: null,
  reviewNote: "", hasDetails: false, letterId: null, refNo: null,
};
const pending: CertificateRequest = { ...requested, status: "PendingApproval", hasDetails: true, preparedBy: "hr.amal" };
const approved: CertificateRequest = { ...pending, status: "Approved", reviewedBy: "manager1", letterId: 11, refNo: "DEAKS/HR/2026/0001" };
const returned: CertificateRequest = { ...pending, status: "Returned", reviewedBy: "manager1", reviewNote: "Addressee is wrong" };

function detailOf(request: CertificateRequest, document: LetterDocument | null = null): CertificateRequestDetail {
  return { request, details: null, document };
}

function signIn(role: "Administrator" | "Manager" | "Supervisor" | "HR" | "Viewer") {
  vi.mocked(useAuth).mockReturnValue({ status: "signedIn", user: { id: 1, username: "someone", role }, token: "t", login: vi.fn(), logout: vi.fn() });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(workersApi.listWorkers).mockResolvedValue([worker]);
  vi.mocked(getDocumentSettings).mockRejectedValue(new Error("none"));
  vi.mocked(lettersApi.previewLetter).mockResolvedValue(documentFor(""));
  vi.mocked(lettersApi.listLetters).mockResolvedValue([summary]);
  vi.mocked(lettersApi.getLetterImage).mockRejectedValue(new Error("none"));
  vi.mocked(requestsApi.listRequests).mockResolvedValue([requested]);
  signIn("HR");
});

describe("a supervisor raising a request", () => {
  it("sees only their requests, can ask for a certificate, and has no way to open or download one", async () => {
    signIn("Supervisor");
    vi.mocked(requestsApi.listRequests).mockResolvedValue([approved]);
    vi.mocked(requestsApi.createRequest).mockResolvedValue(requested);
    const user = userEvent.setup();
    render(<LettersPage />);

    expect(await screen.findByText("DEAKS/HR/2026/0001")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open request/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download PDF/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New request" }));
    const dialog = await screen.findByRole("dialog", { name: "Request a certificate" });
    await user.selectOptions(await within(dialog).findByLabelText("Worker"), "Sajid Mahmood (EMP-004)");
    await user.selectOptions(within(dialog).getByLabelText("Certificate"), "Noc");
    await user.type(within(dialog).getByLabelText(/What is it for/), "Visa renewal");
    await user.click(within(dialog).getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(requestsApi.createRequest).toHaveBeenCalledWith({ workerId: 4, letterType: "Noc", reason: "Visa renewal" }));
    expect(await screen.findByText("Request sent to HR for Sajid Mahmood.")).toBeInTheDocument();
  });

  it("must choose a worker", async () => {
    signIn("Supervisor");
    const user = userEvent.setup();
    render(<LettersPage />);
    await user.click(await screen.findByRole("button", { name: "New request" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Send request" }));

    expect(await within(dialog).findByText("Choose a worker.")).toBeInTheDocument();
    expect(requestsApi.createRequest).not.toHaveBeenCalled();
  });

  it("HR cannot raise a request", async () => {
    render(<LettersPage />);

    expect(await screen.findByText("Sajid Mahmood")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New request" })).not.toBeInTheDocument();
  });
});

describe("a viewer", () => {
  it("sees the requests and approved letters but cannot raise, prepare, approve or send back", async () => {
    signIn("Viewer");
    vi.mocked(requestsApi.listRequests).mockResolvedValue([pending]);
    vi.mocked(requestsApi.getRequest).mockResolvedValue(detailOf(pending, documentFor("")));
    const user = userEvent.setup();
    render(<LettersPage />);

    expect(await screen.findByText("Sajid Mahmood")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New request" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Approved letters" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open request for Sajid Mahmood" }));
    expect(await screen.findByRole("article", { name: "SALARY CERTIFICATE preview" })).toBeInTheDocument();
    for (const name of ["Approve", "Send back", "Save details", "Send for approval"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});

describe("HR preparing a request", () => {
  it("shows the request, the letter as it will print, and saves or sends the details", async () => {
    vi.mocked(requestsApi.getRequest).mockResolvedValue(detailOf(requested));
    vi.mocked(requestsApi.saveDetails).mockResolvedValue(requested);
    vi.mocked(requestsApi.submitRequest).mockResolvedValue(pending);
    const user = userEvent.setup();
    render(<LettersPage />);

    await user.click(await screen.findByRole("button", { name: "Open request for Sajid Mahmood" }));

    expect(await screen.findByText(/Requested by sup.omar: Bank loan/)).toBeInTheDocument();
    const sheet = await screen.findByRole("article", { name: "SALARY CERTIFICATE preview" });
    expect(within(sheet).getByText("Mr. Sajid Mahmood")).toBeInTheDocument();
    expect(screen.queryByLabelText("Worker")).not.toBeInTheDocument();
    expect(lettersApi.previewLetter).toHaveBeenLastCalledWith(expect.objectContaining({ workerId: 4, letterType: "Salary" }), expect.anything());

    await user.type(screen.getByLabelText("Addressed to"), "The Branch Manager");
    await user.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(requestsApi.saveDetails).toHaveBeenCalledWith(7, expect.objectContaining({ addressedTo: "The Branch Manager", workerId: 4 })));
    expect(requestsApi.submitRequest).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Send for approval" }));
    await waitFor(() => expect(requestsApi.submitRequest).toHaveBeenCalledWith(7));
    expect(await screen.findByText("Sent to the manager for approval.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save details" })).not.toBeInTheDocument();
  });

  it("shows the manager's reason when a request was sent back", async () => {
    vi.mocked(requestsApi.listRequests).mockResolvedValue([returned]);
    vi.mocked(requestsApi.getRequest).mockResolvedValue(detailOf(returned));
    const user = userEvent.setup();
    render(<LettersPage />);

    await user.click(await screen.findByRole("button", { name: "Open request for Sajid Mahmood" }));

    expect(await screen.findByText(/Sent back by manager1: Addressee is wrong/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send for approval" })).toBeInTheDocument();
  });

  it("shows the server's field messages instead of a preview and keeps the request with HR", async () => {
    vi.mocked(requestsApi.getRequest).mockResolvedValue(detailOf(requested));
    vi.mocked(lettersApi.previewLetter).mockRejectedValue(
      new ApiError(400, "Enter the signatory name.", undefined, undefined, { signerName: ["Enter the signatory name."] }),
    );
    const user = userEvent.setup();
    render(<LettersPage />);

    await user.click(await screen.findByRole("button", { name: "Open request for Sajid Mahmood" }));

    await waitFor(() => expect(screen.getByLabelText("Signatory name")).toHaveAttribute("aria-invalid", "true"));
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("reports a failed send and stays on the form", async () => {
    vi.mocked(requestsApi.getRequest).mockResolvedValue(detailOf(requested));
    vi.mocked(requestsApi.saveDetails).mockRejectedValue(new ApiError(409, "These details can no longer be changed."));
    const user = userEvent.setup();
    render(<LettersPage />);
    await user.click(await screen.findByRole("button", { name: "Open request for Sajid Mahmood" }));
    await screen.findByRole("article");

    await user.click(screen.getByRole("button", { name: "Send for approval" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("These details can no longer be changed.");
    expect(requestsApi.submitRequest).not.toHaveBeenCalled();
  });
});

describe("a manager approving", () => {
  beforeEach(() => {
    signIn("Manager");
    vi.mocked(requestsApi.listRequests).mockResolvedValue([pending]);
  });

  it("starts on the requests waiting for approval", async () => {
    render(<LettersPage />);

    expect(await screen.findByText("Sajid Mahmood")).toBeInTheDocument();
    expect(requestsApi.listRequests).toHaveBeenCalledWith();
    expect(screen.getByRole("button", { name: "Open request for Sajid Mahmood" })).toHaveTextContent("Review");
  });

  it("reviews the letter and approves it", async () => {
    vi.mocked(requestsApi.getRequest)
      .mockResolvedValueOnce(detailOf(pending, documentFor("")))
      .mockResolvedValue(detailOf(approved, record.document));
    vi.mocked(requestsApi.approveRequest).mockResolvedValue(approved);
    vi.mocked(lettersApi.getLetterPdf).mockResolvedValue(new Blob(["%PDF"]));
    const user = userEvent.setup();
    render(<LettersPage />);

    await user.click(await screen.findByRole("button", { name: "Open request for Sajid Mahmood" }));
    expect(await screen.findByRole("article", { name: "SALARY CERTIFICATE preview" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByText("Approved. Reference DEAKS/HR/2026/0001.")).toBeInTheDocument();
    expect(requestsApi.approveRequest).toHaveBeenCalledWith(7);
    await user.click(await screen.findByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(lettersApi.getLetterPdf).toHaveBeenCalledWith(11));
  });

  it("sends it back to HR only with a reason", async () => {
    vi.mocked(requestsApi.getRequest).mockResolvedValue(detailOf(pending, documentFor("")));
    vi.mocked(requestsApi.rejectRequest).mockResolvedValue(returned);
    const user = userEvent.setup();
    render(<LettersPage />);
    await user.click(await screen.findByRole("button", { name: "Open request for Sajid Mahmood" }));
    await screen.findByRole("article");

    await user.click(screen.getByRole("button", { name: "Send back" }));
    const dialog = await screen.findByRole("dialog", { name: "Send back to HR" });
    await user.click(within(dialog).getByRole("button", { name: "Send back to HR" }));
    expect(await within(dialog).findByText("Say what HR needs to change.")).toBeInTheDocument();
    expect(requestsApi.rejectRequest).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Reason"), "Addressee is wrong");
    await user.click(within(dialog).getByRole("button", { name: "Send back to HR" }));

    await waitFor(() => expect(requestsApi.rejectRequest).toHaveBeenCalledWith(7, "Addressee is wrong"));
    expect(await screen.findByText("The request was sent back to HR.")).toBeInTheDocument();
  });

  it("cannot approve a request that is not waiting for approval", async () => {
    vi.mocked(requestsApi.listRequests).mockResolvedValue([requested]);
    vi.mocked(requestsApi.getRequest).mockResolvedValue(detailOf(requested));
    const user = userEvent.setup();
    render(<LettersPage />);

    // A manager starts on "Awaiting approval"; this request is only "Requested", so look at all of them.
    await user.click(await screen.findByRole("button", { name: /^All/ }));
    await user.click(await screen.findByRole("button", { name: "Open request for Sajid Mahmood" }));

    expect(await screen.findByText("HR has not added the details yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("reports an approval that fails and keeps the request open", async () => {
    vi.mocked(requestsApi.getRequest).mockResolvedValue(detailOf(pending, documentFor("")));
    vi.mocked(requestsApi.approveRequest).mockRejectedValue(new ApiError(409, "This request is no longer waiting for approval."));
    const user = userEvent.setup();
    render(<LettersPage />);
    await user.click(await screen.findByRole("button", { name: "Open request for Sajid Mahmood" }));
    await screen.findByRole("article");

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer waiting for approval");
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});

describe("downloading approved certificates", () => {
  it("lets HR download an approved request's PDF, and reports a PDF that cannot be made", async () => {
    vi.mocked(requestsApi.listRequests).mockResolvedValue([approved]);
    vi.mocked(lettersApi.getLetterPdf).mockRejectedValue(new ApiError(422, "The PDF supports English text. Update names that use other scripts."));
    const user = userEvent.setup();
    render(<LettersPage />);

    await user.click(await screen.findByRole("button", { name: "Download PDF DEAKS/HR/2026/0001" }));

    expect(lettersApi.getLetterPdf).toHaveBeenCalledWith(11);
    expect(await screen.findByRole("alert")).toHaveTextContent("The PDF supports English text.");
  });

  it("does not offer a download before approval", async () => {
    vi.mocked(requestsApi.listRequests).mockResolvedValue([pending]);
    render(<LettersPage />);

    expect(await screen.findByText("Sajid Mahmood")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download PDF/ })).not.toBeInTheDocument();
  });
});

describe("HR Letters - approved letters", () => {
  beforeEach(() => signIn("Manager"));

  it("lists approved letters and filters them by search and type", async () => {
    const user = userEvent.setup();
    render(<LettersPage />);

    await user.click(screen.getByRole("tab", { name: "Approved letters" }));

    expect(await screen.findByText("DEAKS/HR/2026/0001")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search"), "Sajid");
    await user.selectOptions(screen.getByLabelText("Type"), "Noc");
    await waitFor(() => expect(lettersApi.listLetters).toHaveBeenLastCalledWith({ search: "Sajid", type: "Noc", from: "", to: "" }));
  });

  it("shows an empty state", async () => {
    vi.mocked(lettersApi.listLetters).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<LettersPage />);

    await user.click(screen.getByRole("tab", { name: "Approved letters" }));

    expect(await screen.findByText("No letters found")).toBeInTheDocument();
  });

  it("re-opens a letter exactly as stored, and goes back to the log", async () => {
    vi.mocked(lettersApi.getLetter).mockResolvedValue(record);
    const user = userEvent.setup();
    render(<LettersPage />);
    await user.click(screen.getByRole("tab", { name: "Approved letters" }));

    await user.click(await screen.findByRole("button", { name: "Open DEAKS/HR/2026/0001" }));

    const sheet = await screen.findByRole("article", { name: "SALARY CERTIFICATE preview" });
    expect(within(sheet).getByText("DEAKS/HR/2026/0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to letters" }));
    expect(await screen.findByText("DEAKS/HR/2026/0001")).toBeInTheDocument();
  });

  it("shows a load error with a retry", async () => {
    vi.mocked(lettersApi.listLetters).mockRejectedValueOnce(new ApiError(500, "Boom")).mockResolvedValue([summary]);
    const user = userEvent.setup();
    render(<LettersPage />);
    await user.click(screen.getByRole("tab", { name: "Approved letters" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("DEAKS/HR/2026/0001")).toBeInTheDocument();
  });
});

describe("status filter", () => {
  it("shows how many requests are in each status and filters by it", async () => {
    vi.mocked(requestsApi.listRequests).mockResolvedValue([requested, pending, approved]);
    const user = userEvent.setup();
    render(<LettersPage />);

    const all = await screen.findByRole("button", { name: /^All/ });
    expect(all).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /^Requested/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^Awaiting approval/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^Returned by manager/ })).toHaveTextContent("0");

    await user.click(screen.getByRole("button", { name: /^Approved/ }));
    expect(screen.getByRole("button", { name: /^Approved/ })).toHaveAttribute("aria-pressed", "true");
    expect(requestsApi.listRequests).toHaveBeenCalledTimes(1);
  });
});
