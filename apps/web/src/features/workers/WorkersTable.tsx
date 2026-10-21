import { Pencil, Trash2, UserCheck, UserX, type LucideIcon } from "lucide-react";
import type { Worker } from "../../api/workers";
import { formatRate } from "../../utils/money";
import { WorkerStatusBadge } from "./WorkerStatusBadge";

interface RowActions {
  onEdit: (worker: Worker) => void;
  onDeactivate: (worker: Worker) => void;
  onActivate: (worker: Worker) => void;
  onDelete: (worker: Worker) => void;
}

interface WorkersTableProps {
  workers: Worker[];
  /** Wage columns; Supervisors never receive wages, so they are not shown. */
  showRates: boolean;
  /** Present only for roles that may change workers; Supervisors get a read-only table. */
  actions?: RowActions;
  /** Id of the worker whose activation is in flight, so its buttons are disabled. */
  busyId: number | null;
}

/** On phones each worker is a labelled card; from md up it is an ordinary table row. */
const cellClass =
  "flex items-center justify-between gap-3 px-4 py-2 before:content-[attr(data-label)] before:text-xs before:font-semibold before:uppercase before:text-gray-600 md:table-cell md:p-3 md:before:content-none xl:p-4";
/** On phones the name leads the card as its title with the worker ID beneath it; the other fields follow as label/value rows. */
const titleCellClass = "max-md:order-[-2] max-md:justify-start max-md:pb-0 max-md:pt-3 max-md:text-base max-md:before:hidden";
const subtitleCellClass = "max-md:order-[-1] max-md:justify-start max-md:py-0 max-md:pb-2 max-md:text-xs max-md:before:hidden";

const actionClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60";

function ActionButton({
  icon: Icon,
  label,
  worker,
  tone,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  worker: Worker;
  tone: string;
  disabled: boolean;
  onClick: (worker: Worker) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${label} ${worker.fullName}`}
      title={`${label} ${worker.fullName}`}
      disabled={disabled}
      onClick={() => onClick(worker)}
      className={`${actionClass} ${tone}`}
    >
      <Icon aria-hidden="true" size={16} />
      {/* Shown in the phone card layout; icon-only from md to xl; the aria-label above keeps the accessible name. */}
      <span className="md:hidden xl:inline">{label}</span>
    </button>
  );
}

function rateText(rate: number | null): string {
  return rate === null ? "—" : formatRate(rate);
}

function overtimeText(worker: Worker): string {
  if (worker.overtimeRate !== null) return formatRate(worker.overtimeRate);
  return worker.effectiveOvertimeRate === null
    ? "Company rate"
    : `Company rate (${formatRate(worker.effectiveOvertimeRate)})`;
}

function WorkerRow({
  worker,
  actions,
  busy,
  showRates,
}: {
  worker: Worker;
  actions?: RowActions;
  busy: boolean;
  showRates: boolean;
}) {
  return (
    <tr className="block rounded-lg border border-gray-200 bg-white py-1 shadow-sm hover:bg-slate-50 max-md:flex max-md:flex-col md:table-row md:rounded-none md:border-0 md:py-0 md:shadow-none">
      <td data-label="ID" className={`${cellClass} ${subtitleCellClass} font-mono font-medium text-gray-600 md:whitespace-nowrap`}>{worker.workerCode}</td>
      <td data-label="Name" className={`${cellClass} ${titleCellClass} font-semibold text-gray-800`}>{worker.fullName}</td>
      <td data-label="Designation" className={`${cellClass} text-gray-600`}>{worker.designation}</td>
      {showRates && (
        <>
          <td data-label="Base rate" className={`${cellClass} font-medium text-gray-800`}>{rateText(worker.hourlyRate)}</td>
          <td data-label="Overtime rate" className={`${cellClass} font-medium text-gray-800 xl:whitespace-nowrap`}>{overtimeText(worker)}</td>
        </>
      )}
      <td data-label="Status" className={cellClass}>
        <WorkerStatusBadge isActive={worker.isActive} />
      </td>
      {actions && (
        <td className="px-4 py-2 md:table-cell md:p-3 xl:p-4">
          {/* Phone: Edit and Deactivate share a row; the destructive Delete sits apart on its own full-width row. */}
          <div className="grid grid-cols-2 gap-2 md:flex md:flex-nowrap md:justify-end">
            <ActionButton
              icon={Pencil}
              label="Edit"
              worker={worker}
              disabled={busy}
              onClick={actions.onEdit}
              tone="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
            />
            {worker.isActive ? (
              <ActionButton
                icon={UserX}
                label="Deactivate"
                worker={worker}
                disabled={busy}
                onClick={actions.onDeactivate}
                tone="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              />
            ) : (
              <ActionButton
                icon={UserCheck}
                label="Activate"
                worker={worker}
                disabled={busy}
                onClick={actions.onActivate}
                tone="border-green-200 bg-green-50 text-green-800 hover:bg-green-100"
              />
            )}
            <ActionButton
              icon={Trash2}
              label="Delete"
              worker={worker}
              disabled={busy}
              onClick={actions.onDelete}
              tone="border-red-200 bg-red-50 text-red-700 hover:bg-red-100 max-md:col-span-2 max-md:bg-white max-md:hover:bg-red-50"
            />
          </div>
        </td>
      )}
    </tr>
  );
}

export function WorkersTable({ workers, showRates, actions, busyId }: WorkersTableProps) {
  return (
    <div className="rounded-lg md:overflow-hidden md:border md:border-gray-200 md:bg-white md:shadow-sm">
      {/* Below md rows are cards; from md the table scrolls inside this container so the page itself never scrolls sideways. */}
      <div className="md:overflow-x-auto">
        <table className="block w-full border-collapse text-left text-sm md:table">
          <thead className="sr-only md:not-sr-only md:table-header-group">
            <tr className="border-b bg-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-700">
              <th scope="col" className="p-3 xl:p-4">ID</th>
              <th scope="col" className="p-3 xl:p-4">Full Name</th>
              <th scope="col" className="p-3 xl:p-4">Designation</th>
              {showRates && (
                <>
                  <th scope="col" className="p-3 xl:whitespace-nowrap xl:p-4">Base Rate (AED/hr)</th>
                  <th scope="col" className="p-3 xl:whitespace-nowrap xl:p-4">Overtime Rate (AED/hr)</th>
                </>
              )}
              <th scope="col" className="p-3 xl:p-4">Status</th>
              {actions && (
                <th scope="col" className="p-3 text-right xl:p-4">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-gray-100">
            {workers.map((worker) => (
              <WorkerRow key={worker.id} worker={worker} actions={actions} busy={busyId === worker.id} showRates={showRates} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
