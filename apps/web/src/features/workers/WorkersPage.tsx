import { useMemo, useState } from "react";
import { Search, Trash2, UserPlus, UserX } from "lucide-react";
import { ApiError } from "../../api/client";
import { activateWorker, deactivateWorker, deleteWorker, getWorkerProfilePdf, type Worker } from "../../api/workers";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { canViewAll, isManagement } from "../../permissions";
import { useAuth } from "../../contexts/AuthContext";
import { saveBlob } from "../payroll/downloadPdf";
import { useWorkerList } from "./useWorkerList";
import { WorkerFormDialog } from "./WorkerFormDialog";
import { ActionFailure, EmptyState, LoadError, LoadingNotice, primaryButtonClass, SuccessRegion } from "./WorkersFeedback";
import { onboardingProgress, WorkersTable } from "./WorkersTable";

type Confirmation = { kind: "deactivate" | "delete"; worker: Worker };

const CONFIRM_COPY = {
  deactivate: {
    title: "Deactivate worker",
    label: "Deactivate",
    icon: UserX,
    message: (w: Worker) =>
      `Deactivate ${w.fullName} (${w.workerCode})? They are hidden from the directory unless "Show inactive workers" is ticked, and their records are kept.`,
  },
  delete: {
    title: "Delete worker",
    label: "Delete",
    icon: Trash2,
    message: (w: Worker) =>
      `Delete ${w.fullName} (${w.workerCode}) permanently? This cannot be undone. A worker who already has records cannot be deleted and should be deactivated instead.`,
  },
} as const;

/** For example EMP-001_Employee1_Information.pdf; matches the name the API suggests. */
function profileFileName(worker: Worker): string {
  const clean = (text: string) => text.trim().replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${clean(worker.workerCode)}_${clean(worker.fullName) || "Worker"}_Information.pdf`;
}

function failureMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

export function WorkersPage() {
  const { user } = useAuth();
  const canManage = isManagement(user?.role);
  // HR adds and edits workers but cannot deactivate or delete them.
  const canEdit = canViewAll(user?.role);

  const [includeInactive, setIncludeInactive] = useState(false);
  const list = useWorkerList(includeInactive);

  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  function clearMessages() {
    setSuccess(null);
    setFailure(null);
  }

  function openForm(worker: Worker | null) {
    clearMessages();
    setEditing(worker);
    setFormOpen(true);
  }

  function ask(kind: Confirmation["kind"], worker: Worker) {
    clearMessages();
    setConfirmation({ kind, worker });
  }

  function handleSaved() {
    setFormOpen(false);
    setSuccess(editing ? "Worker updated." : "Worker added.");
    list.refresh();
  }

  async function runConfirmed() {
    if (!confirmation) {
      return;
    }
    const { kind, worker } = confirmation;
    clearMessages();
    setConfirmPending(true);
    try {
      await (kind === "delete" ? deleteWorker(worker.id) : deactivateWorker(worker.id));
      setSuccess(kind === "delete" ? "Worker deleted." : "Worker deactivated.");
      list.refresh();
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setConfirmPending(false);
      setConfirmation(null);
    }
  }

  async function activate(worker: Worker) {
    clearMessages();
    setBusyId(worker.id);
    try {
      await activateWorker(worker.id);
      setSuccess("Worker activated.");
      list.refresh();
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function printProfile(worker: Worker) {
    clearMessages();
    setBusyId(worker.id);
    try {
      saveBlob(await getWorkerProfilePdf(worker.id), profileFileName(worker));
      setSuccess(`Record for ${worker.fullName} downloaded.`);
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  const departments = useMemo(
    () => [...new Set(list.workers.map((w) => w.department).filter((d): d is string => !!d))].sort(),
    [list.workers],
  );
  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return list.workers.filter((w) => {
      if (department && w.department !== department) return false;
      if (!text) return true;
      return [w.fullName, w.workerCode, w.designation, w.emiratesId, w.phone, w.department]
        .some((value) => value?.toLowerCase().includes(text));
    });
  }, [list.workers, query, department]);
  const filtering = query.trim() !== "" || department !== "";
  const activeCount = list.workers.filter((w) => w.isActive).length;
  const onboardingOpen = list.workers.filter((w) => {
    const { done, total } = onboardingProgress(w);
    return w.isActive && done < total;
  }).length;

  const copy = CONFIRM_COPY[confirmation?.kind ?? "delete"];
  const showEmpty = list.status === "ready" && list.workers.length === 0;

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Worker Directory</h2>
          <p className="text-sm text-gray-500">
            {canEdit
              ? "Manage employee profiles, designations, and base pay rates."
              : "View worker profiles and designations."}
          </p>
        </div>
        {canEdit && !showEmpty && (
          <button type="button" onClick={() => openForm(null)} className={primaryButtonClass}>
            <UserPlus aria-hidden="true" size={16} />
            Add New Worker
          </button>
        )}
      </div>

      {list.status === "ready" && list.workers.length > 0 && (
        <>
          <dl className="mb-4 grid grid-cols-3 gap-3">
            {[
              ["Total workers", list.workers.length],
              ["Active", activeCount],
              ["Onboarding open", onboardingOpen],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
                <dt className="text-xs font-medium text-gray-600">{label}</dt>
                <dd className="text-xl font-bold text-gray-800">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 basis-64">
              <label htmlFor="worker-search" className="mb-1 block text-sm font-medium text-gray-800">
                Search workers
              </label>
              <div className="relative">
                <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  id="worker-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name, ID, Emirates ID, phone or role"
                  autoComplete="off"
                  className="block min-h-11 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-base text-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                />
              </div>
            </div>
            {departments.length > 0 && (
              <div className="max-sm:w-full">
                <label htmlFor="worker-department" className="mb-1 block text-sm font-medium text-gray-800">
                  Department
                </label>
                <select
                  id="worker-department"
                  value={department}
                  onChange={(event) => setDepartment(event.target.value)}
                  className="block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </>
      )}

      <label className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-gray-800">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(event) => setIncludeInactive(event.target.checked)}
          className="h-5 w-5 rounded border-gray-300 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        />
        Show inactive workers
      </label>

      <SuccessRegion message={success} />
      {failure && <ActionFailure message={failure} />}

      {list.status === "loading" && <LoadingNotice />}
      {list.status === "error" && <LoadError message={list.error} onRetry={list.retry} />}
      {showEmpty && <EmptyState onAdd={canEdit ? () => openForm(null) : undefined} />}
      {list.status === "ready" && list.workers.length > 0 && visible.length === 0 && (
        <p role="status" className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-600 shadow-sm">
          No workers match{filtering ? " your search or filter" : ""}.{" "}
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setDepartment("");
            }}
            className="font-medium text-blue-700 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Clear search
          </button>
        </p>
      )}
      {list.status === "ready" && visible.length > 0 && (
        <WorkersTable
          workers={visible}
          showRates={canViewAll(user?.role)}
          onPrint={canViewAll(user?.role) ? printProfile : undefined}
          busyId={busyId}
          actions={
            canEdit
              ? {
                  onEdit: openForm,
                  ...(canManage && {
                    onDeactivate: (worker: Worker) => ask("deactivate", worker),
                    onActivate: activate,
                    onDelete: (worker: Worker) => ask("delete", worker),
                  }),
                }
              : undefined
          }
        />
      )}

      {canEdit && (
        <>
          <WorkerFormDialog open={formOpen} worker={editing} onClose={() => setFormOpen(false)} onSaved={handleSaved} />
          <ConfirmDialog
            open={confirmation !== null}
            title={copy.title}
            message={confirmation ? copy.message(confirmation.worker) : ""}
            confirmLabel={copy.label}
            confirmIcon={copy.icon}
            pending={confirmPending}
            onConfirm={runConfirmed}
            onCancel={() => setConfirmation(null)}
          />
        </>
      )}
    </section>
  );
}
