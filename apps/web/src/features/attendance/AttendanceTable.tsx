import type { AttendanceRow } from "../../api/attendance";
import { LEAVE_STATUSES } from "../../utils/leaveStatuses";
import { ApprovalCell } from "./ApprovalCell";
import { previewPay, type AttendanceForm } from "./attendanceForm";

const inputClass =
  "min-h-11 w-28 rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:bg-gray-100 disabled:text-gray-600";
/** On phones each worker is a labelled card; from md up it is an ordinary table row. */
const cellClass =
  "flex items-center justify-between gap-3 px-4 py-2 before:content-[attr(data-label)] before:text-xs before:font-semibold before:uppercase before:text-gray-600 md:table-cell md:py-3 md:before:content-none";

export function AttendanceTable({
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
  /** Pay column and preview; Supervisors never receive pay figures. */
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
  const headings = [
    "Worker",
    "Status",
    "Basic Hours",
    "Overtime Hours",
    "Approval",
    ...(showPay ? ["Total Pay (AED)"] : []),
  ];
  return (
    <div className="relative min-w-0 rounded-lg md:overflow-x-auto md:border md:border-gray-200 md:bg-white md:shadow-sm">
      <table className="block w-full text-left text-sm md:table">
        <caption className="sr-only">
          {showPay ? "Daily attendance and pay in AED" : "Daily attendance"}
        </caption>
        <thead className="sr-only border-b border-gray-200 bg-gray-50 text-gray-700 md:not-sr-only md:table-header-group">
          <tr className="md:table-row">
            {headings.map((label) => (
              <th
                key={label}
                scope="col"
                className="whitespace-nowrap px-4 py-3 font-semibold"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-gray-200">
          {rows.map((row, index) => {
            const form = forms[index];
            // Supervisors cannot change an entry once a manager has approved it.
            const rowEditable =
              editable && (isManager || row.record?.approvalStatus !== "Approved");
            const pay = showPay
              ? previewPay(row, form, maximum, companyRate)
              : null;
            return (
              <tr
                key={row.worker.id}
                className="block rounded-lg border border-gray-200 bg-white py-1 shadow-sm md:table-row md:rounded-none md:border-0 md:py-0 md:shadow-none"
              >
                <th
                  scope="row"
                  className="block px-4 py-3 text-left font-medium text-gray-800 md:table-cell md:min-w-48"
                >
                  {row.worker.fullName}
                  <span className="block text-xs font-normal text-gray-600">
                    {row.worker.workerCode} · {row.worker.designation}
                    {!row.worker.isActive && " · Inactive"}
                  </span>
                </th>
                <td data-label="Status" className={cellClass}>
                  {rowEditable ? (
                    <>
                      <label
                        className="sr-only"
                        htmlFor={`status-${form.workerId}`}
                      >
                        Status for {row.worker.fullName}
                      </label>
                      <select
                        id={`status-${form.workerId}`}
                        className={`${inputClass} w-40`}
                        value={form.status ?? ""}
                        disabled={pending}
                        onChange={(e) =>
                          onChange(form.workerId, {
                            status: (e.target.value ||
                              null) as AttendanceForm["status"],
                            basicHours: e.target.value === "Present" || LEAVE_STATUSES.some((leave) => leave === e.target.value) ? String(maximum) : "0",
                            overtimeHours: "0",
                          })
                        }
                      >
                        <option value="">Not recorded</option>
                        <option>Present</option>
                        <option>Absent</option>
                        {LEAVE_STATUSES.map((leave) => (
                          <option key={leave}>{leave}</option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <span className="whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-gray-800">
                      {form.status ?? "Not recorded"}
                    </span>
                  )}
                </td>
                {(["basicHours", "overtimeHours"] as const).map((field) => (
                  <td
                    key={field}
                    data-label={
                      field === "basicHours" ? "Basic hours" : "Overtime hours"
                    }
                    className={cellClass}
                  >
                    {rowEditable && field === "overtimeHours" ? (
                      <>
                        <label
                          className="sr-only"
                          htmlFor={`${field}-${form.workerId}`}
                        >
                          Overtime hours for {row.worker.fullName}
                        </label>
                        <input
                          id={`${field}-${form.workerId}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max={24}
                          step="0.01"
                          className={inputClass}
                          value={form[field]}
                          disabled={pending || form.status !== "Present"}
                          onChange={(e) =>
                            onChange(form.workerId, { [field]: e.target.value })
                          }
                        />
                      </>
                    ) : (
                      Number(form[field]).toFixed(2)
                    )}
                  </td>
                ))}
                <ApprovalCell
                  row={row}
                  isManager={isManager}
                  canAct={canDecide}
                  pending={pending}
                  className={cellClass}
                  onApprove={onApprove}
                  onReject={onReject}
                  onResubmit={onResubmit}
                />
                {showPay && (
                  <td
                    data-label="Total pay (AED)"
                    className={`${cellClass} whitespace-nowrap font-semibold tabular-nums text-gray-800 md:text-right`}
                  >
                    {pay === null ? "—" : pay.toFixed(2)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
