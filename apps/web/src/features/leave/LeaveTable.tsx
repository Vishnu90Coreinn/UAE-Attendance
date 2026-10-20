import { Check, Trash2, X } from "lucide-react";
import type { LeaveRequest } from "../../api/leave";

interface Props {
  rows: LeaveRequest[];
  role: string | undefined;
  busy: boolean;
  onApprove: (row: LeaveRequest) => void;
  onReject: (row: LeaveRequest) => void;
  onDelete: (row: LeaveRequest) => void;
}
const actionClass =
  "inline-flex min-h-11 items-center gap-1 rounded-lg border border-gray-300 px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60";
const statusClass = {
  Pending: "bg-amber-100 text-amber-900",
  Approved: "bg-green-100 text-green-900",
  Rejected: "bg-red-100 text-red-900",
};
export function LeaveTable({
  rows,
  role,
  busy,
  onApprove,
  onReject,
  onDelete,
}: Props) {
  const manage = role === "Administrator" || role === "HR Staff";
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="w-full min-w-[850px] text-left text-sm">
        <caption className="sr-only">Leave requests</caption>
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            {[
              "Worker",
              "Leave Type",
              "Start Date",
              "End Date",
              "Days",
              "Status",
              ...(manage ? ["Actions"] : []),
            ].map((label) => (
              <th key={label} scope="col" className="px-4 py-3 font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((row) => (
            <tr key={row.id}>
              <th
                scope="row"
                className="max-w-64 break-words px-4 py-3 font-medium"
              >
                {row.workerName}
                <span className="block text-xs font-normal text-gray-600">
                  {row.workerCode}
                  {!row.workerIsActive && " · Inactive"}
                </span>
              </th>
              <td className="whitespace-nowrap px-4 py-3">{row.leaveType}</td>
              <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                {row.startDate}
              </td>
              <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                {row.endDate}
              </td>
              <td className="px-4 py-3 tabular-nums">{row.days}</td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-3 py-1 font-semibold ${statusClass[row.status]}`}
                >
                  {row.status}
                </span>
              </td>
              {manage && (
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onApprove(row)}
                      className={`${actionClass} text-green-800`}
                      aria-label={`Approve leave for ${row.workerName} starting ${row.startDate}`}
                    >
                      <Check aria-hidden="true" size={16} />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onReject(row)}
                      className={`${actionClass} text-red-700`}
                      aria-label={`Reject leave for ${row.workerName} starting ${row.startDate}`}
                    >
                      <X aria-hidden="true" size={16} />
                      Reject
                    </button>
                    {(role === "Administrator" || row.status === "Pending") && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete(row)}
                        className={`${actionClass} text-red-700`}
                        aria-label={`Delete leave for ${row.workerName} starting ${row.startDate}`}
                      >
                        <Trash2 aria-hidden="true" size={16} />
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
