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
    listReportDates: vi.fn(),
    getReport: vi.fn(),
    saveReport: vi.fn(),
    deleteReport: vi.fn(),
    downloadReportPdf: vi.fn(),
    downloadReportCsv: vi.fn(),
  };
});
vi.mock("../../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

/** The prototype's sample floors: 76 frames, 58 glass, 2 completed, 1 untouched, 3 awaiting WIR approval. */
const PROTOTYPE: SiteFloor[] = [
  { floor: "Ground Floor (L00)", frames: 24, glass: 24, completion: "Completed", wirStatus: "Approved", remarks: "Consultant approved." },
  { floor: "1st Floor (L01)", frames: 18, glass: 18, completion: "Completed", wirStatus: "Approved", remarks: "" },
  { floor: "2nd Floor (L02)", frames: 16, glass: 12, completion: "InProgress", wirStatus: "Submitted", remarks: "4 panels pending." },
  { floor: "3rd Floor (L03)", frames: 10, glass: 4, completion: "InProgress", wirStatus: "ApprovedWithComments", remarks: "" },
  { floor: "4th Floor (L04)", frames: 8, glass: 0, completion: "InProgress", wirStatus: "Rejected", remarks: "" },
  { floor: "5th Floor (L05)", frames: 0, glass: 0, completion: "NotStarted", wirStatus: "Pending", remarks: "" },
];

function report(floors: SiteFloor[], exists = true): SiteReport {
  return {
    projectId: 1,
    projectName: "Twilight",
    date: "2026-10-01",
    exists,
    copiedFromDate: exists ? null : "2026-09-30",
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
  vi.mocked(api.listReportDates).mockResolvedValue(["2026-10-01"]);
  vi.mocked(api.getReport).mockResolvedValue(report(PROTOTYPE));
  vi.mocked(api.saveReport).mockImplementation(async (_p, _d, floors) => report(floors));
});
afterEach(restoreViewport);

async function open() {
  const user = userEvent.setup();
  render(<SiteProgressPage />);
  await screen.findByText("Total frames installed");
  return user;
}
const stat = (label: string) => screen.getByText(label, { selector: "p" }).parentElement!.parentElement!;

describe("KPIs", () => {
  it("computeKpis matches the server vectors", () => {
    expect(api.computeKpis(PROTOTYPE)).toEqual({ totalFrames: 76, totalGlass: 58, completedFloors: 2, noProgressFloors: 1, pendingWir: 3 });
  });

  it("shows the five summary figures", async () => {
    await open();

    expect(within(stat("Aluminium frames")).getByText("76")).toBeInTheDocument();
    expect(within(stat("Fixed glass")).getByText("58")).toBeInTheDocument();
    expect(within(stat("Completed floors")).getByText("2")).toBeInTheDocument();
    expect(within(stat("Pending installation")).getByText("1")).toBeInTheDocument();
    expect(within(stat("Pending WIR")).getByText("3")).toBeInTheDocument();
  });
});

describe("Site Progress page", () => {
  it("lists the floors with status words, not colour alone", async () => {
    await open();

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(7);
    expect(within(rows[1]).getByText("Ground Floor (L00)")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Inspection Submitted")).toBeInTheDocument();
    expect(within(rows[5]).getByText("Rejected")).toBeInTheDocument();
    expect(within(rows[4]).getByText("Approved with Comments")).toBeInTheDocument();
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

    expect(within(stat("Aluminium frames")).getByText("81")).toBeInTheDocument();
    expect(within(stat("Pending WIR")).getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save report" }));

    await waitFor(() => expect(api.saveReport).toHaveBeenCalledTimes(1));
    const [project, date, floors] = vi.mocked(api.saveReport).mock.calls[0];
    expect(project).toBe(1);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(floors).toHaveLength(7);
    expect(floors[6]).toMatchObject({ floor: "6th Floor (L06)", frames: 5, glass: 0, completion: "InProgress", wirStatus: "Pending" });
    expect(await screen.findByText("Report saved.")).toBeInTheDocument();
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
    expect(within(stat("Pending installation")).getByText("0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit 4th Floor (L04)" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit floor" });
    await user.selectOptions(within(dialog).getByLabelText("WIR (Work Inspection Request) status"), "Approved");
    await user.click(within(dialog).getByRole("button", { name: "Update floor" }));

    expect(within(stat("Pending WIR")).getByText("1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByText("5th Floor (L05)")).toBeInTheDocument();
  });

  it("shows the earlier report's floors as a starting point for a new date", async () => {
    vi.mocked(api.getReport).mockResolvedValue(report(PROTOTYPE, false));
    await open();

    expect(screen.getByText(/Nothing is saved for/)).toHaveTextContent("2026-09-30");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print" })).not.toBeInTheDocument();
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

  it("asks before leaving unsaved changes when the date changes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Delete 5th Floor (L05)" }));

    await user.selectOptions(screen.getByLabelText("Saved reports"), "2026-10-01");

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

    await waitFor(() => expect(api.downloadReportCsv).toHaveBeenCalledWith(1, expect.any(String)));
    expect(api.downloadReportPdf).toHaveBeenCalledWith(1, expect.any(String));
  });
});

describe("roles", () => {
  it("lets a Supervisor edit but not create projects or delete reports", async () => {
    await open();

    expect(screen.getByRole("button", { name: "Add floor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New project" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete report" })).not.toBeInTheDocument();
  });

  it("lets a Manager create projects and delete a saved report", async () => {
    signIn("Manager");
    const user = await open();

    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
    vi.mocked(api.deleteReport).mockResolvedValue();
    await user.click(screen.getByRole("button", { name: "Delete report" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete report" }));

    await waitFor(() => expect(api.deleteReport).toHaveBeenCalledWith(1, expect.any(String)));
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
    expect(within(cards[2]).getByText("Inspection Submitted")).toBeInTheDocument();
    expect(within(cards[2]).getByText("In Progress")).toBeInTheDocument();
    expect(within(cards[2]).getByRole("button", { name: "Edit 2nd Floor (L02)" })).toBeInTheDocument();
  });
});
