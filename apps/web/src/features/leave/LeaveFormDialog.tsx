import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { preparePhoto } from "./photo";
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
const photoButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
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
  const [photo, setPhoto] = useState<{ base64: string; previewUrl: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoRef = useRef(photo);
  photoRef.current = photo;
  useEffect(() => () => {
    if (photoRef.current) URL.revokeObjectURL(photoRef.current.previewUrl);
  }, []);
  async function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const next = await preparePhoto(file);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      setPhoto(next);
    } catch {
      setPhotoError("That image could not be read. Try another photo.");
    } finally {
      setPhotoBusy(false);
    }
  }
  function removePhoto() {
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setPhoto(null);
  }
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
    onSubmit({
      workerId: Number(workerId),
      leaveType,
      startDate,
      endDate,
      ...(photo ? { attachmentBase64: photo.base64 } : {}),
    });
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
          Days are inclusive calendar days. Once approved, leave fills Daily
          Attendance for every day of the request.
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
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
        <fieldset className="space-y-2" disabled={pending}>
          <legend className="text-sm font-medium">
            Leave document photo{" "}
            <span className="font-normal text-gray-600">(optional)</span>
          </legend>
          <p className="text-xs text-gray-600">
            Photo of the signed request or doctor's note.
          </p>
          {photo ? (
            <div className="flex items-end gap-3">
              <img
                src={photo.previewUrl}
                alt="Attached leave document preview"
                className="h-28 max-w-[50%] rounded-lg border border-gray-200 bg-gray-50 object-contain"
              />
              <button type="button" onClick={removePhoto} className={photoButtonClass}>
                <Trash2 aria-hidden="true" size={16} />
                Remove photo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className={`${photoButtonClass} cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-600`}>
                <Camera aria-hidden="true" size={16} />
                Take photo
                <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={photoBusy} onChange={pickPhoto} />
              </label>
              <label className={`${photoButtonClass} cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-600`}>
                <ImagePlus aria-hidden="true" size={16} />
                Upload
                <input type="file" accept="image/*" className="sr-only" disabled={photoBusy} onChange={pickPhoto} />
              </label>
            </div>
          )}
          {photoBusy && <p role="status" className="text-sm text-gray-600">Preparing photo...</p>}
          {photoError && <p role="alert" className="text-sm text-red-700">{photoError}</p>}
          {message("attachment") && <p role="alert" className="text-sm text-red-700">{message("attachment")}</p>}
        </fieldset>
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
