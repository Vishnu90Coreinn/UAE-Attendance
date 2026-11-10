import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "../../api/documentSettings";
import type { DocumentSettings } from "../../api/documentSettings";
import { CompanyDocumentsCard } from "./CompanyDocumentsCard";

vi.mock("../../api/documentSettings");

const settings: DocumentSettings = {
  companyName: "DE AKS BE", companySubtitle: "", companyNameAr: "", mobile: "", address1: "", address2: "", email: "", trn: "",
  bankName: "", accountName: "", accountNumber: "", iban: "", defaultPaymentTerms: "Due on Receipt", defaultInvoiceNotes: "Thanks",
  nextInvoiceNumber: 185, signerName: "", signerTitle: "", hasLogo: false, hasSeal: true, hasSignature: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getDocumentSettings).mockResolvedValue(settings);
});

it("shows the next invoice number and which pictures exist", async () => {
  render(<CompanyDocumentsCard />);
  expect(await screen.findByText("Next invoice number: INV-000185")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Replace company seal/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Upload company logo/ })).toBeInTheDocument();
});

it("refuses a blank company name without calling the server", async () => {
  const user = userEvent.setup();
  render(<CompanyDocumentsCard />);
  const name = await screen.findByLabelText("Letterhead company name");
  await user.clear(name);
  await user.click(screen.getByRole("button", { name: "Save company documents" }));
  expect(await screen.findByText("This field is required.")).toBeInTheDocument();
  expect(api.updateDocumentSettings).not.toHaveBeenCalled();
});

it("saves the edited settings and confirms", async () => {
  vi.mocked(api.updateDocumentSettings).mockResolvedValue({ ...settings, iban: "AE07" });
  const user = userEvent.setup();
  render(<CompanyDocumentsCard />);
  await user.type(await screen.findByLabelText("IBAN"), "AE07");
  await user.click(screen.getByRole("button", { name: "Save company documents" }));
  await waitFor(() => expect(api.updateDocumentSettings).toHaveBeenCalledWith(expect.objectContaining({ iban: "AE07" })));
  expect(await screen.findByText("Company document settings saved.")).toBeInTheDocument();
});

it("rejects a non-image file before uploading", async () => {
  const user = userEvent.setup({ applyAccept: false });
  render(<CompanyDocumentsCard />);
  const input = await screen.findByLabelText("Choose company logo file");
  await user.upload(input, new File(["x"], "logo.svg", { type: "image/svg+xml" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Choose a PNG or JPEG picture.");
  expect(api.uploadDocumentImage).not.toHaveBeenCalled();
});
