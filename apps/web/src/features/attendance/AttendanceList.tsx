import { useState, type ReactNode } from "react";
import { CalendarDays, Check, Lock, TriangleAlert, X } from "lucide-react";
import type { AttendanceRow } from "../../api/attendance";
import { Dialog } from "../../components/Dialog";
import { isLeaveStatus, LEAVE_STATUSES, type LeaveStatusValue } from "../../utils/leaveStatuses";
import { ApprovalContent } from "./ApprovalCell";
import { HoursField } from "./AttendanceCards";
import { filterGroup, type AttendanceFilter } from "./attendanceFilter";
import { phoneButton } from "../../components/phoneUi";
import type { AttendanceForm } from "./attendanceForm";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

const AVATAR = {
  unrecorded: "bg-ink-100 text-ink-700",
  present: "bg-brand-100 text-brand-800",
  absent: "bg-red-100 text-red-800",
  leave: "bg-amber-100 text-amber-900",
} as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** One button of the ✓ / ✕ / leave control: filled with its state colour when chosen, a quiet icon when not. */
function Segment({
  label,
  pressed,
  tone,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  tone: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-11 place-items-center rounded-xl transition-colors duration-150 ${focusRing} disabled:opacity-60 ${
        pressed ? tone : "text-ink-500 active:bg-white"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The supervisor's phone list: one row per person with an avatar, their name and state, and a three-way control.
 * Tap ✓ or ✕ to mark; the calendar button, or the row itself, opens a sheet for leave, overtime and the approval
 * history. The rows sit in one grouped card so the whole crew reads as a single list.
 */
export function AttendanceList({
  rows,
  forms,
  editable,
  pending,
  maximum,
  isManager,
  canDecide,
  filter = "all",
  onChange,
  onApprove,
  onReject,
  onResubmit,
}: {
  rows: AttendanceRow[];
  forms: AttendanceForm[];
  editable: boolean;
  pending: boolean;
  maximum: number;
  isManager: boolean;
  canDecide: boolean;
  filter?: AttendanceFilter;
  onChange: (id: number, patch: Partial<AttendanceForm>) => void;
  onApprove: (row: AttendanceRow) => void;
  onReject: (row: AttendanceRow) => void;
  onResubmit: (row: AttendanceRow) => void;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const openIndex = rows.findIndex((row) => row.worker.id === openId);
  const visible = rows.filter((_, index) => filter === "all" || filterGroup(forms[index]?.status ?? null) === filter);

  function editableRow(row: AttendanceRow): boolean {
    // Supervisors cannot change an entry once a manager has approved it.
    return editable && !row.approvedLeave && (isManager || row.record?.approvalStatus !== "Approved");
  }
  function setStatus(form: AttendanceForm, status: "Present" | "Absent" | LeaveStatusValue | null) {
    onChange(form.workerId, {
      status,
      basicHours: status === "Present" || isLeaveStatus(status) ? String(maximum) : "0",
      overtimeHours: "0",
    });
  }

  if (visible.length === 0) {
    return (
      <p role="status" className="rounded-3xl border border-line bg-white px-4 py-10 text-center text-ink-600 shadow-card">
        {filter === "unrecorded" ? "Everyone is marked." : "Nobody in this view."}
      </p>
    );
  }

  const sheetRow = openIndex >= 0 ? rows[openIndex] : null;
  const sheetForm = openIndex >= 0 ? forms[openIndex] : null;
  const sheetEditable = sheetRow ? editableRow(sheetRow) : false;

  return (
    <>
      <ul aria-label="Daily attendance" className="divide-y divide-ink-100 overflow-hidden rounded-3xl border border-line bg-white shadow-card">
        {rows.map((row, index) => {
          const form = forms[index];
          const group = filterGroup(form.status);
          if (filter !== "all" && group !== filter) return null;
          const name = row.worker.fullName;
          const canEdit = editableRow(row);
          const rejected = row.record?.approvalStatus === "Rejected";
          const approved = row.record?.approvalStatus === "Approved";
          const overtime = Number(form.overtimeHours);

          return (
            <li key={row.worker.id} aria-label={name} className="flex items-center gap-2 py-2 pl-3 pr-2">
              <button
                type="button"
                aria-label={`Details for ${name}`}
                onClick={() => setOpenId(row.worker.id)}
                className={`flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-1.5 text-left active:bg-ink-50 ${focusRing}`}
              >
                <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold ${AVATAR[group]}`}>
                  {initials(name)}
                </span>
                <span className="min-w-0">
                  <span className="block break-words text-base font-semibold leading-snug text-ink-900">{name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.8125rem] leading-tight">
                    {rejected ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                        <TriangleAlert aria-hidden="true" size={13} />
                        Sent back
                      </span>
                    ) : group === "present" ? (
                      <span className="font-semibold text-brand-700">Present</span>
                    ) : group === "absent" ? (
                      <span className="font-semibold text-red-700">Absent</span>
                    ) : group === "leave" ? (
                      <span className="font-semibold text-amber-900">{form.status}</span>
                    ) : (
                      <span className="text-ink-600">{row.worker.designation || row.worker.workerCode}</span>
                    )}
                    {group === "present" && overtime > 0 && (
                      <span className="rounded-md bg-brand-700 px-1.5 py-0.5 text-xs font-bold tabular-nums text-white">
                        +{overtime} h<span className="sr-only"> overtime</span>
                      </span>
                    )}
                    {approved && (
                      <span className="inline-flex items-center gap-1 text-ink-600">
                        <Lock aria-hidden="true" size={12} />
                        Approved
                      </span>
                    )}
                  </span>
                </span>
              </button>

              {canEdit && (
                <div role="group" aria-label={`Status for ${name}`} className="flex shrink-0 gap-1 rounded-2xl bg-ink-100 p-1">
                  <Segment
                    label="Present"
                    pressed={form.status === "Present"}
                    tone="bg-brand-600 text-white"
                    disabled={pending}
                    onClick={() => setStatus(form, form.status === "Present" ? null : "Present")}
                  >
                    <Check aria-hidden="true" size={22} strokeWidth={3} />
                  </Segment>
                  <Segment
                    label="Absent"
                    pressed={form.status === "Absent"}
                    tone="bg-red-600 text-white"
                    disabled={pending}
                    onClick={() => setStatus(form, form.status === "Absent" ? null : "Absent")}
                  >
                    <X aria-hidden="true" size={22} strokeWidth={3} />
                  </Segment>
                  <Segment
                    label="Leave or overtime"
                    pressed={group === "leave"}
                    tone="bg-amber-400 text-ink-900"
                    disabled={pending}
                    onClick={() => setOpenId(row.worker.id)}
                  >
                    <CalendarDays aria-hidden="true" size={21} strokeWidth={2.25} />
                  </Segment>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog open={sheetRow !== null} onClose={() => setOpenId(null)} title={sheetRow?.worker.fullName ?? ""} variant="sheet">
        {sheetRow && sheetForm && (
          <div className="mt-1 space-y-4">
            <p className="text-sm text-ink-600">
              {sheetRow.worker.workerCode} · {sheetRow.worker.designation}
              {!sheetRow.worker.isActive && " · Inactive"}
            </p>

            {sheetEditable ? (
              <>
                <div role="group" aria-label={`Status for ${sheetRow.worker.fullName}`} className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    aria-pressed={sheetForm.status === "Present"}
                    disabled={pending}
                    onClick={() => setStatus(sheetForm, sheetForm.status === "Present" ? null : "Present")}
                    className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border text-base font-bold ${focusRing} ${
                      sheetForm.status === "Present" ? "border-brand-600 bg-brand-600 text-white" : "border-ink-300 bg-white text-ink-900"
                    }`}
                  >
                    <Check aria-hidden="true" size={20} strokeWidth={3} />
                    Present
                  </button>
                  <button
                    type="button"
                    aria-pressed={sheetForm.status === "Absent"}
                    disabled={pending}
                    onClick={() => {
                      setStatus(sheetForm, sheetForm.status === "Absent" ? null : "Absent");
                      setOpenId(null);
                    }}
                    className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border text-base font-bold ${focusRing} ${
                      sheetForm.status === "Absent" ? "border-red-600 bg-red-600 text-white" : "border-ink-300 bg-white text-ink-900"
                    }`}
                  >
                    <X aria-hidden="true" size={20} strokeWidth={3} />
                    Absent
                  </button>
                </div>
                <div role="group" aria-label={`Leave for ${sheetRow.worker.fullName}`}>
                  <span className="block text-xs font-bold uppercase tracking-wide text-ink-600">Leave</span>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {LEAVE_STATUSES.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={sheetForm.status === option}
                        disabled={pending}
                        onClick={() => {
                          setStatus(sheetForm, sheetForm.status === option ? null : option);
                          setOpenId(null);
                        }}
                        className={`min-h-14 rounded-2xl border px-1 text-sm font-bold leading-tight ${focusRing} ${
                          sheetForm.status === option ? "border-amber-400 bg-amber-400 text-ink-900" : "border-ink-300 bg-white text-ink-900"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
                {sheetForm.status === "Present" && (
                  <HoursField
                    label="Overtime hours"
                    workerName={sheetRow.worker.fullName}
                    id={`overtimeHours-${sheetForm.workerId}`}
                    value={sheetForm.overtimeHours}
                    maximum={24}
                    disabled={pending}
                    onChange={(value) => onChange(sheetForm.workerId, { overtimeHours: value })}
                  />
                )}
              </>
            ) : (
              <p className="text-base font-semibold text-ink-900">
                {sheetForm.status ?? "Not recorded"}
                {sheetForm.status === "Present" && (
                  <span className="font-medium text-ink-700">
                    {" "}
                    · <span className="tabular-nums">{Number(sheetForm.basicHours).toFixed(2)}</span> h
                    {Number(sheetForm.overtimeHours) > 0 && (
                      <>
                        {" "}
                        + <span className="tabular-nums">{Number(sheetForm.overtimeHours).toFixed(2)}</span> h overtime
                      </>
                    )}
                  </span>
                )}
                {sheetRow.approvedLeave && (
                  <span className="mt-1 block text-sm font-normal text-ink-600">Approved leave. Change it in Leave Management.</span>
                )}
              </p>
            )}

            {sheetRow.record && (
              <div className="border-t border-line pt-3 text-sm">
                <ApprovalContent
                  row={sheetRow}
                  isManager={isManager}
                  canAct={canDecide}
                  pending={pending}
                  layout="card"
                  onApprove={onApprove}
                  onReject={onReject}
                  onResubmit={onResubmit}
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => setOpenId(null)}
              className={phoneButton("primary", "lg", "w-full")}
            >
              Done
            </button>
          </div>
        )}
      </Dialog>
    </>
  );
}
