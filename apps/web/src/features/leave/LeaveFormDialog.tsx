import { useId, useRef, useState, type FormEvent } from "react";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { LEAVE_TYPES, type LeaveInput, type LeaveType } from "../../api/leave";
import type { Worker } from "../../api/workers";
import { ActionFailure, primaryButtonClass } from "../workers/WorkersFeedback";

interface Props {
  workers: Worker[];
  pending: boolean;
  error: string | null;
  fieldErrors: Record<string, string[]> | undefined;
  onSubmit: (input: LeaveInput) => void;
  onClose: () => void;
}
function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
const fieldClass =
  "mt-1 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
export function LeaveFormDialog({
  workers,
  pending,
  error,
  fieldErrors,
  onSubmit,
  onClose,
}: Props) {
  const [workerId, setWorkerId] = useState("");
  const [leaveType, setLeaveType] = useState<LeaveType>("Annual Leave");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const workerRef = useRef<HTMLSelectElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const workerKey = useId();
  const typeKey = useId();
  const message = (key: string) => errors[key] ?? fieldErrors?.[key]?.join(" ");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const invalid: Record<string, string> = {};
    if (!workerId) invalid.workerId = "Choose a worker.";
    if (!startDate) invalid.startDate = "Choose a start date.";
    if (!endDate) invalid.endDate = "Choose an end date.";
    else if (startDate && endDate < startDate)
      invalid.endDate = "End date must be on or after start date.";
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      (invalid.workerId
        ? workerRef
        : invalid.startDate
          ? startRef
          : endRef
      ).current?.focus();
      return;
    }
    onSubmit({ workerId: Number(workerId), leaveType, startDate, endDate });
  }
  return (
    <Dialog
      open
      title="New Leave Request"
      initialFocusRef={workerRef}
      onClose={pending ? () => {} : onClose}
    >
      <form noValidate onSubmit={submit} className="mt-4 space-y-4">
        <p className="text-sm text-gray-600">
          Days are inclusive calendar days. Leave does not change attendance or
          payroll.
        </p>
        <div>
          <label htmlFor={workerKey} className="text-sm font-medium">
            Worker
          </label>
          <select
            id={workerKey}
            ref={workerRef}
            value={workerId}
            disabled={pending}
            onChange={(e) => setWorkerId(e.target.value)}
            className={fieldClass}
            aria-invalid={!!message("workerId")}
            aria-describedby={
              message("workerId") ? `${workerKey}-error` : undefined
            }
          >
            <option value="">Choose a worker</option>
            {workers
              .filter((w) => w.isActive)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.fullName} ({w.workerCode})
                </option>
              ))}
          </select>
          {message("workerId") && (
            <p id={`${workerKey}-error`} className="mt-1 text-sm text-red-700">
              {message("workerId")}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={typeKey} className="text-sm font-medium">
            Leave type
          </label>
          <select
            id={typeKey}
            value={leaveType}
            disabled={pending}
            onChange={(e) => setLeaveType(e.target.value as LeaveType)}
            className={fieldClass}
            aria-invalid={!!message("leaveType")}
            aria-describedby={
              message("leaveType") ? `${typeKey}-error` : undefined
            }
          >
            {LEAVE_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          {message("leaveType") && (
            <p id={`${typeKey}-error`} className="mt-1 text-sm text-red-700">
              {message("leaveType")}
            </p>
          )}
        </div>
        <TextField
          label="Start date"
          type="date"
          required
          value={startDate}
          inputRef={startRef}
          disabled={pending}
          onChange={(e) => setStartDate(e.target.value)}
          error={message("startDate")}
        />
        <TextField
          label="End date"
          type="date"
          required
          value={endDate}
          inputRef={endRef}
          disabled={pending}
          onChange={(e) => setEndDate(e.target.value)}
          error={message("endDate")}
        />
        {error && <ActionFailure message={error} />}
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="min-h-11 rounded-lg border border-gray-300 px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className={`${primaryButtonClass} disabled:opacity-60`}
          >
            {pending ? "Submitting..." : "Submit request"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
