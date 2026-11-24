import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CertificateRequest } from "../../api/certificateRequests";
import * as staffApi from "../../api/staff";
import { mockViewport, restoreViewport } from "../../test-viewport";
import { MyLettersPage } from "./MyLettersPage";

vi.mock("../../api/staff");
vi.mock("../payroll/downloadPdf", () => ({ saveBlob: vi.fn() }));

function letter(over: Partial<CertificateRequest>): CertificateRequest {
  return {
    id: 1, workerId: 1, workerName: "Layla", workerCode: "EMP-001", letterType: "Salary", reason: "Visa", status: "Requested",
    requestedBy: "layla", requestedUtc: "2026-11-20T08:00:00Z", preparedBy: null, preparedUtc: null, reviewedBy: null, reviewedUtc: null,
    reviewNote: "", hasDetails: false, letterId: null, refNo: null, ...over,
  } as CertificateRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockViewport("phone");
});
afterEach(restoreViewport);

describe("My Letters on a phone", () => {
  it("puts the ready letter first with a full Download button, and shows progress for the rest", async () => {
    vi.mocked(staffApi.getMyLetters).mockResolvedValue([
      letter({ id: 1, letterType: "Service" }),
      letter({ id: 2, status: "Approved", refNo: "DAB/SAL/001" }),
    ]);
    vi.mocked(staffApi.getMyLetterPdf).mockResolvedValue(new Blob());
    const user = userEvent.setup();
    render(<MyLettersPage />);

    const rows = (await screen.findAllByRole("listitem")).filter((li) => li.getAttribute("aria-label"));
    expect(rows.map((li) => li.getAttribute("aria-label"))).toEqual(["Salary Certificate, Approved", "Service Certificate, Requested"]);
    expect(screen.getAllByText("Sent to your manager, who will prepare it.").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Download letter" }));
    expect(staffApi.getMyLetterPdf).toHaveBeenCalledWith(2);
  });

  it("says why a letter came back", async () => {
    vi.mocked(staffApi.getMyLetters).mockResolvedValue([letter({ status: "Returned", reviewNote: "Wrong salary" })]);
    render(<MyLettersPage />);

    expect(await screen.findByText("Wrong salary")).toBeInTheDocument();
    expect(screen.getAllByText("Your manager is revising it.").length).toBeGreaterThan(0);
  });

  it("requests a chosen letter type from the sheet", async () => {
    vi.mocked(staffApi.getMyLetters).mockResolvedValue([letter({})]);
    vi.mocked(staffApi.requestMyLetter).mockResolvedValue(letter({ id: 5 }));
    const user = userEvent.setup();
    render(<MyLettersPage />);

    await user.click(await screen.findByRole("button", { name: "Request a letter" }));
    await user.click(screen.getByRole("button", { name: /Service Certificate/ }));
    await user.type(screen.getByLabelText(/What is it for/), "Bank loan");
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(staffApi.requestMyLetter).toHaveBeenCalledWith("Service", "Bank loan");
    expect(await screen.findByText(/Request sent/)).toBeInTheDocument();
  });

  it("invites the first request with a single button when there are none", async () => {
    vi.mocked(staffApi.getMyLetters).mockResolvedValue([]);
    render(<MyLettersPage />);

    expect(await screen.findByText("No letter requests yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Request a letter" })).toHaveLength(1);
  });
});
