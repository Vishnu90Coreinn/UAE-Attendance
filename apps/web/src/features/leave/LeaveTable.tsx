import { Check, Trash2, X } from "lucide-react";
import type { Role } from "../../api/auth";
import type { LeaveRequest } from "../../api/leave";
import { isManagement } from "../../permissions";

interface Props {
  rows: LeaveRequest[];
  role: Role | undefined;
  /** Signed-in username; a Supervisor may delete only their own pending requests. */
  username: string | undefined;
  busy: boolean;
  onApprove: (row: LeaveRequest) => void;
  onReject: (row: LeaveRequest) => void;
  onDelete: (row: LeaveRequest) => void;
}
const actionClass =
  "inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-gray-300 px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 max-md:flex-1";
const statusClass = {
  Pending: "bg-amber-100 text-amber-900",
  Approved: "bg-green-100 text-green-900",
  Rejected: "bg-red-100 text-red-900",
};
/** On phones each row becomes a labelled card; from md up it is an ordinary table row. */
const cellClass =
  "flex items-center justify-between gap-3 px-4 py-2 before:content-[attr(data-label)] before:text-xs before:font-semibold before:uppercase before:text-gray-600 md:table-cell md:py-3 md:before:content-none";

export function LeaveTable({
  rows,
  role,
  username,
  busy,
  onApprove,
  onReject,
  onDelete,
}: Props) {
  const manage = isManagement(role);
  const canDelete = (row: LeaveRequest) =>
    manage ||
    (role === "Supervisor" &&
      row.status === "Pending" &&
      !!username &&
      row.createdBy === username);
  const showActions = manage || rows.some(canDelete);
  return (
    <div className="max-w-full rounded-lg border-gray-200 md:overflow-x-auto md:border md:bg-white md:shadow-sm">
      <table className="block w-full text-left text-sm md:table">
        <caption className="sr-only">Leave requests</caption>
        <thead className="sr-only border-b border-gray-200 bg-gray-50 md:not-sr-only md:table-header-group">
          <tr className="md:table-row">
            {[
              "Worker",
              "Leave Type",
              "Start Date",
              "End Date",
              "Days",
              "Status",
              ...(showActions ? ["Actions"] : []),
            ].map((label) => (
              <th key={label} scope="col" className="px-4 py-3 font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-gray-200">
          {rows.map((row) => (
            <tr
              key={row.id}
              className="block rounded-lg border border-gray-200 bg-white py-1 shadow-sm md:table-row md:rounded-none md:border-0 md:py-0 md:shadow-none"
            >
              <th
                scope="row"
                data-label="Worker"
                className={`${cellClass} break-words text-left font-medium max-md:justify-start max-md:text-base max-md:font-semibold max-md:before:hidden md:max-w-64`}
              >
                <span className="text-left">
                  {row.workerName}
                  <span className="block text-xs font-normal text-gray-600">
                    {row.workerCode}
                    {!row.workerIsActive && " · Inactive"}
                  </span>
                </span>
              </th>
              <td
                data-label="Leave type"
                className={`${cellClass} md:whitespace-nowrap`}
              >
                {row.leaveType}
              </td>
              <td
                data-label="Start"
                className={`${cellClass} tabular-nums md:whitespace-nowrap`}
              >
                {row.startDate}
              </td>
              <td
                data-label="End"
                className={`${cellClass} tabular-nums md:whitespace-nowrap`}
              >
                {row.endDate}
              </td>
              <td data-label="Days" className={`${cellClass} tabular-nums`}>
                {row.days}
              </td>
              <td data-label="Status" className={cellClass}>
                <span
                  className={`rounded-full px-3 py-1 font-semibold ${statusClass[row.status]}`}
                >
                  {row.status}
                </span>
              </td>
              {showActions && (
                <td className="px-4 py-2 md:table-cell">
                  {/* Phone: decision buttons share a row with an icon-only Delete; a decided request offers only the opposite decision. */}
                  <div className="flex gap-2 md:flex-wrap">
                    {manage && row.status !== "Approved" && (
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
                    )}
                    {manage && row.status !== "Rejected" && (
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
                    )}
                    {canDelete(row) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete(row)}
                        className={`${actionClass} text-red-700 max-md:w-11 max-md:flex-none max-md:px-0`}
                        aria-label={`Delete leave for ${row.workerName} starting ${row.startDate}`}
                      >
                        <Trash2 aria-hidden="true" size={16} />
                        <span className="max-md:hidden">Delete</span>
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
