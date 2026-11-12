import type { AttendanceRow } from "../../api/attendance";
import { isLeaveStatus } from "../../utils/leaveStatuses";
import { StatusSegments } from "./StatusSegments";
import { ApprovalCell } from "./ApprovalCell";
import { previewPay, type AttendanceForm } from "./attendanceForm";

const inputClass =
  "min-h-11 w-28 rounded-lg border border-ink-300 bg-white px-3 text-base text-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:bg-ink-100 disabled:text-ink-600";
/** On phones each worker is a labelled card; from md up it is an ordinary table row. */
const cellClass =
  "flex items-center justify-between gap-3 px-4 py-2 before:content-[attr(data-label)] before:text-xs before:font-semibold before:uppercase before:text-ink-600 md:table-cell md:py-3 md:before:content-none";

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
    <div className="relative min-w-0 rounded-lg md:overflow-x-auto md:border md:border-line md:bg-white md:shadow-sm">
      <table className="block w-full text-left text-sm md:table">
        <caption className="sr-only">
          {showPay ? "Daily attendance and pay in AED" : "Daily attendance"}
        </caption>
        <thead className="sr-only border-b border-line bg-ink-50 text-xs uppercase tracking-wide text-ink-600 md:not-sr-only md:table-header-group">
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
        <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-line">
          {rows.map((row, index) => {
            const form = forms[index];
            // Supervisors cannot change an entry once a manager has approved it.
            const rowEditable =
              editable && !row.approvedLeave && (isManager || row.record?.approvalStatus !== "Approved");
            const pay = showPay
              ? previewPay(row, form, maximum, companyRate)
              : null;
            return (
              <tr
                key={row.worker.id}
                className="block rounded-card border border-line bg-white py-1 shadow-card md:table-row md:rounded-none md:border-0 md:py-0 md:shadow-none"
              >
                <th
                  scope="row"
                  className="block px-4 py-3 text-left font-medium text-ink-800 md:table-cell md:min-w-48"
                >
                  {row.worker.fullName}
                  <span className="block text-xs font-normal text-ink-600">
                    {row.worker.workerCode} · {row.worker.designation}
                    {!row.worker.isActive && " · Inactive"}
                  </span>
                </th>
                <td data-label="Status" className={cellClass}>
                  {rowEditable ? (
                    <StatusSegments
                      workerName={row.worker.fullName}
                      value={form.status}
                      disabled={pending}
                      onChange={(status) =>
                        onChange(form.workerId, {
                          status,
                          basicHours: status === "Present" || isLeaveStatus(status) ? String(maximum) : "0",
                          overtimeHours: "0",
                        })
                      }
                    />
                  ) : (
                    <>
                      <span className="whitespace-nowrap rounded-full bg-ink-100 px-3 py-1 text-ink-800">
                        {form.status ?? "Not recorded"}
                      </span>
                      {row.approvedLeave && (
                        <span className="mt-1 block text-xs text-ink-600">Approved leave. Change it in Leave Management.</span>
                      )}
                    </>
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
                          title={form.status !== "Present" ? "Mark the worker present to enter overtime" : undefined}
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
                    className={`${cellClass} whitespace-nowrap font-semibold tabular-nums text-ink-800 md:text-right`}
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
