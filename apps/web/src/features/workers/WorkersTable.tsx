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
  /** Present only for roles that may change workers; Viewers get a read-only table. */
  actions?: RowActions;
  /** Id of the worker whose activation is in flight, so its buttons are disabled. */
  busyId: number | null;
}

const actionClass =
  "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60";

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
      disabled={disabled}
      onClick={() => onClick(worker)}
      className={`${actionClass} ${tone}`}
    >
      <Icon aria-hidden="true" size={16} />
      {label}
    </button>
  );
}

function WorkerRow({ worker, actions, busy }: { worker: Worker; actions?: RowActions; busy: boolean }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="p-4 font-mono font-medium text-gray-600">{worker.workerCode}</td>
      <td className="p-4 font-semibold text-gray-800">{worker.fullName}</td>
      <td className="p-4 text-gray-600">{worker.designation}</td>
      <td className="p-4 font-medium text-gray-800">{formatRate(worker.hourlyRate)}</td>
      <td className="p-4">
        <WorkerStatusBadge isActive={worker.isActive} />
      </td>
      {actions && (
        <td className="p-4">
          <div className="flex flex-wrap justify-end gap-2">
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
              tone="border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            />
          </div>
        </td>
      )}
    </tr>
  );
}

export function WorkersTable({ workers, actions, busyId }: WorkersTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* The table scrolls inside this container so the page itself never scrolls sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b bg-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-700">
              <th scope="col" className="p-4">ID</th>
              <th scope="col" className="p-4">Full Name</th>
              <th scope="col" className="p-4">Designation</th>
              <th scope="col" className="whitespace-nowrap p-4">Base Rate (AED/hr)</th>
              <th scope="col" className="p-4">Status</th>
              {actions && (
                <th scope="col" className="p-4 text-right">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {workers.map((worker) => (
              <WorkerRow key={worker.id} worker={worker} actions={actions} busy={busyId === worker.id} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
