import {
  Pencil,
  Printer,
  Trash2,
  UserCheck,
  UserX,
  type LucideIcon,
} from "lucide-react";
import type { Worker } from "../../api/workers";
import { formatRate } from "../../utils/money";
import { WorkerStatusBadge } from "./WorkerStatusBadge";

interface RowActions {
  onEdit: (worker: Worker) => void;
  /** Deactivate, activate and delete are for Managers and Administrators only; HR can edit but not remove. */
  onDeactivate?: (worker: Worker) => void;
  onActivate?: (worker: Worker) => void;
  onDelete?: (worker: Worker) => void;
}

interface WorkersTableProps {
  workers: Worker[];
  /** Wage columns; Supervisors never receive wages, so they are not shown. */
  showRates: boolean;
  /** Present only for roles that may change workers; Supervisors get a read-only table. */
  actions?: RowActions;
  /** Downloads the worker's record as a PDF; offered to HR as well as to people who can edit. */
  onPrint?: (worker: Worker) => void;
  /** Id of the worker whose activation is in flight, so its buttons are disabled. */
  busyId: number | null;
}

/** On phones each worker is a labelled card; from md up it is an ordinary table row. */
const cellClass =
  "flex items-center justify-between gap-3 px-4 py-2 before:content-[attr(data-label)] before:text-xs before:font-semibold before:uppercase before:text-ink-600 md:table-cell md:p-3 md:before:content-none xl:p-4";
/** On phones the name leads the card as its title with the worker ID beneath it; the other fields follow as label/value rows. */
const titleCellClass =
  "max-md:order-[-2] max-md:justify-start max-md:pb-0 max-md:pt-3 max-md:text-base max-md:before:hidden";
const subtitleCellClass =
  "max-md:order-[-1] max-md:justify-start max-md:py-0 max-md:pb-2 max-md:text-xs max-md:before:hidden";

const actionClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 md:min-h-9 md:min-w-9";

function ActionButton({
  icon: Icon,
  label,
  worker,
  tone,
  disabled,
  iconOnlyOnPhone = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  worker: Worker;
  tone: string;
  disabled: boolean;
  iconOnlyOnPhone?: boolean;
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
      {/* Shown in the phone card layout; icon-only from md up; the aria-label above keeps the accessible name. */}
      <span className={iconOnlyOnPhone ? "hidden" : "md:hidden"}>{label}</span>
    </button>
  );
}

function overtimeText(worker: Worker): string {
  if (worker.overtimeRate !== null) return formatRate(worker.overtimeRate);
  return worker.effectiveOvertimeRate === null
    ? "Company rate"
    : `Company rate (${formatRate(worker.effectiveOvertimeRate)})`;
}

const NOT_RECORDED = "—";
/** Empty values are hidden on phones so a card only shows what is recorded. */
const emptyOnPhone = (empty: boolean) => (empty ? " max-md:hidden" : "");

export function onboardingProgress(worker: Worker): {
  done: number;
  total: number;
} {
  const items = [
    worker.contractSigned,
    worker.visaMedicalCleared,
    worker.safetyGearIssued,
    worker.siteOrientationDone,
    worker.wpsRegistered,
    worker.badgeIssued,
  ];
  return { done: items.filter(Boolean).length, total: items.length };
}

function OnboardingCell({ worker }: { worker: Worker }) {
  const { done, total } = onboardingProgress(worker);
  const complete = done === total;
  return (
    <div
      className="flex items-center gap-2"
      title={`Onboarding checklist: ${done} of ${total} complete`}
    >
      <div
        aria-hidden="true"
        className="h-1.5 w-14 overflow-hidden rounded-full bg-ink-200"
      >
        <div
          className={`h-full ${complete ? "bg-success" : "bg-brand-600"}`}
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>
      <span
        className={`text-xs font-medium ${complete ? "text-green-800" : "text-ink-700"}`}
      >
        {done}/{total}
        <span className="sr-only"> onboarding tasks complete</span>
      </span>
    </div>
  );
}

function WorkerRow({
  worker,
  actions,
  onPrint,
  busy,
  showRates,
}: {
  worker: Worker;
  actions?: RowActions;
  onPrint?: (worker: Worker) => void;
  busy: boolean;
  showRates: boolean;
}) {
  // Phone layout: wide buttons share the row; the icon-only ones (Print beside other actions, Delete) stay narrow.
  const grid = actions?.onDelete
    ? "grid-cols-[1fr_1fr_auto_auto]"
    : actions
      ? "grid-cols-[1fr_auto]"
      : "grid-cols-1";
  const place = [worker.department, worker.workLocation]
    .filter(Boolean)
    .join(" · ");
  return (
    <tr className="block rounded-card border border-line bg-white py-1 shadow-card hover:bg-ink-50/70 max-md:flex max-md:flex-col md:table-row md:rounded-none md:border-0 md:py-0 md:shadow-none">
      <td
        data-label="ID"
        className={`${cellClass} ${subtitleCellClass} font-mono font-medium text-ink-600 md:whitespace-nowrap`}
      >
        {worker.workerCode}
      </td>
      <td
        data-label="Name"
        className={`${cellClass} ${titleCellClass} text-ink-800`}
      >
        <div>
          <div className="font-semibold">{worker.fullName}</div>
          {worker.emiratesId && (
            <div className="font-mono text-xs font-normal text-ink-600">
              EID {worker.emiratesId}
            </div>
          )}
        </div>
      </td>
      <td
        data-label="Role"
        className={`${cellClass} text-ink-600 max-md:text-right`}
      >
        <div>
          <div className="font-medium text-ink-800">{worker.designation}</div>
          {place && <div className="text-xs">{place}</div>}
        </div>
      </td>
      <td
        data-label="Contact"
        className={`${cellClass} text-ink-600${emptyOnPhone(!worker.phone && !worker.email)}`}
      >
        {worker.phone || worker.email ? (
          <div className="max-md:text-right">
            {worker.phone && (
              <a
                href={`tel:${worker.phone.replace(/[^+\d]/g, "")}`}
                className="font-medium text-brand-700 hover:underline"
              >
                {worker.phone}
              </a>
            )}
            {worker.email && (
              <div
                className="max-w-[13rem] truncate text-xs"
                title={worker.email}
              >
                {worker.email}
              </div>
            )}
          </div>
        ) : (
          NOT_RECORDED
        )}
      </td>
      {showRates && (
        <td
          data-label="Pay (AED)"
          className={`${cellClass} text-ink-800`}
        >
          <div className="max-md:text-right">
            <div>
              Salary{" "}
              <span className="font-medium">
                {formatRate(worker.monthlySalary ?? 0)}
              </span>
              <span className="text-xs text-ink-600">
                {" "}({formatRate(worker.hourlyRate ?? 0)}/hr)
              </span>
            </div>
            <div className="text-xs text-ink-600">
              OT <span>{overtimeText(worker)}</span>
            </div>
          </div>
        </td>
      )}
      <td data-label="Onboarding" className={cellClass}>
        <OnboardingCell worker={worker} />
      </td>
      <td data-label="Status" className={cellClass}>
        <WorkerStatusBadge isActive={worker.isActive} />
      </td>
      {(actions || onPrint) && (
        <td className="px-4 py-2 md:table-cell md:px-4 py-3">
          {/* Phone: Edit and Deactivate share a row with an icon-only Delete at the end, keeping the card short. */}
          <div
            className={`grid gap-2 md:flex md:flex-nowrap md:justify-end ${grid}`}
          >
            {actions && (
              <ActionButton
                icon={Pencil}
                label="Edit"
                worker={worker}
                disabled={busy}
                onClick={actions.onEdit}
                tone="border-ink-300 bg-white text-ink-800 hover:bg-ink-50"
              />
            )}
            {worker.isActive && actions?.onDeactivate && (
              <ActionButton
                icon={UserX}
                label="Deactivate"
                worker={worker}
                disabled={busy}
                onClick={actions.onDeactivate}
                tone="border-ink-300 bg-white text-amber-800 hover:bg-amber-50"
              />
            )}
            {!worker.isActive && actions?.onActivate && (
              <ActionButton
                icon={UserCheck}
                label="Activate"
                worker={worker}
                disabled={busy}
                onClick={actions.onActivate}
                tone="border-ink-300 bg-white text-green-800 hover:bg-green-50"
              />
            )}
            {onPrint && (
              <ActionButton
                icon={Printer}
                label="Print"
                worker={worker}
                disabled={busy}
                iconOnlyOnPhone={!!actions}
                onClick={onPrint}
                tone="border-ink-300 bg-white text-ink-800 hover:bg-ink-50"
              />
            )}
            {actions?.onDelete && (
              <ActionButton
                icon={Trash2}
                label="Delete"
                worker={worker}
                disabled={busy}
                iconOnlyOnPhone
                onClick={actions.onDelete}
                tone="border-ink-300 bg-white text-danger hover:bg-red-50"
              />
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

export function WorkersTable({
  workers,
  showRates,
  actions,
  onPrint,
  busyId,
}: WorkersTableProps) {
  return (
    <div className="md:overflow-hidden md:rounded-card md:border md:border-line md:bg-white md:shadow-card">
      {/* Below md rows are cards; from md the table scrolls inside this container so the page itself never scrolls sideways. */}
      <div className="md:overflow-x-auto">
        <table className="block w-full border-collapse text-left text-sm md:table">
          <thead className="sr-only md:not-sr-only md:table-header-group">
            <tr className="border-b border-line bg-ink-50 text-xs font-semibold uppercase tracking-wide text-ink-600">
              <th scope="col" className="px-4 py-3">
                ID
              </th>
              <th scope="col" className="px-4 py-3">
                Worker
              </th>
              <th scope="col" className="px-4 py-3">
                Role
              </th>
              <th scope="col" className="px-4 py-3">
                Contact
              </th>
              {showRates && (
                <th scope="col" className="p-3 xl:whitespace-nowrap xl:p-4">
                  Pay (AED)
                </th>
              )}
              <th scope="col" className="px-4 py-3">
                Onboarding
              </th>
              <th scope="col" className="px-4 py-3">
                Status
              </th>
              {(actions || onPrint) && (
                <th scope="col" className="p-3 text-right xl:p-4">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-line">
            {workers.map((worker) => (
              <WorkerRow
                key={worker.id}
                worker={worker}
                actions={actions}
                onPrint={onPrint}
                busy={busyId === worker.id}
                showRates={showRates}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
