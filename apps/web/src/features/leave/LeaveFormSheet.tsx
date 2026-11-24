import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Camera, CircleAlert, ImagePlus, Thermometer, Trash2, TreePalm, Wallet, type LucideIcon } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { WorkerPicker } from "../../components/WorkerPicker";
import { LEAVE_TYPES, type LeaveInput, type LeaveType } from "../../api/leave";
import type { Worker } from "../../api/workers";
import { ActionFailure } from "../workers/WorkersFeedback";
import { phoneButton } from "../../components/phoneUi";
import { preparePhoto } from "./photo";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
/** Calendar days from start to end, counting both, or null while the dates are missing or the wrong way round. */
function inclusiveDays(start: string, end: string): number | null {
  if (!start || !end || end < start) return null;
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
}

const TYPE_ICON: Record<LeaveType, LucideIcon> = {
  "Annual Leave": TreePalm,
  "Sick Leave": Thermometer,
  "Unpaid Leave": Wallet,
  "Emergency Leave": CircleAlert,
};

interface Props {
  workers: Worker[];
  pending: boolean;
  error: string | null;
  fieldErrors: Record<string, string[]> | undefined;
  onSubmit: (input: LeaveInput) => void;
  onClose: () => void;
}

const dateClass = `mt-1.5 block min-h-12 w-full rounded-xl border border-ink-300 bg-white px-3 text-base text-ink-900 ${focusRing}`;

/**
 * "New Leave Request" as a phone sheet: pick the worker by searching, the type from four tiles, and the dates with a
 * live count of days. The note (a photo of the signed request or the doctor's note) is asked for only on sick leave.
 */
export function LeaveFormSheet({ workers, pending, error, fieldErrors, onSubmit, onClose }: Props) {
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
  useEffect(
    () => () => {
      if (photoRef.current) URL.revokeObjectURL(photoRef.current.previewUrl);
    },
    [],
  );

  const message = (key: string) => errors[key] ?? fieldErrors?.[key]?.join(" ");
  const active = workers.filter((w) => w.isActive);
  const days = inclusiveDays(startDate, endDate);
  const sick = leaveType === "Sick Leave";

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
  function changeStart(value: string) {
    setStartDate(value);
    // Keep the range valid: a start after the end moves the end along with it.
    if (value && endDate < value) setEndDate(value);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const invalid: Record<string, string> = {};
    if (!workerId) invalid.workerId = "Choose a worker.";
    if (!startDate) invalid.startDate = "Choose a start date.";
    if (!endDate) invalid.endDate = "Choose an end date.";
    else if (startDate && endDate < startDate) invalid.endDate = "End date must be on or after start date.";
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    onSubmit({
      workerId: Number(workerId),
      leaveType,
      startDate,
      endDate,
      ...(sick && photo ? { attachmentBase64: photo.base64 } : {}),
    });
  }

  return (
    <Dialog open title="New Leave Request" variant="sheet" onClose={pending ? () => {} : onClose}>
      <form noValidate onSubmit={submit} className="mt-3 space-y-5">
        <WorkerPicker
          workers={active}
          value={workerId}
          onChange={(id) => {
            setWorkerId(id);
            setErrors((current) => ({ ...current, workerId: "" }));
          }}
          error={message("workerId")}
          disabled={pending}
        />

        <fieldset disabled={pending}>
          <legend className="text-sm font-bold text-ink-800">Leave type</legend>
          <div role="group" aria-label="Leave type" className="mt-1.5 grid grid-cols-2 gap-2">
            {LEAVE_TYPES.map((type) => {
              const Icon = TYPE_ICON[type];
              const on = leaveType === type;
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setLeaveType(type)}
                  className={`flex min-h-14 items-center gap-2.5 rounded-2xl border px-3 text-left text-[0.9375rem] font-semibold transition-colors duration-150 ${focusRing} ${
                    on ? "border-brand-700 bg-brand-700 text-white" : "border-ink-300 bg-white text-ink-900 active:bg-ink-100"
                  }`}
                >
                  <Icon aria-hidden="true" size={20} className="shrink-0" />
                  {type}
                </button>
              );
            })}
          </div>
          {message("leaveType") && <p className="mt-1 text-sm text-red-700">{message("leaveType")}</p>}
        </fieldset>

        <fieldset disabled={pending}>
          <legend className="sr-only">Dates</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="leave-start" className="text-sm font-bold text-ink-800">
                Start date
              </label>
              <input id="leave-start" type="date" required value={startDate} onChange={(event) => changeStart(event.target.value)} aria-invalid={!!message("startDate")} className={dateClass} />
              {message("startDate") && <p className="mt-1 text-sm text-red-700">{message("startDate")}</p>}
            </div>
            <div>
              <label htmlFor="leave-end" className="text-sm font-bold text-ink-800">
                End date
              </label>
              <input id="leave-end" type="date" required value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} aria-invalid={!!message("endDate")} className={dateClass} />
              {message("endDate") && <p className="mt-1 text-sm text-red-700">{message("endDate")}</p>}
            </div>
          </div>
          <p role="status" className="mt-2 text-sm text-ink-700">
            {days === null ? "Choose the dates." : <><span className="font-bold tabular-nums text-ink-900">{days} {days === 1 ? "day" : "days"}</span>, counting both the start and the end. Once approved, this fills Attendance for each day.</>}
          </p>
        </fieldset>

        {sick && (
          <fieldset className="space-y-2" disabled={pending}>
            <legend className="text-sm font-bold text-ink-800">
              Doctor's note <span className="font-normal text-ink-600">(optional)</span>
            </legend>
            {photo ? (
              <div className="flex items-end gap-3">
                <img src={photo.previewUrl} alt="Attached leave document preview" className="h-28 max-w-[50%] rounded-xl border border-line bg-ink-50 object-contain" />
                <button type="button" onClick={removePhoto} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-ink-300 px-4 text-sm font-semibold ${focusRing}`}>
                  <Trash2 aria-hidden="true" size={16} />
                  Remove photo
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className={`inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-ink-300 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500`}>
                  <Camera aria-hidden="true" size={18} />
                  Take photo
                  <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={photoBusy} onChange={pickPhoto} />
                </label>
                <label className={`inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-ink-300 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500`}>
                  <ImagePlus aria-hidden="true" size={18} />
                  Upload
                  <input type="file" accept="image/*" className="sr-only" disabled={photoBusy} onChange={pickPhoto} />
                </label>
              </div>
            )}
            {photoBusy && <p role="status" className="text-sm text-ink-600">Preparing photo...</p>}
            {photoError && <p role="alert" className="text-sm text-red-700">{photoError}</p>}
            {message("attachment") && <p role="alert" className="text-sm text-red-700">{message("attachment")}</p>}
          </fieldset>
        )}

        {error && <ActionFailure message={error} />}

        <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-line bg-white px-5 pb-1 pt-3">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className={phoneButton("secondary", "lg", "shrink-0")}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className={phoneButton("primary", "lg", "flex-1")}
          >
            {pending ? "Submitting..." : "Submit request"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
