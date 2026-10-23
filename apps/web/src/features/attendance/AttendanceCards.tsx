import { Check, Minus, Plus, X } from "lucide-react";
import type { AttendanceRow } from "../../api/attendance";
import { isLeaveStatus, LEAVE_STATUSES, type LeaveStatusValue } from "../../utils/leaveStatuses";
import { ApprovalContent } from "./ApprovalCell";
import { changed, previewPay, stepHours, type AttendanceForm } from "./attendanceForm";

const stepperButtonClass =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40";
const hoursInputClass =
  "min-h-11 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-1 text-center text-base tabular-nums text-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:bg-gray-100 disabled:text-gray-600 [&::-webkit-inner-spin-button]:appearance-none [appearance:textfield]";
const choiceClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "block text-xs font-semibold uppercase text-gray-600";

/** A number field with minus and plus buttons either side, so hours can be set with a thumb. */
function HoursField({
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
      <div className="mt-1 flex items-stretch gap-1.5">
        <button
          type="button"
          aria-label={`Decrease ${lower} for ${workerName}`}
          disabled={disabled || !(number > 0)}
          onClick={() => onChange(stepHours(value, -0.5, maximum))}
          className={stepperButtonClass}
        >
          <Minus aria-hidden="true" size={18} />
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
          <Plus aria-hidden="true" size={18} />
        </button>
      </div>
    </div>
  );
}

/**
 * The phone arrangement of the daily attendance list: one card per worker with large Present / Absent buttons,
 * hour steppers and the approval actions, instead of the desktop table.
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
  onChange: (id: number, patch: Partial<AttendanceForm>) => void;
  onApprove: (row: AttendanceRow) => void;
  onReject: (row: AttendanceRow) => void;
  onResubmit: (row: AttendanceRow) => void;
}) {
  return (
    <ul aria-label={showPay ? "Daily attendance and pay in AED" : "Daily attendance"} className="space-y-3">
      {rows.map((row, index) => {
        const form = forms[index];
        const name = row.worker.fullName;
        // Supervisors cannot change an entry once a manager has approved it.
        const rowEditable = editable && (isManager || row.record?.approvalStatus !== "Approved");
        const pay = showPay ? previewPay(row, form, maximum, companyRate) : null;

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
          <li key={row.worker.id} aria-label={name} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-semibold text-gray-800">{name}</p>
                <p className="text-xs text-gray-600">
                  {row.worker.workerCode} · {row.worker.designation}
                  {!row.worker.isActive && " · Inactive"}
                </p>
              </div>
              {changed(form, row) && (
                <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900">Unsaved</span>
              )}
            </div>

            {rowEditable ? (
              <div role="group" aria-label={`Status for ${name}`} className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={form.status === "Present"}
                  disabled={pending}
                  onClick={() => choose("Present")}
                  className={`${choiceClass} ${
                    form.status === "Present"
                      ? "border-green-700 bg-green-700 text-white"
                      : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  <Check aria-hidden="true" size={18} />
                  Present
                </button>
                <button
                  type="button"
                  aria-pressed={form.status === "Absent"}
                  disabled={pending}
                  onClick={() => choose("Absent")}
                  className={`${choiceClass} ${
                    form.status === "Absent"
                      ? "border-red-700 bg-red-700 text-white"
                      : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  <X aria-hidden="true" size={18} />
                  Absent
                </button>
                {LEAVE_STATUSES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={form.status === option}
                    disabled={pending}
                    onClick={() => choose(option)}
                    className={`${choiceClass} ${
                      form.status === option
                        ? "border-slate-700 bg-slate-700 text-white"
                        : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3">
                <span className="inline-block whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-800">
                  {form.status ?? "Not recorded"}
                </span>
              </p>
            )}

            {form.status === "Present" &&
              (rowEditable ? (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className={labelClass}>Basic hours</p>
                    <p className="mt-1 font-medium tabular-nums text-gray-800">{Number(form.basicHours).toFixed(2)}</p>
                  </div>
                  <HoursField
                    label="Overtime hours"
                    workerName={name}
                    id={`overtimeHours-${form.workerId}`}
                    value={form.overtimeHours}
                    maximum={24}
                    disabled={pending}
                    onChange={(value) => onChange(form.workerId, { overtimeHours: value })}
                  />
                </div>
              ) : (
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className={labelClass}>Basic hours</dt>
                    <dd className="font-medium tabular-nums text-gray-800">{Number(form.basicHours).toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt className={labelClass}>Overtime hours</dt>
                    <dd className="font-medium tabular-nums text-gray-800">{Number(form.overtimeHours).toFixed(2)}</dd>
                  </div>
                </dl>
              ))}

            {showPay && (
              <p className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                <span className={labelClass}>Total pay (AED)</span>
                <span className="text-lg font-bold tabular-nums text-gray-800">{pay === null ? "—" : pay.toFixed(2)}</span>
              </p>
            )}

            {row.record && (
              <div className="mt-3 border-t border-gray-100 pt-3 text-sm">
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
