import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import * as lettersApi from "../../api/letters";
import type { LetterDocument, LetterRecord, LetterSummary } from "../../api/letters";
import * as workersApi from "../../api/workers";
import type { Worker } from "../../api/workers";
import { LettersPage } from "./LettersPage";

vi.mock("../../api/letters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/letters")>();
  return {
    ...actual,
    previewLetter: vi.fn(),
    issueLetter: vi.fn(),
    listLetters: vi.fn(),
    getLetter: vi.fn(),
    getLetterPdf: vi.fn(),
    getLetterImage: vi.fn(),
  };
});
vi.mock("../../api/workers");
vi.mock("../payroll/downloadPdf", () => ({ saveBlob: vi.fn() }));

const worker: Worker = {
  id: 4, workerCode: "EMP-004", fullName: "Sajid Mahmood", designation: "Supervisor", hourlyRate: 6.67, overtimeRate: null,
  effectiveOvertimeRate: 2.22, isActive: true, bankName: "Emirates NBD", bankAccountNumber: "0129", iban: "AE03",
};
const noBank: Worker = { ...worker, id: 5, workerCode: "EMP-005", fullName: "No Bank", bankName: null, bankAccountNumber: null, iban: null };

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

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(workersApi.listWorkers).mockResolvedValue([worker, noBank]);
  vi.mocked(lettersApi.previewLetter).mockResolvedValue(documentFor(""));
  vi.mocked(lettersApi.listLetters).mockResolvedValue([summary]);
  vi.mocked(lettersApi.getLetterImage).mockRejectedValue(new Error("none"));
});

async function chooseWorker(user: ReturnType<typeof userEvent.setup>, label = "Sajid Mahmood (EMP-004)") {
  await user.selectOptions(await screen.findByLabelText("Worker"), label);
}

describe("HR Letters - new letter", () => {
  it("asks for a worker first and shows no preview", async () => {
    render(<LettersPage />);

    expect(await screen.findByText("Choose a worker to see the letter")).toBeInTheDocument();
    expect(lettersApi.previewLetter).not.toHaveBeenCalled();
  });

  it("shows the server-built letter as the preview once a worker is chosen", async () => {
    const user = userEvent.setup();
    render(<LettersPage />);

    await chooseWorker(user);

    const sheet = await screen.findByRole("article", { name: "SALARY CERTIFICATE preview" });
    expect(within(sheet).getByText("Mr. Sajid Mahmood")).toBeInTheDocument();
    expect(within(sheet).getByText("TOTAL GROSS MONTHLY SALARY")).toBeInTheDocument();
    expect(within(sheet).getByText("Assigned when issued")).toBeInTheDocument();
    expect(lettersApi.previewLetter).toHaveBeenLastCalledWith(
      expect.objectContaining({ workerId: 4, letterType: "Salary", salutation: "Mr.", showSeal: true }),
      expect.anything(),
    );
  });

  it("asks again when the type changes and for bank details only when the worker has none", async () => {
    const user = userEvent.setup();
    render(<LettersPage />);
    await chooseWorker(user, "No Bank (EMP-005)");

    await user.click(screen.getByRole("radio", { name: "Bank Salary Transfer" }));

    expect(await screen.findByRole("group", { name: "Bank details for this letter" })).toBeInTheDocument();
    await waitFor(() => expect(lettersApi.previewLetter).toHaveBeenLastCalledWith(expect.objectContaining({ letterType: "BankTransfer" }), expect.anything()));

    await user.selectOptions(screen.getByLabelText("Worker"), "Sajid Mahmood (EMP-004)");
    await waitFor(() => expect(screen.queryByRole("group", { name: "Bank details for this letter" })).not.toBeInTheDocument());
  });

  it("shows the server's field messages next to the fields instead of a preview", async () => {
    vi.mocked(lettersApi.previewLetter).mockRejectedValue(
      new ApiError(400, "Enter the signatory name.", undefined, undefined, { signerName: ["Enter the signatory name."] }),
    );
    const user = userEvent.setup();
    render(<LettersPage />);

    await chooseWorker(user);

    expect(await screen.findByText("Enter the signatory name.")).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Signatory name")).toHaveAttribute("aria-invalid", "true");
  });

  it("issues the letter, announces the reference and offers print and PDF", async () => {
    vi.mocked(lettersApi.issueLetter).mockResolvedValue(record);
    vi.mocked(lettersApi.getLetterPdf).mockResolvedValue(new Blob(["%PDF"]));
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<LettersPage />);
    await chooseWorker(user);
    await screen.findByRole("article");

    await user.click(screen.getByRole("button", { name: "Issue letter" }));

    expect(await screen.findByText("Letter DEAKS/HR/2026/0001 was issued and saved.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Print" }));
    expect(printSpy).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(lettersApi.getLetterPdf).toHaveBeenCalledWith(11));
    await user.click(screen.getByRole("button", { name: "Issue another" }));
    expect(await screen.findByLabelText("Worker")).toHaveValue("");
  });

  it("keeps the form and shows the failure when issuing fails", async () => {
    vi.mocked(lettersApi.issueLetter).mockRejectedValue(new ApiError(409, "Several letters were issued at the same moment. Try again."));
    const user = userEvent.setup();
    render(<LettersPage />);
    await chooseWorker(user);
    await screen.findByRole("article");

    await user.click(screen.getByRole("button", { name: "Issue letter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Several letters were issued at the same moment.");
    expect(screen.getByLabelText("Worker")).toHaveValue("4");
  });

  it("reports a worker list that cannot be loaded, with a retry", async () => {
    vi.mocked(workersApi.listWorkers).mockRejectedValueOnce(new ApiError(500, "Server error")).mockResolvedValue([worker]);
    const user = userEvent.setup();
    render(<LettersPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Server error");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByLabelText("Worker")).toBeInTheDocument();
  });
});

describe("HR Letters - issued letters", () => {
  it("lists issued letters and filters them by search and type", async () => {
    const user = userEvent.setup();
    render(<LettersPage />);

    await user.click(screen.getByRole("tab", { name: "Issued letters" }));

    expect(await screen.findByText("DEAKS/HR/2026/0001")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search"), "Sajid");
    await user.selectOptions(screen.getByLabelText("Type"), "Noc");
    await waitFor(() => expect(lettersApi.listLetters).toHaveBeenLastCalledWith({ search: "Sajid", type: "Noc", from: "", to: "" }));
  });

  it("shows an empty state", async () => {
    vi.mocked(lettersApi.listLetters).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<LettersPage />);

    await user.click(screen.getByRole("tab", { name: "Issued letters" }));

    expect(await screen.findByText("No letters found")).toBeInTheDocument();
  });

  it("re-opens an issued letter exactly as stored, and goes back to the log", async () => {
    vi.mocked(lettersApi.getLetter).mockResolvedValue(record);
    const user = userEvent.setup();
    render(<LettersPage />);
    await user.click(screen.getByRole("tab", { name: "Issued letters" }));

    await user.click(await screen.findByRole("button", { name: "Open DEAKS/HR/2026/0001" }));

    const sheet = await screen.findByRole("article", { name: "SALARY CERTIFICATE preview" });
    expect(within(sheet).getByText("DEAKS/HR/2026/0001")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to letters" }));
    expect(await screen.findByText("DEAKS/HR/2026/0001")).toBeInTheDocument();
  });

  it("downloads the PDF from the log and reports a PDF that cannot be made", async () => {
    vi.mocked(lettersApi.getLetterPdf).mockRejectedValue(new ApiError(422, "The PDF supports English text. Update names that use other scripts."));
    const user = userEvent.setup();
    render(<LettersPage />);
    await user.click(screen.getByRole("tab", { name: "Issued letters" }));

    await user.click(await screen.findByRole("button", { name: "Download PDF DEAKS/HR/2026/0001" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The PDF supports English text.");
  });

  it("shows a load error with a retry", async () => {
    vi.mocked(lettersApi.listLetters).mockRejectedValueOnce(new ApiError(500, "Boom")).mockResolvedValue([summary]);
    const user = userEvent.setup();
    render(<LettersPage />);
    await user.click(screen.getByRole("tab", { name: "Issued letters" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("DEAKS/HR/2026/0001")).toBeInTheDocument();
  });
});
