import { useEffect, useRef, useState } from "react";
import { CalendarPlus } from "lucide-react";
import {
  approveLeave,
  createLeave,
  deleteLeave,
  listLeave,
  rejectLeave,
  type LeaveInput,
  type LeaveRequest,
  type LeaveStatus,
} from "../../api/leave";
import { listWorkers, type Worker } from "../../api/workers";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  ActionFailure,
  LoadError,
  primaryButtonClass,
  SuccessRegion,
} from "../workers/WorkersFeedback";
import { LeaveFormDialog } from "./LeaveFormDialog";
import { LeaveTable } from "./LeaveTable";

function message(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "Something went wrong. Please try again.";
}
const selectClass =
  "mt-1 min-h-11 max-w-full rounded-lg border border-gray-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60";
export function LeavePage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [workersReady, setWorkersReady] = useState(false);
  const [workersError, setWorkersError] = useState<string | null>(null);
  const [workersAttempt, setWorkersAttempt] = useState(0);
  const [status, setStatus] = useState<LeaveStatus | "">("");
  const [workerId, setWorkerId] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string[]> | undefined
  >();
  const [confirmation, setConfirmation] = useState<LeaveRequest | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setWorkersReady(false);
    setWorkersError(null);
    listWorkers(true)
      .then((value) => {
        if (!cancelled) {
          setWorkers(value);
          setWorkersReady(true);
        }
      })
      .catch((reason) => {
        if (!cancelled) setWorkersError(message(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [workersAttempt]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    listLeave({
      ...(status ? { status } : {}),
      ...(workerId ? { workerId: Number(workerId) } : {}),
    })
      .then((value) => {
        if (!cancelled) {
          setRows(value);
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setLoadError(message(reason));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, workerId, attempt]);
  async function submit(input: LeaveInput) {
    if (pending) return;
    setPending(true);
    setFormError(null);
    setFieldErrors(undefined);
    try {
      await createLeave(input);
      if (mounted.current) {
        setFormOpen(false);
        setSuccess("Leave request created.");
        setAttempt((value) => value + 1);
      }
    } catch (reason) {
      if (mounted.current) {
        setFormError(message(reason));
        if (reason instanceof ApiError) setFieldErrors(reason.fieldErrors);
      }
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  async function act(kind: "approve" | "reject" | "delete", row: LeaveRequest) {
    if (pending) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await (kind === "approve"
        ? approveLeave(row.id)
        : kind === "reject"
          ? rejectLeave(row.id)
          : deleteLeave(row.id));
      if (mounted.current) {
        setSuccess(
          kind === "approve"
            ? "Leave approved."
            : kind === "reject"
              ? "Leave rejected."
              : "Leave request deleted.",
        );
        setAttempt((value) => value + 1);
      }
    } catch (reason) {
      if (mounted.current) {
        setError(message(reason));
        if (
          reason instanceof ApiError &&
          [403, 404, 409].includes(reason.status)
        )
          setAttempt((value) => value + 1);
      }
    } finally {
      if (mounted.current) {
        setPending(false);
        setConfirmation(null);
      }
    }
  }
  const busy = pending || formOpen || !!confirmation;
  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Leave Management</h2>
          <p className="text-sm text-gray-600">
            Manage leave requests and decisions. Days include both start and end
            dates.
          </p>
        </div>
        {user && (
          <button
            type="button"
            disabled={busy || !workersReady || !workers.some((w) => w.isActive)}
            onClick={() => {
              setFormError(null);
              setFieldErrors(undefined);
              setError(null);
              setSuccess(null);
              setFormOpen(true);
            }}
            className={`${primaryButtonClass} disabled:opacity-60`}
          >
            <CalendarPlus aria-hidden="true" size={16} />
            New Leave Request
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex max-w-full flex-col text-sm font-medium">
          Filter by status
          <select
            value={status}
            disabled={busy}
            onChange={(e) => setStatus(e.target.value as LeaveStatus | "")}
            className={selectClass}
          >
            <option value="">All statuses</option>
            {["Pending", "Approved", "Rejected"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex max-w-full flex-col text-sm font-medium">
          Filter by worker
          <select
            value={workerId}
            disabled={busy || !workersReady}
            onChange={(e) => setWorkerId(e.target.value)}
            className={selectClass}
          >
            <option value="">All workers</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.fullName} ({w.workerCode}){!w.isActive && " · Inactive"}
              </option>
            ))}
          </select>
        </label>
      </div>
      {workersError && (
        <LoadError
          message={`Worker options could not be loaded. ${workersError}`}
          onRetry={() => setWorkersAttempt((n) => n + 1)}
        />
      )}
      {user && workersReady && !workers.some((w) => w.isActive) && (
        <p className="text-sm text-gray-600">
          Add an active worker before requesting leave.
        </p>
      )}
      <SuccessRegion message={success} />
      {error && <ActionFailure message={error} />}
      {loading ? (
        <p role="status" className="py-8 text-gray-600">
          Loading leave requests...
        </p>
      ) : loadError ? (
        <LoadError
          message={loadError}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : rows.length ? (
        <LeaveTable
          rows={rows}
          role={user?.role}
          username={user?.username}
          busy={busy}
          onApprove={(row) => act("approve", row)}
          onReject={(row) => act("reject", row)}
          onDelete={(row) => {
            setError(null);
            setSuccess(null);
            setConfirmation(row);
          }}
        />
      ) : (
        <p className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-600">
          No leave requests match these filters.
        </p>
      )}
      {user && formOpen && (
        <LeaveFormDialog
          workers={workers}
          pending={pending}
          error={formError}
          fieldErrors={fieldErrors}
          onSubmit={submit}
          onClose={() => setFormOpen(false)}
        />
      )}
      <ConfirmDialog
        open={!!confirmation}
        title="Delete leave request"
        message={
          confirmation
            ? `Delete ${confirmation.leaveType} for ${confirmation.workerName} (${confirmation.startDate} to ${confirmation.endDate}) permanently? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        pending={pending}
        onConfirm={() => {
          if (confirmation) void act("delete", confirmation);
        }}
        onCancel={() => setConfirmation(null)}
      />
    </section>
  );
}
