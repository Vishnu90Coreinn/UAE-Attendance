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

function signIn(role: "Administrator" | "Manager" | "Supervisor" | "HR" | "Viewer") {
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

describe("Locking floors", () => {
  const withLock = (floors: SiteFloor[], name: string) => floors.map((f) => (f.floor === name ? { ...f, isLocked: true } : f));

  it("lets a Manager lock a floor, saving the lock with the report", async () => {
    signIn("Manager");
    const user = await open();

    await user.click(screen.getByRole("button", { name: "Lock 2nd Floor (L02)" }));
    // Locked: no longer editable in place, and the lock can be undone.
    expect(screen.queryByRole("button", { name: "Edit 2nd Floor (L02)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "2nd Floor (L02) WIR status" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock 2nd Floor (L02)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save report" }));
    const saved = vi.mocked(api.saveReport).mock.calls[0][1];
    expect(saved.find((f) => f.floor === "2nd Floor (L02)")?.isLocked).toBe(true);
    expect(saved.find((f) => f.floor === "1st Floor (L01)")?.isLocked).toBeFalsy();
  });

  it("lets a Manager unlock a locked floor and edit it again", async () => {
    signIn("Manager");
    vi.mocked(api.getReport).mockResolvedValue(report(withLock(PROTOTYPE, "2nd Floor (L02)")));
    const user = await open();

    await user.click(screen.getByRole("button", { name: "Unlock 2nd Floor (L02)" }));
    expect(screen.getByRole("button", { name: "Edit 2nd Floor (L02)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lock 2nd Floor (L02)" })).toBeInTheDocument();
  });

  it("shows a Supervisor a locked floor read-only, with no way to edit, delete or unlock it", async () => {
    vi.mocked(api.getReport).mockResolvedValue(report(withLock(PROTOTYPE, "2nd Floor (L02)")));
    await open();

    expect(screen.getByText("(locked)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit 2nd Floor (L02)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete 2nd Floor (L02)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Unlock/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "2nd Floor (L02) WIR status" })).not.toBeInTheDocument();
    // The other floors stay editable.
    expect(screen.getByRole("combobox", { name: "1st Floor (L01) WIR status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit 1st Floor (L01)" })).toBeInTheDocument();
  });

  it("gives a Supervisor no lock buttons", async () => {
    await open();
    expect(screen.queryByRole("button", { name: /^Lock / })).not.toBeInTheDocument();
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
    await user.clear(within(dialog).getByLabelText("Frames"));
    await user.type(within(dialog).getByLabelText("Frames"), "5");
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
    expect(screen.queryByRole("button", { name: "PDF" })).not.toBeInTheDocument();
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

  it("gives a Viewer a read-only view with the PDF and CSV", async () => {
    signIn("Viewer");
    await open();

    for (const name of ["Add floor", "Save report", "New project"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "5th Floor (L05) WIR status" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument();
  });

  it("gives HR a read-only view with print and export", async () => {
    signIn("HR");
    await open();

    expect(screen.queryByRole("button", { name: "Add floor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save report" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print" })).not.toBeInTheDocument();
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
  const row = (name: string) => screen.getByRole("listitem", { name });
  const openFloor = (user: ReturnType<typeof userEvent.setup>, name: string) =>
    user.click(within(row(name)).getByRole("button", { name }));

  it("shows each floor as a row with its three statuses instead of a table", async () => {
    await open();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    const second = row("2nd Floor (L02)");
    expect(within(second).getByText("In progress")).toBeInTheDocument();
    expect(within(second).getByText("WIR submitted")).toBeInTheDocument();
    expect(within(second).queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Installed" })).toBeInTheDocument();
    expect(handover()).toBe(33);
  });

  it("opens a floor in place and edits counts and statuses with one tap each", async () => {
    const user = await open();
    await openFloor(user, "2nd Floor (L02)");

    await user.click(screen.getByRole("button", { name: "Increase 2nd Floor (L02) frames" }));
    expect(screen.getByRole("textbox", { name: "2nd Floor (L02) frames" })).toHaveValue("17");
    await user.click(within(screen.getByRole("group", { name: "2nd Floor (L02) completion" })).getByRole("button", { name: "Completed" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "2nd Floor (L02) WIR status" }), "Approved");

    expect(handover()).toBe(50);
    expect(screen.getByText("1 floor changed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save report" }));

    await waitFor(() => expect(api.saveReport).toHaveBeenCalled());
    const saved = vi.mocked(api.saveReport).mock.calls[0][1];
    expect(saved[2]).toMatchObject({ floor: "2nd Floor (L02)", frames: 17, completion: "Completed", wirStatus: "Approved" });
    expect(await screen.findByText("Report saved.")).toBeInTheDocument();
  });

  it("has no save bar until something changes, and Discard restores the floors", async () => {
    const user = await open();
    expect(screen.queryByRole("button", { name: "Save report" })).not.toBeInTheDocument();
    await openFloor(user, "5th Floor (L05)");

    await user.click(screen.getByRole("button", { name: "Increase 5th Floor (L05) frames" }));
    expect(screen.getByRole("button", { name: "Save report" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(screen.queryByRole("button", { name: "Save report" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "5th Floor (L05) frames" })).toHaveValue("0");
  });

  it("narrows the floors with the status chips", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: /^Not started/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(row("5th Floor (L05)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Not started/ }));
    await user.click(screen.getByRole("button", { name: /^WIR open/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("deletes a floor from its panel into the draft, which Discard brings back", async () => {
    const user = await open();
    await openFloor(user, "5th Floor (L05)");

    await user.click(screen.getByRole("button", { name: "More actions for 5th Floor (L05)" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete floor" }));
    expect(screen.queryByRole("listitem", { name: "5th Floor (L05)" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(row("5th Floor (L05)")).toBeInTheDocument();
  });

  it("offers Undo for a deleted floor and puts it back where it was", async () => {
    const user = await open();
    await openFloor(user, "2nd Floor (L02)");

    await user.click(screen.getByRole("button", { name: "More actions for 2nd Floor (L02)" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete floor" }));
    expect(screen.getByText("Deleted 2nd Floor (L02)")).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "2nd Floor (L02)" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    const names = screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"));
    expect(names[2]).toBe("2nd Floor (L02)");
    expect(screen.queryByRole("button", { name: "Save report" })).not.toBeInTheDocument();
  });

  it("puts Add floor at the end of the list, not in the header", async () => {
    const user = await open();

    const add = screen.getByRole("button", { name: "Add floor" });
    const list = screen.getByRole("list", { name: "Floors" });
    expect(list.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(add);
    expect(await screen.findByRole("dialog", { name: "Add floor" })).toBeInTheDocument();
  });

  it("edits the site note in the open floor, with no second form", async () => {
    const user = await open();
    await openFloor(user, "2nd Floor (L02)");

    const note = screen.getByRole("textbox", { name: "2nd Floor (L02) site note" });
    expect(note).toHaveValue("4 panels pending.");
    await user.clear(note);
    await user.type(note, "East panels done");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("1 floor changed")).toBeInTheDocument();
    expect(screen.getByText("East panels done")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save report" }));
    await waitFor(() => expect(api.saveReport).toHaveBeenCalled());
    expect(vi.mocked(api.saveReport).mock.calls[0][1][2]).toMatchObject({ floor: "2nd Floor (L02)", remarks: "East panels done" });
  });

  it("keeps the save bar out of the way while a note is being typed", async () => {
    const user = await open();
    await openFloor(user, "5th Floor (L05)");
    await user.click(screen.getByRole("button", { name: "Increase 5th Floor (L05) frames" }));
    expect(screen.getByRole("button", { name: "Save report" })).toBeInTheDocument();

    await user.click(screen.getByRole("textbox", { name: "5th Floor (L05) site note" }));
    expect(screen.queryByRole("button", { name: "Save report" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Save report" })).toBeInTheDocument();
  });

  it("renames a floor from the panel's menu", async () => {
    const user = await open();
    await openFloor(user, "5th Floor (L05)");

    await user.click(screen.getByRole("button", { name: "More actions for 5th Floor (L05)" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename floor" }));

    expect(await screen.findByRole("dialog", { name: "Edit floor" })).toBeInTheDocument();
  });

  describe("a locked floor", () => {
    const withLocked = () =>
      vi.mocked(api.getReport).mockResolvedValue(report(PROTOTYPE.map((f, i) => (i === 2 ? { ...f, isLocked: true } : f))));

    it("is read-only for a Supervisor, who is told who can unlock it", async () => {
      withLocked();
      const user = await open();
      const second = row("2nd Floor (L02)");

      expect(within(second).getByRole("button", { name: "2nd Floor (L02) (locked)" })).toBeInTheDocument();
      await user.click(within(second).getByRole("button", { name: "2nd Floor (L02) (locked)" }));

      expect(screen.getByText("A manager locked this floor. Ask them to unlock it to make changes.")).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: /frames|site note/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Unlock/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^More actions for/ })).not.toBeInTheDocument();
      expect(screen.getByText("4 panels pending.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save report" })).not.toBeInTheDocument();
    });

    it("lets a Manager unlock it in one tap and then edit it", async () => {
      signIn("Manager");
      withLocked();
      const user = await open();
      await user.click(within(row("2nd Floor (L02)")).getByRole("button", { name: "2nd Floor (L02) (locked)" }));
      expect(screen.getByText("This floor is locked. Unlock it to make changes.")).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: /frames/ })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Unlock 2nd Floor (L02)" }));

      expect(screen.getByRole("textbox", { name: "2nd Floor (L02) frames" })).toBeInTheDocument();
      expect(screen.getByText("1 floor changed")).toBeInTheDocument();
    });

    it("lets a Manager lock an open floor from its menu, which makes it read-only at once", async () => {
      signIn("Manager");
      const user = await open();
      await openFloor(user, "5th Floor (L05)");

      await user.click(screen.getByRole("button", { name: "More actions for 5th Floor (L05)" }));
      await user.click(screen.getByRole("menuitem", { name: "Lock floor" }));

      expect(screen.getByText("This floor is locked. Unlock it to make changes.")).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: /frames/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Unlock 5th Floor (L05)" })).toBeInTheDocument();
    });
  });

  it("shows a read-only floor to HR with counts and no controls", async () => {
    signIn("HR");
    const user = await open();
    await openFloor(user, "2nd Floor (L02)");

    expect(screen.queryByRole("textbox", { name: /frames/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^More actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /site note/ })).not.toBeInTheDocument();
    expect(screen.getByText("4 panels pending.")).toBeInTheDocument();
  });
});
