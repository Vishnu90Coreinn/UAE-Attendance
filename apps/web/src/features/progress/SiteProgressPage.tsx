import { useCallback, useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, HardHat, Pencil, Plus, Printer, Save, Trash2, Undo2 } from "lucide-react";
import { ApiError } from "../../api/client";
import {
  computeKpis,
  deleteReport,
  downloadReportCsv,
  downloadReportPdf,
  getReport,
  listProjects,
  listReportDates,
  saveReport,
  type SiteFloor,
  type SiteProject,
  type SiteReport,
} from "../../api/siteProgress";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { Button, Card, EmptyState, Input, PageHeader, Select, StatCard, inputClass } from "../../ui";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { saveBlob } from "../payroll/downloadPdf";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { FloorDialog } from "./FloorDialog";
import { FloorList, type FloorRow } from "./FloorList";
import { ProjectDialog } from "./ProjectDialog";

type WirFilter = "all" | "approved" | "approvedComments" | "pending" | "rejected";
type CompletionFilter = "all" | "Completed" | "InProgress" | "NotStarted";
type AlignmentFilter = "all" | "Complete" | "UnderProcess" | "NotComplete";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.fieldErrors) return Object.values(error.fieldErrors).flat().join(" ");
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

function longDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

const WARN_UNSAVED = "You have unsaved changes to this report. Leave without saving?";

export function SiteProgressPage() {
  const { user } = useAuth();
  const desktop = useIsDesktop();
  /** Supervisors, Managers and the Administrator enter progress; HR reads, prints and exports. */
  const canEdit = user?.role !== undefined && user.role !== "HR";
  const canManage = isManagement(user?.role);

  const [projects, setProjects] = useState<SiteProject[] | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [dates, setDates] = useState<string[]>([]);
  const [report, setReport] = useState<SiteReport | null>(null);
  const [floors, setFloors] = useState<SiteFloor[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [wirFilter, setWirFilter] = useState<WirFilter>("all");
  const [completionFilter, setCompletionFilter] = useState<CompletionFilter>("all");
  const [alignmentFilter, setAlignmentFilter] = useState<AlignmentFilter>("all");
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [projectDialog, setProjectDialog] = useState<{ project?: SiteProject } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const project = projects?.find((p) => p.id === projectId) ?? null;
  const dirty = useMemo(() => {
    if (!report) return false;
    if (!report.exists) return floors.length > 0;
    return JSON.stringify(floors) !== JSON.stringify(report.floors);
  }, [floors, report]);

  const loadProjects = useCallback(async () => {
    try {
      const list = await listProjects(canManage);
      setProjects(list);
      setProjectId((current) => (current !== null && list.some((p) => p.id === current) ? current : (list.find((p) => p.isActive) ?? list[0])?.id ?? null));
    } catch (error) {
      setLoadError(message(error));
    }
  }, [canManage]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const load = useCallback(async () => {
    if (projectId === null) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [loaded, saved] = await Promise.all([getReport(projectId, date), listReportDates(projectId)]);
      setReport(loaded);
      setFloors(loaded.floors);
      setDates(saved);
    } catch (error) {
      setReport(null);
      setLoadError(message(error));
    } finally {
      setLoading(false);
    }
  }, [projectId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Asks before throwing away unsaved edits when the project or date changes. */
  function guarded(change: () => void) {
    if (dirty && !window.confirm(WARN_UNSAVED)) return;
    setSuccess(null);
    setFailure(null);
    change();
  }

  const kpis = useMemo(() => computeKpis(floors), [floors]);
  const rows: FloorRow[] = useMemo(() => {
    const term = search.trim().toLowerCase();
    return floors
      .map((floor, index) => ({ floor, index }))
      .filter(({ floor }) => {
        if (term && !floor.floor.toLowerCase().includes(term)) return false;
        const approved = floor.wirStatus === "Approved" || floor.wirStatus === "ApprovedWithComments";
        if (wirFilter === "approved" && floor.wirStatus !== "Approved") return false;
        if (wirFilter === "approvedComments" && floor.wirStatus !== "ApprovedWithComments") return false;
        if (wirFilter === "pending" && approved) return false;
        if (wirFilter === "rejected" && floor.wirStatus !== "Rejected") return false;
        if (alignmentFilter !== "all" && floor.alignment !== alignmentFilter) return false;
        return completionFilter === "all" || floor.completion === completionFilter;
      });
  }, [floors, search, wirFilter, completionFilter, alignmentFilter]);

  async function save() {
    if (projectId === null) return;
    setSaving(true);
    setFailure(null);
    setSuccess(null);
    try {
      const saved = await saveReport(projectId, date, floors);
      setReport(saved);
      setFloors(saved.floors);
      setDates(await listReportDates(projectId));
      setSuccess("Report saved.");
    } catch (error) {
      setFailure(message(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (projectId === null) return;
    setDeleting(true);
    try {
      await deleteReport(projectId, date);
      setConfirmDelete(false);
      setSuccess("Report deleted.");
      await load();
    } catch (error) {
      setConfirmDelete(false);
      setFailure(message(error));
    } finally {
      setDeleting(false);
    }
  }

  async function download(kind: "pdf" | "csv") {
    if (projectId === null || !report) return;
    setFailure(null);
    try {
      const blob = kind === "pdf" ? await downloadReportPdf(projectId, date) : await downloadReportCsv(projectId, date);
      const stem = report.projectName.replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "");
      saveBlob(blob, `SiteProgress_${stem}_${date}.${kind}`);
    } catch (error) {
      setFailure(message(error));
    }
  }

  function applyFloor(floor: SiteFloor) {
    if (!editing) return;
    setFloors((current) => (editing.index === null ? [...current, floor] : current.map((f, i) => (i === editing.index ? floor : f))));
    setEditing(null);
    setSuccess(null);
  }

  const takenNames = floors.filter((_, i) => i !== editing?.index).map((f) => f.floor);

  if (projects === null && !loadError) {
    return (
      <p role="status" className="py-8 text-sm text-ink-600">
        Loading...
      </p>
    );
  }

  return (
    <div className="payroll-page">
      <div className="payroll-controls">
        <PageHeader
          title="Site Progress"
          description="Aluminium frames, fixed glass and shutters on each floor, with alignment, completion and the inspection (WIR) status."
          actions={
            report?.exists ? (
              <>
                <Button variant="secondary" icon={Printer} onClick={() => window.print()}>
                  Print
                </Button>
                <Button variant="secondary" icon={FileDown} onClick={() => void download("pdf")}>
                  PDF
                </Button>
                <Button variant="secondary" icon={FileSpreadsheet} onClick={() => void download("csv")}>
                  CSV
                </Button>
              </>
            ) : undefined
          }
        />
      </div>

      {loadError && <LoadError message={loadError} onRetry={() => void (projects ? load() : loadProjects())} />}
      {projects && projects.length === 0 && !loadError && (
        <Card>
          <EmptyState
            icon={HardHat}
            title="No projects yet"
            description={canManage ? "Create the first project to start recording progress." : "A manager needs to create a project first."}
            action={canManage ? <Button icon={Plus} onClick={() => setProjectDialog({})}>New project</Button> : undefined}
          />
        </Card>
      )}

      {projects && projects.length > 0 && (
        <>
          <Card className="payroll-controls mb-4 p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem_minmax(0,1fr)]">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Select
                    label="Project"
                    value={projectId ?? ""}
                    onChange={(e) => guarded(() => setProjectId(Number(e.target.value)))}
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.isActive ? "" : " (inactive)"}
                      </option>
                    ))}
                  </Select>
                </div>
                {canManage && (
                  <>
                    <Button variant="secondary" icon={Plus} aria-label="New project" title="New project" onClick={() => setProjectDialog({})} />
                    {project && (
                      <Button variant="secondary" icon={Pencil} aria-label="Edit project" title="Edit project" onClick={() => setProjectDialog({ project })} />
                    )}
                  </>
                )}
              </div>
              <Input
                label="Report date"
                type="date"
                value={date}
                max={today()}
                onChange={(e) => e.target.value && guarded(() => setDate(e.target.value))}
              />
              <Select
                label="Saved reports"
                value={dates.includes(date) ? date : ""}
                onChange={(e) => e.target.value && guarded(() => setDate(e.target.value))}
              >
                <option value="">{dates.length === 0 ? "None saved yet" : "Jump to a saved date"}</option>
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
          </Card>

          <div className="hidden print:block">
            <h1 className="text-xl font-semibold">Daily Site Progress Report</h1>
            <p className="text-sm">
              {report?.projectName} - {longDate(date)}
            </p>
          </div>

          <SuccessRegion message={success} />
          {failure && <ActionFailure message={failure} />}

          {loading && !report && (
            <p role="status" className="py-8 text-sm text-ink-600">
              Loading report...
            </p>
          )}

          {report && (
            <div className="payroll-report">
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
                <StatCard label="Aluminium frames" value={kpis.totalFrames} note="Total frames installed" />
                <StatCard label="Fixed glass" value={kpis.totalGlass} note="Total fixed panels installed" />
                <StatCard label="Shutters finished" value={kpis.totalShutters} note="Total shutters completed" />
                <StatCard label="Completed floors" value={kpis.completedFloors} note="Marked completed" />
                <StatCard label="Pending installation" value={kpis.noProgressFloors} note="No frames, glass or shutters" />
              </div>
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <StatCard
                  label="Alignment progress"
                  value={`${kpis.alignmentComplete} complete`}
                  note={`${kpis.alignmentUnderProcess} under process, ${kpis.alignmentNotComplete} not complete`}
                />
                <StatCard
                  label="WIR approvals"
                  value={`${kpis.approvedWir} approved`}
                  note={`${kpis.pendingWir} pending, ${kpis.rejectedWir} rejected`}
                />
                <StatCard
                  label="Site handover ready"
                  value={`${kpis.handoverReadyPercent}%`}
                  note="Floors completed and WIR approved"
                />
              </div>

              {report.copiedFromDate && !report.exists && (
                <p role="status" className="payroll-controls mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                  Nothing is saved for {date} yet. The floors from {report.copiedFromDate} are shown as a starting point; adjust them and save.
                </p>
              )}

              <div className="payroll-controls mb-4 flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1">
                  <label htmlFor="floor-search" className="block text-sm font-medium text-ink-800">
                    Search floors
                  </label>
                  <input
                    id="floor-search"
                    type="search"
                    className={`${inputClass} mt-1`}
                    placeholder="Search floor designation"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div>
                  <Select label="WIR status" value={wirFilter} onChange={(e) => setWirFilter(e.target.value as WirFilter)}>
                    <option value="all">All WIR statuses</option>
                    <option value="approved">Approved only</option>
                    <option value="approvedComments">Approved with comments</option>
                    <option value="pending">Pending / unapproved</option>
                    <option value="rejected">Rejected only</option>
                  </Select>
                </div>
                <div>
                  <Select label="Alignment" value={alignmentFilter} onChange={(e) => setAlignmentFilter(e.target.value as AlignmentFilter)}>
                    <option value="all">All alignment levels</option>
                    <option value="Complete">Complete</option>
                    <option value="UnderProcess">Under process</option>
                    <option value="NotComplete">Not complete</option>
                  </Select>
                </div>
                <div>
                  <Select label="Completion" value={completionFilter} onChange={(e) => setCompletionFilter(e.target.value as CompletionFilter)}>
                    <option value="all">All completion levels</option>
                    <option value="Completed">Completed</option>
                    <option value="InProgress">In progress</option>
                    <option value="NotStarted">Not started</option>
                  </Select>
                </div>
                {canEdit && (
                  <Button icon={Plus} onClick={() => setEditing({ index: null })}>
                    Add floor
                  </Button>
                )}
              </div>

              {rows.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={HardHat}
                    title={floors.length === 0 ? "No floors in this report" : "No matching floors"}
                    description={floors.length === 0 ? (canEdit ? "Add a floor to start the report." : "Nothing has been recorded for this date.") : "Change the search or the filters."}
                  />
                </Card>
              ) : (
                <FloorList
                  rows={rows}
                  desktop={desktop}
                  canEdit={canEdit}
                  onEdit={(index) => setEditing({ index })}
                  onDelete={(index) => {
                    setFloors((current) => current.filter((_, i) => i !== index));
                    setSuccess(null);
                  }}
                />
              )}

              {canEdit && (
                <div className="payroll-controls mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p role="status" className="text-sm text-ink-700">
                    {dirty ? "Unsaved changes" : report.exists ? `Saved by ${report.updatedBy}` : "Not saved yet"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {canManage && report.exists && (
                      <Button variant="secondary" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                        Delete report
                      </Button>
                    )}
                    {dirty && (
                      <Button variant="secondary" icon={Undo2} onClick={() => setFloors(report.floors)} disabled={saving}>
                        Discard changes
                      </Button>
                    )}
                    <Button icon={Save} onClick={() => void save()} disabled={saving || floors.length === 0 || (!dirty && report.exists)}>
                      Save report
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-16 hidden grid-cols-3 gap-8 text-center text-xs print:grid">
                {["Site Engineer / Subcontractor", "QA/QC Inspector", "Consultant Approval"].map((role) => (
                  <div key={role} className="border-t border-black pt-2">
                    <p className="font-semibold">{role}</p>
                    <p>Signature &amp; Date</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <FloorDialog open={editing !== null} floor={editing?.index != null ? floors[editing.index] : undefined} takenNames={takenNames} onSave={applyFloor} onClose={() => setEditing(null)} />
      <ProjectDialog
        open={projectDialog !== null}
        project={projectDialog?.project}
        onClose={() => setProjectDialog(null)}
        onDone={(saved) => {
          setProjectDialog(null);
          setSuccess("Project saved.");
          setProjectId(saved.id);
          void loadProjects();
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this report?"
        message={`The saved report for ${report?.projectName ?? "this project"} on ${date} will be removed. This cannot be undone.`}
        confirmLabel="Delete report"
        pending={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
