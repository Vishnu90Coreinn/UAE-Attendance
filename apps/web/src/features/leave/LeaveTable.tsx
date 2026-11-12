import { Check, Paperclip, Trash2, X } from "lucide-react";
import { Pager, RowMenu, SortTh, StatusBadge, usePaging, useSort, type RowMenuItem } from "../../ui";
import type { Role } from "../../api/auth";
import type { LeaveRequest } from "../../api/leave";
import { formatDisplayDate } from "../../utils/date";
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
  onViewPhoto: (row: LeaveRequest) => void;
}
const actionClass =
  "inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-ink-300 px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60 max-md:flex-1";
const statusTone = { Pending: "warning", Approved: "success", Rejected: "danger" } as const;
/** On phones each row becomes a labelled card; from md up it is an ordinary table row. */
const cellClass =
  "flex items-center justify-between gap-3 px-4 py-2 before:content-[attr(data-label)] before:text-xs before:font-semibold before:uppercase before:text-ink-600 md:table-cell md:py-3 md:before:content-none";

export function LeaveTable({
  rows,
  role,
  username,
  busy,
  onApprove,
  onReject,
  onDelete,
  onViewPhoto,
}: Props) {
  const manage = isManagement(role);
  const canDelete = (row: LeaveRequest) =>
    manage ||
    (role === "Supervisor" &&
      row.status === "Pending" &&
      !!username &&
      row.createdBy === username);
  const showActions = manage || rows.some(canDelete);
  const menuFor = (row: LeaveRequest): RowMenuItem[] => [
    ...(manage && row.status === "Approved"
      ? [{ label: "Reject", icon: X, disabled: busy, onSelect: () => onReject(row) }]
      : []),
    ...(canDelete(row) ? [{ label: "Delete", icon: Trash2, danger: true, disabled: busy, onSelect: () => onDelete(row) }] : []),
  ];
  const { sorted, sort, toggle } = useSort(rows, {
    worker: (r) => r.workerName,
    type: (r) => r.leaveType,
    start: (r) => r.startDate,
    end: (r) => r.endDate,
    days: (r) => r.days,
    status: (r) => r.status,
  });
  const paging = usePaging(sorted);
  const sortable: Record<string, string> = { Worker: "worker", "Leave Type": "type", "Start Date": "start", "End Date": "end", Days: "days", Status: "status" };
  return (
    <div className="max-w-full rounded-lg border-line md:overflow-x-auto md:border md:bg-white md:shadow-sm">
      <table className="block w-full text-left text-sm md:table">
        <caption className="sr-only">Leave requests</caption>
        <thead className="sr-only border-b border-line bg-ink-50/80 text-[0.6875rem] uppercase tracking-wider text-ink-500 md:not-sr-only md:table-header-group">
          <tr className="md:table-row">
            {[
              "Worker",
              "Leave Type",
              "Start Date",
              "End Date",
              "Days",
              "Status",
              "Photo",
              ...(showActions ? ["Actions"] : []),
            ].map((label) =>
              sortable[label] ? (
                <SortTh key={label} label={label} sortKey={sortable[label]} sort={sort} onToggle={toggle} className="px-4 py-3 font-semibold" />
              ) : (
                <th key={label} scope="col" className="px-4 py-3 font-semibold">
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-line">
          {paging.pageRows.map((row) => (
            <tr
              key={row.id}
              className="block rounded-card border border-line bg-white py-1 shadow-card md:table-row md:rounded-none md:border-0 md:py-0 md:shadow-none"
            >
              <th
                scope="row"
                data-label="Worker"
                className={`${cellClass} break-words text-left font-medium max-md:justify-start max-md:text-base max-md:font-semibold max-md:before:hidden md:max-w-64`}
              >
                <span className="text-left">
                  {row.workerName}
                  <span className="block text-xs font-normal text-ink-600">
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
                {formatDisplayDate(row.startDate)}
              </td>
              <td
                data-label="End"
                className={`${cellClass} tabular-nums md:whitespace-nowrap`}
              >
                {formatDisplayDate(row.endDate)}
              </td>
              <td data-label="Days" className={`${cellClass} tabular-nums`}>
                {row.days}
              </td>
              <td data-label="Status" className={cellClass}>
                <StatusBadge tone={statusTone[row.status]} variant="soft">{row.status}</StatusBadge>
              </td>
              <td data-label="Photo" className={cellClass}>
                {row.hasAttachment ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onViewPhoto(row)}
                    className={`${actionClass} max-md:flex-none`}
                    aria-label={`View photo for ${row.workerName} starting ${row.startDate}`}
                  >
                    <Paperclip aria-hidden="true" size={16} />
                    View
                  </button>
                ) : (
                  <span className="text-ink-500">None</span>
                )}
              </td>
              {showActions && (
                <td className="px-4 py-2 md:table-cell">
                  {/* A request waiting for a decision shows its decision buttons; a decided one keeps everything behind "...". */}
                  <div className="flex items-center gap-2 md:flex-wrap md:justify-end">
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
                    {manage && row.status === "Pending" && (
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
                    {menuFor(row).length > 0 && (
                      <RowMenu
                        label={`More actions for ${row.workerName} starting ${row.startDate}`}
                        items={menuFor(row)}
                        className="max-md:ml-auto"
                      />
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <Pager {...paging} onPage={paging.setPage} className="border-t border-line px-4 pb-3" />
    </div>
  );
}
