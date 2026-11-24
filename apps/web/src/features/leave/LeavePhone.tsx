import { Check, Hourglass, Paperclip, Trash2, X, type LucideIcon } from "lucide-react";
import type { Role } from "../../api/auth";
import type { LeaveRequest, LeaveStatus } from "../../api/leave";
import { isManagement } from "../../permissions";
import { RowMenu, type RowMenuItem } from "../../ui";
import { phoneButton } from "../../components/phoneUi";
import { canDeleteLeave } from "./LeaveTable";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
function parts(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day, label: MONTH.format(new Date(Date.UTC(year, month - 1, day))) };
}

/**
 * A request's dates the way people say them: "25-28 Nov" within a month, "28 Nov - 2 Dec" across two, a single day on
 * its own. The year appears only when it is not this year, so a request from last December is not mistaken for this one.
 */
export function formatRange(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  const thisYear = new Date().getUTCFullYear();
  const year = (y: number) => (y === thisYear ? "" : ` ${y}`);
  if (start === end) return `${a.day} ${a.label}${year(a.year)}`;
  if (a.year === b.year && a.month === b.month) return `${a.day}–${b.day} ${a.label}${year(a.year)}`;
  return `${a.day} ${a.label}${a.year === b.year ? "" : year(a.year)} – ${b.day} ${b.label}${year(b.year)}`;
}

const STATUS: Record<LeaveStatus, { tone: string; icon: LucideIcon }> = {
  Pending: { tone: "bg-amber-100 text-amber-900", icon: Hourglass },
  Approved: { tone: "bg-brand-100 text-brand-800", icon: Check },
  Rejected: { tone: "bg-red-100 text-red-800", icon: X },
};

/** The status as an icon, a word and a tint, never colour alone. */
export function StatusPill({ status }: { status: LeaveStatus }) {
  const { tone, icon: Icon } = STATUS[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
      <Icon aria-hidden="true" size={13} strokeWidth={3} />
      {status}
    </span>
  );
}

interface LeaveListProps {
  rows: LeaveRequest[];
  role: Role | undefined;
  /** Signed-in username; a Supervisor may delete only their own pending requests. */
  username: string | undefined;
  busy: boolean;
  onApprove: (row: LeaveRequest) => void;
  onReject: (row: LeaveRequest) => void;
  onDelete: (row: LeaveRequest) => void;
  onViewPhoto: (row: LeaveRequest) => void;
}

function Row({ row, role, username, busy, onApprove, onReject, onDelete, onViewPhoto }: LeaveListProps & { row: LeaveRequest }) {
  const manage = isManagement(role);
  const days = `${row.days} ${row.days === 1 ? "day" : "days"}`;
  const menu: RowMenuItem[] = [
    ...(manage && row.status === "Approved" ? [{ label: "Reject", icon: X, disabled: busy, onSelect: () => onReject(row) }] : []),
    ...(canDeleteLeave(row, role, username) ? [{ label: "Delete", icon: Trash2, danger: true, disabled: busy, onSelect: () => onDelete(row) }] : []),
  ];
  const who =
    row.status === "Pending"
      ? manage
        ? `Requested by ${row.createdBy}`
        : "Waiting for a manager's decision"
      : row.decidedBy
        ? `${row.status} by ${row.decidedBy}`
        : row.status;
  return (
    <li aria-label={`${row.workerName}, ${row.leaveType}`} className="px-4 py-4">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-words text-base font-semibold leading-snug text-ink-900">
          {row.workerName}
          {!row.workerIsActive && <span className="ml-2 rounded-md bg-ink-200 px-1.5 py-0.5 align-middle text-xs font-semibold text-ink-700">Inactive</span>}
        </p>
        <StatusPill status={row.status} />
        {menu.length > 0 && (
          <RowMenu label={`More actions for ${row.workerName} starting ${row.startDate}`} items={menu} className="-my-1.5 -mr-2 shrink-0" />
        )}
      </div>
      <p className="mt-1 text-[0.9375rem] font-medium text-ink-800">
        {row.leaveType} · <span className="tabular-nums">{formatRange(row.startDate, row.endDate)}</span> · {days}
      </p>
      <p className="mt-1.5 text-[0.8125rem] text-ink-600">
        {row.workerCode} · {who}
      </p>
      {row.hasAttachment && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onViewPhoto(row)}
          aria-label={`View photo for ${row.workerName} starting ${row.startDate}`}
          className={phoneButton("secondary", "sm", "mt-3")}
        >
          <Paperclip aria-hidden="true" size={16} />
          View note
        </button>
      )}
      {manage && row.status !== "Approved" && (
        <div className={`mt-4 grid gap-2 ${row.status === "Pending" ? "grid-cols-2" : "grid-cols-1"}`}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onApprove(row)}
            aria-label={`Approve leave for ${row.workerName} starting ${row.startDate}`}
            className={phoneButton("primary", "sm")}
          >
            <Check aria-hidden="true" size={16} strokeWidth={3} />
            Approve
          </button>
          {row.status === "Pending" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onReject(row)}
              aria-label={`Reject leave for ${row.workerName} starting ${row.startDate}`}
              className={phoneButton("danger", "sm")}
            >
              <X aria-hidden="true" size={16} strokeWidth={3} />
              Reject
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Leave requests on a phone. What is still waiting for a decision comes first, in its own group, soonest start first;
 * decided requests follow, newest first. Each request is one card: who, what, when, and the status at the right.
 */
export function LeaveList(props: LeaveListProps) {
  const manage = isManagement(props.role);
  const pending = props.rows.filter((r) => r.status === "Pending").sort((a, b) => a.startDate.localeCompare(b.startDate));
  const decided = props.rows.filter((r) => r.status !== "Pending").sort((a, b) => b.startDate.localeCompare(a.startDate));
  const headed = pending.length > 0 && decided.length > 0;
  const group = (title: string, rows: LeaveRequest[]) => (
    <section aria-label={title} className="space-y-2">
      {headed && <h3 className="px-1 text-sm font-bold text-ink-700">{title}</h3>}
      <ul aria-label={title} className="divide-y divide-ink-100 overflow-hidden rounded-3xl border border-line bg-white shadow-card">
        {rows.map((row) => (
          <Row key={row.id} row={row} {...props} />
        ))}
      </ul>
    </section>
  );
  return (
    <div className="space-y-4">
      {pending.length > 0 && group(`${manage ? "Needs your decision" : "Waiting for approval"} · ${pending.length}`, pending)}
      {decided.length > 0 && group(pending.length > 0 ? "Decided" : "Requests", decided)}
    </div>
  );
}
