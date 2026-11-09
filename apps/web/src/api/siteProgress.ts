import { apiGet, apiGetBlob, apiGetFile, apiPost, apiPut, apiDelete } from "./client";

export type Completion = "NotStarted" | "InProgress" | "Completed";
export type WirStatus = "Pending" | "Submitted" | "Approved" | "ApprovedWithComments" | "Rejected";

export interface SiteProject {
  id: number;
  name: string;
  isActive: boolean;
}

export interface SiteFloor {
  floor: string;
  frames: number;
  glass: number;
  completion: Completion;
  wirStatus: WirStatus;
  remarks: string;
}

export interface SiteKpis {
  totalFrames: number;
  totalGlass: number;
  completedFloors: number;
  noProgressFloors: number;
  pendingWir: number;
}

export interface SiteReport {
  projectId: number;
  projectName: string;
  date: string;
  /** False when nothing is saved for the date yet; `floors` is then the earlier report offered as a starting point. */
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

export const WIR_OPTIONS: { value: WirStatus; label: string }[] = [
  { value: "Pending", label: "Not Submitted" },
  { value: "Submitted", label: "Inspection Submitted" },
  { value: "Approved", label: "Approved" },
  { value: "ApprovedWithComments", label: "Approved with Comments" },
  { value: "Rejected", label: "Rejected" },
];

export function completionLabel(value: Completion): string {
  return COMPLETION_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
export function wirLabel(value: WirStatus): string {
  return WIR_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/**
 * The summary figures. The server computes the same numbers; the page recomputes them from the rows on screen so they
 * follow unsaved edits. Pending WIR is every floor whose inspection is not yet approved.
 */
export function computeKpis(floors: readonly SiteFloor[]): SiteKpis {
  const kpis: SiteKpis = { totalFrames: 0, totalGlass: 0, completedFloors: 0, noProgressFloors: 0, pendingWir: 0 };
  for (const f of floors) {
    kpis.totalFrames += f.frames;
    kpis.totalGlass += f.glass;
    if (f.completion === "Completed") kpis.completedFloors++;
    if (f.frames === 0 && f.glass === 0) kpis.noProgressFloors++;
    if (f.wirStatus !== "Approved" && f.wirStatus !== "ApprovedWithComments") kpis.pendingWir++;
  }
  return kpis;
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
export function listReportDates(projectId: number): Promise<string[]> {
  return apiGet(`/api/site-progress/${projectId}/dates`);
}
export function getReport(projectId: number, date: string): Promise<SiteReport> {
  return apiGet(`/api/site-progress/${projectId}?date=${encodeURIComponent(date)}`);
}
export function saveReport(projectId: number, date: string, floors: SiteFloor[]): Promise<SiteReport> {
  return apiPut<SiteReport>(`/api/site-progress/${projectId}/${encodeURIComponent(date)}`, { floors });
}
export function deleteReport(projectId: number, date: string): Promise<void> {
  return apiDelete(`/api/site-progress/${projectId}/${encodeURIComponent(date)}`);
}
export function downloadReportPdf(projectId: number, date: string): Promise<Blob> {
  return apiGetBlob(`/api/site-progress/${projectId}/pdf?date=${encodeURIComponent(date)}`);
}
export function downloadReportCsv(projectId: number, date: string): Promise<Blob> {
  return apiGetFile(`/api/site-progress/${projectId}/csv?date=${encodeURIComponent(date)}`, "text/csv");
}
