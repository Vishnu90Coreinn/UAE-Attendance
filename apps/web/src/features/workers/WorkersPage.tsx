import { useState } from "react";
import { Trash2, UserPlus, UserX } from "lucide-react";
import { ApiError } from "../../api/client";
import { activateWorker, deactivateWorker, deleteWorker, type Worker } from "../../api/workers";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { canViewAll, isManagement } from "../../permissions";
import { useAuth } from "../../contexts/AuthContext";
import { useWorkerList } from "./useWorkerList";
import { WorkerFormDialog } from "./WorkerFormDialog";
import { ActionFailure, EmptyState, LoadError, LoadingNotice, primaryButtonClass, SuccessRegion } from "./WorkersFeedback";
import { WorkersTable } from "./WorkersTable";

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

function failureMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

export function WorkersPage() {
  const { user } = useAuth();
  const canManage = isManagement(user?.role);

  const [includeInactive, setIncludeInactive] = useState(false);
  const list = useWorkerList(includeInactive);

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

  const copy = CONFIRM_COPY[confirmation?.kind ?? "delete"];
  const showEmpty = list.status === "ready" && list.workers.length === 0;

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Worker Directory</h2>
          <p className="text-sm text-gray-500">
            {canManage
              ? "Manage employee profiles, designations, and base pay rates."
              : "View worker profiles and designations."}
          </p>
        </div>
        {canManage && !showEmpty && (
          <button type="button" onClick={() => openForm(null)} className={primaryButtonClass}>
            <UserPlus aria-hidden="true" size={16} />
            Add New Worker
          </button>
        )}
      </div>

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
      {showEmpty && <EmptyState onAdd={canManage ? () => openForm(null) : undefined} />}
      {list.status === "ready" && list.workers.length > 0 && (
        <WorkersTable
          workers={list.workers}
          showRates={canViewAll(user?.role)}
          busyId={busyId}
          actions={
            canManage
              ? {
                  onEdit: openForm,
                  onDeactivate: (worker) => ask("deactivate", worker),
                  onActivate: activate,
                  onDelete: (worker) => ask("delete", worker),
                }
              : undefined
          }
        />
      )}

      {canManage && (
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
