import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/siteProgress";
import type { SiteFloor, SiteReport } from "../../api/siteProgress";
import { useAuth } from "../../contexts/AuthContext";
import { mockViewport, restoreViewport } from "../../test-viewport";
import { SiteProgressPage } from "./SiteProgressPage";

vi.mock("../../api/siteProgress", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/siteProgress")>();
  return {
    ...actual,
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    getReport: vi.fn(),
    saveReport: vi.fn(),
    downloadReportPdf: vi.fn(),
    downloadReportCsv: vi.fn(),
  };
});
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

/** The prototype's sample floors: 76 frames, 58 glass, 2 completed, 1 untouched, 3 awaiting WIR approval. */
const PROTOTYPE: SiteFloor[] = [
  { floor: "Ground Floor (L00)", frames: 24, glass: 24, shutters: 0, alignment: "NotComplete", completion: "Completed", wirStatus: "Approved", remarks: "Consultant approved." },
  { floor: "1st Floor (L01)", frames: 18, glass: 18, shutters: 0, alignment: "NotComplete", completion: "Completed", wirStatus: "Approved", remarks: "" },
  { floor: "2nd Floor (L02)", frames: 16, glass: 12, shutters: 0, alignment: "NotComplete", completion: "InProgress", wirStatus: "Submitted", remarks: "4 panels pending." },
  { floor: "3rd Floor (L03)", frames: 10, glass: 4, shutters: 0, alignment: "NotComplete", completion: "InProgress", wirStatus: "ApprovedWithComments", remarks: "" },
  { floor: "4th Floor (L04)", frames: 8, glass: 0, shutters: 0, alignment: "NotComplete", completion: "InProgress", wirStatus: "Rejected", remarks: "" },
  { floor: "5th Floor (L05)", frames: 0, glass: 0, shutters: 0, alignment: "NotComplete", completion: "NotStarted", wirStatus: "Pending", remarks: "" },
];

function report(floors: SiteFloor[], exists = true): SiteReport {
  return {
    projectId: 1,
    projectName: "Twilight",
    date: "2026-10-01",
    exists,
    copiedFromDate: null,
    updatedBy: exists ? "sup.omar" : null,
    updatedUtc: null,
    floors,
    kpis: api.computeKpis(floors),
  };
}

function signIn(role: "Administrator" | "Manager" | "Supervisor" | "HR") {
  vi.mocked(useAuth).mockReturnValue({
    status: "signedIn",
    user: { id: 1, username: "someone", role },
    token: "t",
    login: vi.fn(),
    logout: vi.fn(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockViewport("desktop");
  signIn("Supervisor");
  vi.mocked(api.listProjects).mockResolvedValue([{ id: 1, name: "Twilight", isActive: true }]);
  vi.mocked(api.getReport).mockResolvedValue(report(PROTOTYPE));
  vi.mocked(api.saveReport).mockImplementation(async (_p, floors) => report(floors));
});
afterEach(restoreViewport);

async function open() {
  const user = userEvent.setup();
  render(<SiteProgressPage />);
  await screen.findByRole("group", { name: "Installed" });
  return user;
}
/** The value shown beside a label inside one of the summary groups (Installed, Alignment, WIR). */
const metric = (group: string, label: string) =>
  within(screen.getByRole("group", { name: group })).getByText(label, { selector: "dt" }).nextElementSibling;
const handover = () => Number(screen.getByRole("progressbar", { name: "Site handover ready" }).getAttribute("aria-valuenow"));

describe("KPIs", () => {
  it("computeKpis matches the server vectors", () => {
    expect(api.computeKpis(PROTOTYPE)).toEqual({
      totalFrames: 76, totalGlass: 58, totalShutters: 0, completedFloors: 2, noProgressFloors: 1,
      pendingWir: 2, approvedWir: 3, rejectedWir: 1,
      alignmentNotComplete: 6, alignmentUnderProcess: 0, alignmentComplete: 0, handoverReadyPercent: 33,
    });
  });

  it("shows the summary figures", async () => {
    await open();

    expect(metric("Installed", "Frames")).toHaveTextContent("76");
    expect(metric("Installed", "Fixed glass")).toHaveTextContent("58");
    expect(metric("Installed", "Shutters")).toHaveTextContent("0");
    expect(metric("Installed", "Floors done")).toHaveTextContent("2");
    expect(metric("Installed", "Not started")).toHaveTextContent("1");
    expect(metric("Alignment", "Complete")).toHaveTextContent("0");
    expect(metric("Alignment", "Under process")).toHaveTextContent("0");
    expect(metric("Alignment", "Not complete")).toHaveTextContent("6");
    expect(metric("WIR", "Approved")).toHaveTextContent("3");
    expect(metric("WIR", "Pending")).toHaveTextContent("2");
    expect(metric("WIR", "Rejected")).toHaveTextContent("1");
    expect(handover()).toBe(33);
  });
});

describe("Site Progress page", () => {
  it("lists the floors with status words, not colour alone", async () => {
    await open();

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(7);
    expect(within(rows[1]).getByText("Ground Floor (L00)")).toBeInTheDocument();
    expect(within(rows[3]).getByRole("combobox", { name: "2nd Floor (L02) WIR status" })).toHaveDisplayValue("Inspection Submitted");
    expect(within(rows[5]).getByRole("combobox", { name: "4th Floor (L04) WIR status" })).toHaveDisplayValue("Rejected");
    expect(within(rows[4]).getByRole("combobox", { name: "3rd Floor (L03) WIR status" })).toHaveDisplayValue("Approved with Comments");
  });

  it("edits counts and statuses in the row, updates the figures at once and offers Save", async () => {
    const user = await open();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();

    const frames = screen.getByRole("textbox", { name: "5th Floor (L05) frames" });
    await user.clear(frames);
    await user.type(frames, "7x");
    expect(frames).toHaveValue("7");
    await user.selectOptions(screen.getByRole("combobox", { name: "5th Floor (L05) alignment" }), "Complete");
    await user.selectOptions(screen.getByRole("combobox", { name: "5th Floor (L05) WIR status" }), "Approved");

    expect(metric("Installed", "Frames")).toHaveTextContent("83");
    expect(metric("Alignment", "Complete")).toHaveTextContent("1");
    expect(metric("WIR", "Approved")).toHaveTextContent("4");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save report" }));
    await waitFor(() => expect(api.saveReport).toHaveBeenCalledTimes(1));
    const [, floors] = vi.mocked(api.saveReport).mock.calls[0];
    expect(floors[5]).toMatchObject({ floor: "5th Floor (L05)", frames: 7, alignment: "Complete", wirStatus: "Approved" });
  });

  it("treats a cleared count as 0", async () => {
    const user = await open();

    await user.clear(screen.getByRole("textbox", { name: "1st Floor (L01) frames" }));

    expect(screen.getByRole("textbox", { name: "1st Floor (L01) frames" })).toHaveValue("0");
  });

  it("searches by floor and filters by WIR status and completion", async () => {
    const user = await open();

    await user.type(screen.getByLabelText("Search floors"), "3rd");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    await user.clear(screen.getByLabelText("Search floors"));

    await user.selectOptions(screen.getByLabelText("WIR status"), "pending");
    expect(screen.getAllByRole("row")).toHaveLength(4);
    await user.selectOptions(screen.getByLabelText("WIR status"), "rejected");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText("WIR status"), "all");
    await user.selectOptions(screen.getByLabelText("Completion"), "Completed");
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("adds a floor, recomputes the summary and saves the whole report", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: "Add floor" }));
    const dialog = await screen.findByRole("dialog", { name: "Add floor" });
    await user.type(within(dialog).getByLabelText("Floor designation / ID"), "6th Floor (L06)");
    await user.clear(within(dialog).getByLabelText("Aluminium frames"));
    await user.type(within(dialog).getByLabelText("Aluminium frames"), "5");
    await user.click(within(dialog).getByRole("button", { name: "Add floor" }));

    expect(metric("Installed", "Frames")).toHaveTextContent("81");
    expect(metric("WIR", "Pending")).toHaveTextContent("3");
    expect(metric("WIR", "Rejected")).toHaveTextContent("1");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save report" }));

    await waitFor(() => expect(api.saveReport).toHaveBeenCalledTimes(1));
    const [project, floors] = vi.mocked(api.saveReport).mock.calls[0];
    expect(project).toBe(1);
    expect(floors).toHaveLength(7);
    expect(floors[6]).toMatchObject({ floor: "6th Floor (L06)", frames: 5, glass: 0, shutters: 0, alignment: "NotComplete", completion: "InProgress", wirStatus: "Pending" });
    expect(await screen.findByText("Report saved.")).toBeInTheDocument();
  });

  it("records shutters and alignment for a floor and filters by alignment", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: "Add floor" }));
    const dialog = await screen.findByRole("dialog", { name: "Add floor" });
    await user.type(within(dialog).getByLabelText("Floor designation / ID"), "6th Floor (L06)");
    await user.clear(within(dialog).getByLabelText("Shutters"));
    await user.type(within(dialog).getByLabelText("Shutters"), "7");
    await user.selectOptions(within(dialog).getByLabelText("Alignment status"), "Complete");
    await user.click(within(dialog).getByRole("button", { name: "Add floor" }));

    expect(metric("Installed", "Shutters")).toHaveTextContent("7");
    expect(metric("Alignment", "Complete")).toHaveTextContent("1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Alignment" }), "Complete");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("6th Floor (L06)")).toBeInTheDocument();
  });

  it("refuses a bad shutters count inside the dialog", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: "Add floor" }));
    const dialog = await screen.findByRole("dialog", { name: "Add floor" });
    await user.type(within(dialog).getByLabelText("Floor designation / ID"), "7th Floor");
    await user.clear(within(dialog).getByLabelText("Shutters"));
    await user.type(within(dialog).getByLabelText("Shutters"), "-1");
    await user.click(within(dialog).getByRole("button", { name: "Add floor" }));

    expect(within(dialog).getByText("Enter a whole number of 0 or more.")).toBeInTheDocument();
    expect(api.saveReport).not.toHaveBeenCalled();
  });

  it("refuses a duplicate floor name and a bad count inside the dialog", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: "Add floor" }));
    const dialog = await screen.findByRole("dialog", { name: "Add floor" });
    await user.type(within(dialog).getByLabelText("Floor designation / ID"), "1ST FLOOR (L01)");
    await user.clear(within(dialog).getByLabelText("Fixed glass"));
    await user.type(within(dialog).getByLabelText("Fixed glass"), "-2");
    await user.click(within(dialog).getByRole("button", { name: "Add floor" }));

    expect(within(dialog).getByText("This floor is already in the report.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter a whole number of 0 or more.")).toBeInTheDocument();
    expect(api.saveReport).not.toHaveBeenCalled();
  });

  it("edits and deletes a floor in the draft", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: "Delete 5th Floor (L05)" }));
    expect(screen.queryByText("5th Floor (L05)")).not.toBeInTheDocument();
    expect(metric("Installed", "Not started")).toHaveTextContent("0");

    await user.click(screen.getByRole("button", { name: "Edit 4th Floor (L04)" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit floor" });
    await user.selectOptions(within(dialog).getByLabelText("WIR (Work Inspection Request) status"), "Approved");
    await user.click(within(dialog).getByRole("button", { name: "Update floor" }));

    expect(metric("WIR", "Pending")).toHaveTextContent("1");
    expect(metric("WIR", "Rejected")).toHaveTextContent("0");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByText("5th Floor (L05)")).toBeInTheDocument();
  });

  it("says nothing is saved yet when the project has no report", async () => {
    vi.mocked(api.getReport).mockResolvedValue(report([], false));
    await open();

    expect(screen.getByText("Nothing saved for this project yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print" })).not.toBeInTheDocument();
  });

  it("shows who last updated the report and has no date controls", async () => {
    await open();

    expect(screen.getByText(/Last updated by sup.omar on/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Report date")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Saved reports")).not.toBeInTheDocument();
  });

  it("shows a server error without losing the draft", async () => {
    const { ApiError } = await import("../../api/client");
    vi.mocked(api.saveReport).mockRejectedValue(new ApiError(400, "bad", undefined, undefined, { "floors[0].floor": ["Enter the floor name."] }));
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Delete 5th Floor (L05)" }));

    await user.click(screen.getByRole("button", { name: "Save report" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the floor name.");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("asks before leaving unsaved changes when the project changes", async () => {
    vi.mocked(api.listProjects).mockResolvedValue([
      { id: 1, name: "Twilight", isActive: true },
      { id: 2, name: "Harbour", isActive: true },
    ]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Delete 5th Floor (L05)" }));

    await user.selectOptions(screen.getByLabelText("Project"), "2");

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("unsaved changes"));
    expect(api.getReport).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("downloads the PDF and the CSV", async () => {
    vi.mocked(api.downloadReportPdf).mockResolvedValue(new Blob(["pdf"]));
    vi.mocked(api.downloadReportCsv).mockResolvedValue(new Blob(["csv"]));
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const user = await open();

    await user.click(screen.getByRole("button", { name: "PDF" }));
    await user.click(screen.getByRole("button", { name: "CSV" }));

    await waitFor(() => expect(api.downloadReportCsv).toHaveBeenCalledWith(1));
    expect(api.downloadReportPdf).toHaveBeenCalledWith(1);
  });
});

describe("roles", () => {
  it("lets a Supervisor edit but not create projects", async () => {
    await open();

    expect(screen.getByRole("button", { name: "Add floor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New project" })).not.toBeInTheDocument();
  });

  it("lets a Manager create projects", async () => {
    signIn("Manager");
    await open();

    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
  });

  it("gives HR a read-only view with print and export", async () => {
    signIn("HR");
    await open();

    expect(screen.queryByRole("button", { name: "Add floor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save report" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument();
  });

  it("tells a Supervisor when there are no projects", async () => {
    vi.mocked(api.listProjects).mockResolvedValue([]);
    render(<SiteProgressPage />);

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("A manager needs to create a project first.")).toBeInTheDocument();
  });
});

describe("on a phone", () => {
  beforeEach(() => mockViewport("phone"));

  it("shows each floor as a card instead of a table", async () => {
    await open();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(6);
    expect(within(cards[2]).getByText("2nd Floor (L02)")).toBeInTheDocument();
    expect(within(cards[2]).getByRole("combobox", { name: "2nd Floor (L02) WIR status" })).toHaveDisplayValue("Inspection Submitted");
    expect(within(cards[2]).getByRole("combobox", { name: "2nd Floor (L02) completion" })).toHaveDisplayValue("In Progress");
    expect(within(cards[2]).getByRole("button", { name: "Edit 2nd Floor (L02)" })).toBeInTheDocument();
  });
});
