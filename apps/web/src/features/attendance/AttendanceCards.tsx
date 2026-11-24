import { useState } from "react";
import { CalendarDays, Check, Clock, Ellipsis, Minus, Plus, X } from "lucide-react";
import type { AttendanceRow } from "../../api/attendance";
import { isLeaveStatus, LEAVE_STATUSES, type LeaveStatusValue } from "../../utils/leaveStatuses";
import { ApprovalContent } from "./ApprovalCell";
import { phoneButton } from "../../components/phoneUi";
import { filterGroup, type AttendanceFilter } from "./attendanceFilter";
import { changed, previewPay, stepHours, type AttendanceForm } from "./attendanceForm";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";
const stepperButtonClass = `inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-ink-300 bg-white text-ink-800 active:bg-ink-100 ${focusRing} disabled:cursor-not-allowed disabled:opacity-40`;
const hoursInputClass = `min-h-12 w-full min-w-0 rounded-xl border border-ink-300 bg-white px-1 text-center text-lg font-semibold tabular-nums text-ink-800 ${focusRing} disabled:bg-ink-100 disabled:text-ink-600 [&::-webkit-inner-spin-button]:appearance-none [appearance:textfield]`;
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-ink-600";

/** What a row looks like for each state: a tint over the whole row so a gap in the list is easy to spot. */
const TINT = {
  unrecorded: "border-line bg-white",
  present: "border-green-200 bg-green-50",
  absent: "border-red-200 bg-red-50",
  leave: "border-amber-200 bg-amber-50",
} as const;

/** A number field with minus and plus buttons either side, so hours can be set with a thumb. */
export function HoursField({
  label,
  workerName,
  id,
  value,
  maximum,
  disabled,
  onChange,
}: {
  label: string;
  workerName: string;
  id: string;
  value: string;
  maximum: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const lower = label.toLowerCase();
  const number = Number(value);
  return (
    <div>
      <span aria-hidden="true" className={labelClass}>
        {label}
      </span>
      <div className="mt-1 flex items-stretch gap-2">
        <button
          type="button"
          aria-label={`Decrease ${lower} for ${workerName}`}
          disabled={disabled || !(number > 0)}
          onClick={() => onChange(stepHours(value, -0.5, maximum))}
          className={stepperButtonClass}
        >
          <Minus aria-hidden="true" size={20} />
        </button>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min="0"
          max={maximum}
          step="0.01"
          aria-label={`${label} for ${workerName}`}
          className={hoursInputClass}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={`Increase ${lower} for ${workerName}`}
          disabled={disabled || number >= maximum}
          onClick={() => onChange(stepHours(value, 0.5, maximum))}
          className={stepperButtonClass}
        >
          <Plus aria-hidden="true" size={20} />
        </button>
      </div>
    </div>
  );
}

/** The one-line state under a worker's name: icon, word and (for present workers) the hours, never colour alone. */
function StatusLine({ form }: { form: AttendanceForm }) {
  const base = "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-semibold";
  if (form.status === "Present") {
    const overtime = Number(form.overtimeHours);
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className={`${base} bg-green-100 text-green-900`}>
          <Check aria-hidden="true" size={14} strokeWidth={3} />
          <span>Present</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{Number(form.basicHours).toFixed(2)}</span>
          <span className="font-medium">h</span>
        </span>
        {overtime > 0 && <span className={`${base} bg-ink-800 tabular-nums text-white`}>+{overtime} h OT</span>}
      </span>
    );
  }
  if (form.status === "Absent") {
    return (
      <span className={`${base} bg-red-100 text-red-900`}>
        <X aria-hidden="true" size={14} strokeWidth={3} />
        <span>Absent</span>
      </span>
    );
  }
  if (isLeaveStatus(form.status)) {
    return (
      <span className={`${base} bg-amber-100 text-amber-900`}>
        <CalendarDays aria-hidden="true" size={14} />
        <span>{form.status}</span>
      </span>
    );
  }
  return <span className={`${base} bg-ink-100 font-medium text-ink-600`}>Not marked</span>;
}

/**
 * The phone arrangement of the daily attendance list: one compact row per worker with a thumb-sized tick and cross,
 * a tinted background that shows the state at a glance, and a "more" panel for leave and overtime, which are the
 * exceptions. Replaces the desktop table below the desktop breakpoint.
 */
export function AttendanceCards({
  rows,
  forms,
  editable,
  pending,
  maximum,
  showPay,
  companyRate,
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
  /** Pay line and preview; Supervisors never receive pay figures. */
  showPay: boolean;
  companyRate: number | null;
  /** Managers and administrators edit approved entries and decide on submitted ones. */
  isManager: boolean;
  /** Approve / send back / resubmit are offered only when true (month open, no unsaved edits). */
  canDecide: boolean;
  /** Shows only the workers in this state; the full list when "all". */
  filter?: AttendanceFilter;
  onChange: (id: number, patch: Partial<AttendanceForm>) => void;
  onApprove: (row: AttendanceRow) => void;
  onReject: (row: AttendanceRow) => void;
  onResubmit: (row: AttendanceRow) => void;
}) {
  // One row's leave / overtime panel is open at a time, so the list stays short.
  const [openId, setOpenId] = useState<number | null>(null);
  const visible = rows.filter((_, index) => filter === "all" || filterGroup(forms[index]?.status ?? null) === filter);

  if (visible.length === 0) {
    return (
      <p role="status" className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-ink-600">
        {filter === "unrecorded" ? "Everyone is marked." : "No workers in this view."}
      </p>
    );
  }

  return (
    <ul aria-label={showPay ? "Daily attendance and pay in AED" : "Daily attendance"} className="space-y-2">
      {rows.map((row, index) => {
        const form = forms[index];
        const group = filterGroup(form.status);
        if (filter !== "all" && group !== filter) return null;
        const name = row.worker.fullName;
        // Supervisors cannot change an entry once a manager has approved it.
        const rowEditable = editable && !row.approvedLeave && (isManager || row.record?.approvalStatus !== "Approved");
        const pay = showPay ? previewPay(row, form, maximum, companyRate) : null;
        const open = rowEditable && openId === row.worker.id;
        // A Manager looks at a submitted entry to approve it, not to fill it in, and an approved one is settled: neither shows
        // the tick and cross, so a stray tap cannot clear it and the filled tick is not mistaken for "approved".
        const reviewing = isManager && row.record?.approvalStatus === "Submitted";
        const entrySettled = isManager && (reviewing || row.record?.approvalStatus === "Approved");
        const panelId = `attendance-more-${row.worker.id}`;

        /** Tapping the chosen status again clears it back to "not recorded". A present worker starts on the standard shift. */
        function choose(status: "Present" | "Absent" | LeaveStatusValue) {
          const next = form.status === status ? null : status;
          onChange(form.workerId, {
            status: next,
            basicHours: next === "Present" || isLeaveStatus(next) ? String(maximum) : "0",
            overtimeHours: "0",
          });
        }

        return (
          <li key={row.worker.id} aria-label={name} className={`rounded-2xl border p-3 transition-colors ${TINT[group]}`}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-[1.0625rem] font-semibold leading-snug text-ink-900">
                  {name}
                  {changed(form, row) && (
                    <>
                      <span aria-hidden="true" className="ml-2 inline-block size-2 rounded-full bg-amber-500 align-middle" />
                      <span className="sr-only"> Unsaved</span>
                    </>
                  )}
                </p>
                {/* Until they are recorded the line under the name says who they are; after that the status has a line of its own. */}
                {form.status === null && rowEditable && (
                  <p className="mt-0.5 break-words text-sm text-ink-600">
                    {row.worker.workerCode} · {row.worker.designation}
                    {!row.worker.isActive && " · Inactive"}
                  </p>
                )}
              </div>

              {rowEditable ? (
                <div role={entrySettled ? undefined : "group"} aria-label={entrySettled ? undefined : `Status for ${name}`} className="flex shrink-0 items-center gap-2">
                  {!entrySettled && (
                    <>
                  <button
                    type="button"
                    aria-label="Present"
                    aria-pressed={form.status === "Present"}
                    disabled={pending}
                    onClick={() => choose("Present")}
                    className={`inline-flex size-12 items-center justify-center rounded-xl border-2 transition-colors ${focusRing} disabled:opacity-60 ${
                      form.status === "Present"
                        ? "border-green-700 bg-green-700 text-white"
                        : "border-green-300 bg-white text-green-700 active:bg-green-50"
                    }`}
                  >
                    <Check aria-hidden="true" size={26} strokeWidth={3} />
                  </button>
                  <button
                    type="button"
                    aria-label="Absent"
                    aria-pressed={form.status === "Absent"}
                    disabled={pending}
                    onClick={() => choose("Absent")}
                    className={`inline-flex size-12 items-center justify-center rounded-xl border-2 transition-colors ${focusRing} disabled:opacity-60 ${
                      form.status === "Absent"
                        ? "border-red-700 bg-red-700 text-white"
                        : "border-red-300 bg-white text-red-700 active:bg-red-50"
                    }`}
                  >
                    <X aria-hidden="true" size={26} strokeWidth={3} />
                  </button>
                    </>
                  )}
                  <button
                    type="button"
                    aria-label={`Leave and overtime for ${name}`}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenId(open ? null : row.worker.id)}
                    className={`inline-flex size-10 items-center justify-center rounded-xl text-ink-600 active:bg-ink-100 ${focusRing} ${open ? "bg-ink-100 text-ink-900" : ""}`}
                  >
                    <Ellipsis aria-hidden="true" size={22} />
                  </button>
                </div>
              ) : null}
            </div>

            {(form.status !== null || !rowEditable || (showPay && pay !== null)) && (
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <StatusLine form={form} />
                  {row.approvedLeave && <span className="mt-1 block text-xs text-ink-600">Approved leave. Change it in Leave Management.</span>}
                </div>
                {showPay && form.status !== null && (
                  <p className="shrink-0 text-right">
                    <span className="sr-only">Total pay (AED)</span>
                    <span className="text-lg font-bold tabular-nums text-ink-900">{pay === null ? "—" : pay.toFixed(2)}</span>
                    <span aria-hidden="true" className="ml-1 text-xs font-semibold text-ink-600">AED</span>
                  </p>
                )}
              </div>
            )}

            {open && (
              <div id={panelId} className="mt-3 space-y-3 border-t border-black/5 pt-3">
                {entrySettled && (
                  <div role="group" aria-label={`Status for ${name}`}>
                    <span className={labelClass}>Change the entry</span>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        aria-pressed={form.status === "Present"}
                        disabled={pending}
                        onClick={() => choose("Present")}
                        className={`min-h-12 rounded-xl border text-sm font-bold ${focusRing} ${form.status === "Present" ? "border-brand-700 bg-brand-700 text-white" : "border-ink-300 bg-white text-ink-900"}`}
                      >
                        Present
                      </button>
                      <button
                        type="button"
                        aria-pressed={form.status === "Absent"}
                        disabled={pending}
                        onClick={() => choose("Absent")}
                        className={`min-h-12 rounded-xl border text-sm font-bold ${focusRing} ${form.status === "Absent" ? "border-red-700 bg-red-700 text-white" : "border-ink-300 bg-white text-ink-900"}`}
                      >
                        Absent
                      </button>
                    </div>
                  </div>
                )}
                <div role="group" aria-label={`Leave for ${name}`}>
                  <span className={labelClass}>Leave</span>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    {LEAVE_STATUSES.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={form.status === option}
                        disabled={pending}
                        onClick={() => {
                          choose(option);
                          setOpenId(null);
                        }}
                        className={`min-h-12 rounded-xl border px-1 text-sm font-semibold leading-tight ${focusRing} disabled:opacity-60 ${
                          form.status === option
                            ? "border-amber-700 bg-amber-700 text-white"
                            : "border-ink-300 bg-white text-ink-800 active:bg-ink-100"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
                {form.status === "Present" ? (
                  <HoursField
                    label="Overtime hours"
                    workerName={name}
                    id={`overtimeHours-${form.workerId}`}
                    value={form.overtimeHours}
                    maximum={24}
                    disabled={pending}
                    onChange={(value) => onChange(form.workerId, { overtimeHours: value })}
                  />
                ) : (
                  <p className="text-sm text-ink-600">Mark the worker present to add overtime.</p>
                )}
              </div>
            )}

            {!rowEditable && form.status === "Present" && Number(form.overtimeHours) > 0 && (
              <p className="mt-1 text-sm text-ink-600">
                Overtime <span className="font-medium tabular-nums text-ink-800">{Number(form.overtimeHours).toFixed(2)}</span> h
              </p>
            )}

            {reviewing && canDecide && (
              <div className="mt-3 border-t border-black/5 pt-3">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                  <Clock aria-hidden="true" size={14} />
                  Waiting for approval
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={pending} aria-label={`Approve ${name}`} onClick={() => onApprove(row)} className={phoneButton("primary", "sm")}>
                    Approve
                  </button>
                  <button type="button" disabled={pending} aria-label={`Send back ${name}`} onClick={() => onReject(row)} className={phoneButton("secondary", "sm")}>
                    Send back
                  </button>
                </div>
              </div>
            )}

            {row.record && !(reviewing && canDecide) && (
              <div className="mt-2 border-t border-black/5 pt-2 text-sm">
                <ApprovalContent
                  row={row}
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
          </li>
        );
      })}
    </ul>
  );
}
