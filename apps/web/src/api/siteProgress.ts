import { apiGet, apiGetBlob, apiGetFile, apiPost, apiPut } from "./client";

export type Completion = "NotStarted" | "InProgress" | "Completed";
export type Alignment = "NotComplete" | "UnderProcess" | "Complete";
export type WirStatus =
  | "Pending"
  | "Submitted"
  | "AlignmentNotComplete"
  | "AlignmentUnderProcess"
  | "AlignmentComplete"
  | "Approved"
  | "ApprovedWithComments"
  | "Rejected";

export interface SiteProject {
  id: number;
  name: string;
  isActive: boolean;
}

export interface SiteFloor {
  floor: string;
  frames: number;
  glass: number;
  shutters: number;
  alignment: Alignment;
  completion: Completion;
  wirStatus: WirStatus;
  remarks: string;
  /** A manager locked this floor: it cannot be changed or removed until it is unlocked. */
  isLocked?: boolean;
}

export interface SiteKpis {
  totalFrames: number;
  totalGlass: number;
  totalShutters: number;
  completedFloors: number;
  noProgressFloors: number;
  pendingWir: number;
  approvedWir: number;
  rejectedWir: number;
  alignmentNotComplete: number;
  alignmentUnderProcess: number;
  alignmentComplete: number;
  /** Share of floors that are completed and WIR-approved, as a whole percent. */
  handoverReadyPercent: number;
}

export interface SiteReport {
  projectId: number;
  projectName: string;
  date: string;
  /** False when the project has no saved report yet; `floors` is then empty. */
  exists: boolean;
  copiedFromDate: string | null;
  updatedBy: string | null;
  updatedUtc: string | null;
  floors: SiteFloor[];
  kpis: SiteKpis;
}

export const COMPLETION_OPTIONS: { value: Completion; label: string }[] = [
  { value: "NotStarted", label: "Not Started" },
  { value: "InProgress", label: "In Progress" },
  { value: "Completed", label: "Completed" },
];

export const ALIGNMENT_OPTIONS: { value: Alignment; label: string }[] = [
  { value: "NotComplete", label: "Alignment Not Complete" },
  { value: "UnderProcess", label: "Alignment Under Process" },
  { value: "Complete", label: "Alignment Complete" },
];

export const WIR_OPTIONS: { value: WirStatus; label: string }[] = [
  { value: "Pending", label: "Not Submitted" },
  { value: "Submitted", label: "Inspection Submitted" },
  { value: "AlignmentNotComplete", label: "WIR: Alignment Not Complete" },
  { value: "AlignmentUnderProcess", label: "WIR: Alignment Under Process" },
  { value: "AlignmentComplete", label: "WIR: Alignment Complete" },
  { value: "Approved", label: "Approved" },
  { value: "ApprovedWithComments", label: "Approved with Comments" },
  { value: "Rejected", label: "Rejected" },
];

export function completionLabel(value: Completion): string {
  return COMPLETION_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
export function alignmentLabel(value: Alignment): string {
  return ALIGNMENT_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
export function wirLabel(value: WirStatus): string {
  return WIR_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/**
 * The summary figures. The server computes the same numbers; the page recomputes them from the rows on screen so they
 * follow unsaved edits. Approved WIR is Approved or Approved with Comments, Rejected stands alone and every other
 * status is pending. A floor is handover ready when it is completed and its WIR is approved.
 */
export function computeKpis(floors: readonly SiteFloor[]): SiteKpis {
  const k: SiteKpis = {
    totalFrames: 0, totalGlass: 0, totalShutters: 0, completedFloors: 0, noProgressFloors: 0, pendingWir: 0, approvedWir: 0,
    rejectedWir: 0, alignmentNotComplete: 0, alignmentUnderProcess: 0, alignmentComplete: 0, handoverReadyPercent: 0,
  };
  let ready = 0;
  for (const f of floors) {
    k.totalFrames += f.frames;
    k.totalGlass += f.glass;
    k.totalShutters += f.shutters;
    if (f.completion === "Completed") k.completedFloors++;
    if (f.frames === 0 && f.glass === 0 && f.shutters === 0) k.noProgressFloors++;
    const approved = f.wirStatus === "Approved" || f.wirStatus === "ApprovedWithComments";
    if (approved) k.approvedWir++;
    else if (f.wirStatus === "Rejected") k.rejectedWir++;
    else k.pendingWir++;
    if (approved && f.completion === "Completed") ready++;
    if (f.alignment === "Complete") k.alignmentComplete++;
    else if (f.alignment === "UnderProcess") k.alignmentUnderProcess++;
    else k.alignmentNotComplete++;
  }
  k.handoverReadyPercent = floors.length === 0 ? 0 : Math.round((ready * 100) / floors.length);
  return k;
}

export function listProjects(includeInactive = false): Promise<SiteProject[]> {
  return apiGet(`/api/site-projects${includeInactive ? "?includeInactive=true" : ""}`);
}
export function createProject(name: string): Promise<SiteProject> {
  return apiPost<SiteProject>("/api/site-projects", { name });
}
export function updateProject(id: number, name: string, isActive: boolean): Promise<SiteProject> {
  return apiPut<SiteProject>(`/api/site-projects/${id}`, { name, isActive });
}
/** The live report: the project's current floors. The server keeps each day's last save as a snapshot behind it. */
export function getReport(projectId: number): Promise<SiteReport> {
  return apiGet(`/api/site-progress/${projectId}`);
}
export function saveReport(projectId: number, floors: SiteFloor[]): Promise<SiteReport> {
  return apiPut<SiteReport>(`/api/site-progress/${projectId}`, { floors });
}
export function downloadReportPdf(projectId: number): Promise<Blob> {
  return apiGetBlob(`/api/site-progress/${projectId}/pdf`);
}
export function downloadReportCsv(projectId: number): Promise<Blob> {
  return apiGetFile(`/api/site-progress/${projectId}/csv`, "text/csv");
}
