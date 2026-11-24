import type { CertificateRequest } from "../../api/certificateRequests";

export interface RequestRoles {
  /** Supervisors, Managers and the Administrator raise requests. */
  canRaise: boolean;
  /** HR and the Administrator add and update the details and send for approval. */
  canPrepare: boolean;
  /** A Manager prepares only the requests they raised themselves; this is their own username. */
  prepareOwnAs?: string;
  /** Managers and the Administrator prepare requests raised by office employees; HR never does. */
  prepareEmployeeRequests?: boolean;
  /** Managers and the Administrator approve or send back. */
  canApprove: boolean;
  /** HR, Managers and the Administrator open requests and download approved certificates. */
  canOpen: boolean;
}

/** Whether the signed-in user may prepare a request raised by `requestedBy`. */
export function mayPrepare(roles: RequestRoles, requestedBy: string, category?: string): boolean {
  if (category === "Employee") return roles.prepareEmployeeRequests === true;
  return roles.canPrepare || (roles.prepareOwnAs !== undefined && roles.prepareOwnAs === requestedBy);
}

/** True when the next step on this request is the signed-in user's: prepare it, or approve it. */
export function needsMe(row: CertificateRequest, roles: RequestRoles): boolean {
  if ((row.status === "Requested" || row.status === "Returned") && mayPrepare(roles, row.requestedBy, row.workerCategory)) return true;
  return roles.canApprove && row.status === "PendingApproval";
}

/** What the signed-in user can do about a request that they can open: Prepare, Review, or just Open. */
export function openLabel(row: CertificateRequest, roles: RequestRoles): "Prepare" | "Review" | "Open" {
  if (mayPrepare(roles, row.requestedBy, row.workerCategory) && (row.status === "Requested" || row.status === "Returned")) return "Prepare";
  if (roles.canApprove && row.status === "PendingApproval") return "Review";
  return "Open";
}
