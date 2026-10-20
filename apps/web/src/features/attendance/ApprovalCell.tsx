import { Check, Clock, RotateCcw, X } from "lucide-react";
import type { AttendanceRow } from "../../api/attendance";

const actionClass =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The approval state of one attendance entry. State is always text plus an icon, never colour alone.
 * Managers can approve or send back a submitted entry; supervisors can resubmit one that was sent back.
 */
export function ApprovalCell({
  row,
  isManager,
  canAct,
  pending,
  className,
  onApprove,
  onReject,
  onResubmit,
}: {
  row: AttendanceRow;
  isManager: boolean;
  /** False while the month is locked or there are unsaved edits. */
  canAct: boolean;
  pending: boolean;
  className: string;
  onApprove: (row: AttendanceRow) => void;
  onReject: (row: AttendanceRow) => void;
  onResubmit: (row: AttendanceRow) => void;
}) {
  const record = row.record;
  const name = row.worker.fullName;
  return (
    <td data-label="Approval" className={className}>
      <div className="flex flex-col items-end gap-2 md:items-start">
        {!record && <span className="text-gray-600">—</span>}
        {record?.approvalStatus === "Approved" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-green-800">
            <Check aria-hidden="true" size={14} />
            Approved
          </span>
        )}
        {record?.approvalStatus === "Submitted" && (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-amber-900">
              <Clock aria-hidden="true" size={14} />
              Waiting for approval
            </span>
            {isManager && canAct && (
              <div className="flex flex-wrap justify-end gap-2 md:justify-start">
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Approve ${name}`}
                  onClick={() => onApprove(row)}
                  className={`${actionClass} border-green-700 text-green-800 hover:bg-green-50 focus-visible:outline-green-700`}
                >
                  <Check aria-hidden="true" size={16} />
                  Approve
                </button>
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Send back ${name}`}
                  onClick={() => onReject(row)}
                  className={`${actionClass} border-red-700 text-red-800 hover:bg-red-50 focus-visible:outline-red-700`}
                >
                  <X aria-hidden="true" size={16} />
                  Send back
                </button>
              </div>
            )}
          </>
        )}
        {record?.approvalStatus === "Rejected" && (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-red-800">
              <X aria-hidden="true" size={14} />
              Sent back
            </span>
            {record.rejectionReason && (
              <span className="max-w-64 text-right text-xs text-red-800 md:text-left">
                Reason: {record.rejectionReason}
              </span>
            )}
            {!isManager && canAct && (
              <button
                type="button"
                disabled={pending}
                aria-label={`Resubmit ${name}`}
                onClick={() => onResubmit(row)}
                className={`${actionClass} border-blue-700 text-blue-800 hover:bg-blue-50 focus-visible:outline-blue-700`}
              >
                <RotateCcw aria-hidden="true" size={16} />
                Resubmit
              </button>
            )}
          </>
        )}
      </div>
    </td>
  );
}
