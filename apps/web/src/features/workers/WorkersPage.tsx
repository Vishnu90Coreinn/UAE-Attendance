import { useEffect, useMemo, useState } from "react";
import { clearNewParam, hasNewParam } from "../../utils/startParam";
import { ClipboardList, Search, Trash2, UserCheck, UserPlus, UsersRound, UserX } from "lucide-react";
import { ApiError } from "../../api/client";
import { activateWorker, deactivateWorker, deleteWorker, getWorkerProfilePdf, type Worker } from "../../api/workers";
import { Button, Card, PageHeader, StatCard, cx, inputClass } from "../../ui";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { canViewAll, isManagement, isReadOnly } from "../../permissions";
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
  const canEdit = canViewAll(user?.role) && !isReadOnly(user?.role);
  // A new worker needs a salary and rates, which HR may not set, so only management adds workers.
  const canAdd = canManage;

  const [includeInactive, setIncludeInactive] = useState(false);
  const list = useWorkerList(includeInactive);

  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [formOpen, setFormOpen] = useState(() => canAdd && hasNewParam());
  useEffect(clearNewParam, []);
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
  const inactiveToggle = (
  <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-ink-700">
    <input
      type="checkbox"
      checked={includeInactive}
      onChange={(event) => setIncludeInactive(event.target.checked)}
      className="h-5 w-5 rounded border-ink-300 accent-brand-600 focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
    />
    Show inactive workers
  </label>
  );
  const showEmpty = list.status === "ready" && list.workers.length === 0;

  return (
    <section>
      <PageHeader
        title="Worker Directory"
        description={
          canEdit
            ? "Manage employee profiles, designations, and base pay rates."
            : "View worker profiles and designations."
        }
        actions={
          canAdd &&
          !showEmpty && (
            <Button icon={UserPlus} onClick={() => openForm(null)}>
              Add New Worker
            </Button>
          )
        }
      />

      {list.status === "ready" && list.workers.length > 0 && (
        <>
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
            <StatCard compact label="Total workers" value={list.workers.length} icon={UsersRound} />
            <StatCard compact label="Active" value={activeCount} icon={UserCheck} />
            <StatCard compact label="Onboarding open" value={onboardingOpen} icon={ClipboardList} />
          </div>

        </>
      )}

      {list.status === "ready" && list.workers.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-line bg-white p-3 shadow-card">
          <div className="min-w-0 flex-1 basis-64">
            <label htmlFor="worker-search" className="sr-only">
              Search workers
            </label>
            <div className="relative">
              <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
              <input
                id="worker-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, ID, Emirates ID, phone or role"
                autoComplete="off"
                className={cx(inputClass, "w-full !border-transparent !bg-ink-100 pl-9")}
              />
            </div>
          </div>
          {departments.length > 0 && (
            <div className="max-sm:w-full sm:min-w-52">
              <label htmlFor="worker-department" className="sr-only">
                Department
              </label>
              <select
                id="worker-department"
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                className={cx(inputClass, "w-full")}
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
          {inactiveToggle}
        </div>
      )}

      {!(list.status === "ready" && list.workers.length > 0) && <div className="mb-4">{inactiveToggle}</div>}

      <SuccessRegion message={success} />
      {failure && <ActionFailure message={failure} />}

      {list.status === "loading" && <LoadingNotice />}
      {list.status === "error" && <LoadError message={list.error} onRetry={list.retry} />}
      {showEmpty && <EmptyState onAdd={canAdd ? () => openForm(null) : undefined} />}
      {list.status === "ready" && list.workers.length > 0 && visible.length === 0 && (
        <p role="status" className="rounded-card border border-line bg-white px-4 py-8 text-center text-sm text-ink-600 shadow-card">
          No workers match{filtering ? " your search or filter" : ""}.{" "}
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setDepartment("");
            }}
            className="font-medium text-brand-700 underline focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/30"
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
          <WorkerFormDialog open={formOpen} worker={editing} hidePay={!canManage} onClose={() => setFormOpen(false)} onSaved={handleSaved} />
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
