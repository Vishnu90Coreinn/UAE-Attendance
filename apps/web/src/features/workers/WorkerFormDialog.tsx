import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { Loader2, Save } from "lucide-react";
import { ApiError } from "../../api/client";
import { getPayrollSettings } from "../../api/settings";
import { createWorker, getNextWorkerCode, updateWorker, type Worker } from "../../api/workers";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { formatRate } from "../../utils/money";
import {
  CHECKLIST,
  FIELD_ORDER,
  fieldForServerKey,
  toWorkerInput,
  validateWorker,
  type ChecklistValues,
  type FieldMessages,
  type WorkerField,
  type WorkerFormValues,
} from "./workerValidation";

function initialValues(worker: Worker | null): WorkerFormValues {
  return worker
    ? {
        workerCode: worker.workerCode,
        fullName: worker.fullName,
        designation: worker.designation,
        hourlyRate: worker.hourlyRate === null ? "" : formatRate(worker.hourlyRate),
        overtimeRate: worker.overtimeRate === null ? "" : formatRate(worker.overtimeRate),
        joinDate: worker.joinDate ?? "",
        department: worker.department ?? "",
        emiratesId: worker.emiratesId ?? "",
        passportNumber: worker.passportNumber ?? "",
        phone: worker.phone ?? "",
        email: worker.email ?? "",
        emergencyContact: worker.emergencyContact ?? "",
        workLocation: worker.workLocation ?? "",
        notes: worker.notes ?? "",
      }
    : {
        workerCode: "",
        fullName: "",
        designation: "",
        hourlyRate: "",
        overtimeRate: "",
        joinDate: "",
        department: "",
        emiratesId: "",
        passportNumber: "",
        phone: "",
        email: "",
        emergencyContact: "",
        workLocation: "",
        notes: "",
      };
}

function initialChecklist(worker: Worker | null): ChecklistValues {
  return {
    contractSigned: worker?.contractSigned ?? false,
    visaMedicalCleared: worker?.visaMedicalCleared ?? false,
    safetyGearIssued: worker?.safetyGearIssued ?? false,
    siteOrientationDone: worker?.siteOrientationDone ?? false,
    wpsRegistered: worker?.wpsRegistered ?? false,
    badgeIssued: worker?.badgeIssued ?? false,
  };
}

interface NotesFieldProps {
  value: string;
  error?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (event: { target: { value: string } }) => void;
  onBlur: () => void;
}

function NotesField({ value, error, textareaRef, onChange, onBlur }: NotesFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">
        Notes
      </label>
      <textarea
        id={id}
        name="notes"
        ref={textareaRef}
        rows={3}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder="Certifications, skills, remarks..."
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-base text-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${error ? "border-red-600" : "border-gray-300"}`}
      />
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

interface FormProps {
  worker: Worker | null;
  firstFieldRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onSaved: (worker: Worker) => void;
}

/** Mounted only while the dialog is open, so every opening starts from the worker's saved values. */
function WorkerForm({ worker, firstFieldRef, onClose, onSaved }: FormProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const designationRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);
  const overtimeRef = useRef<HTMLInputElement>(null);
  const joinRef = useRef<HTMLInputElement>(null);
  const departmentRef = useRef<HTMLInputElement>(null);
  const emiratesIdRef = useRef<HTMLInputElement>(null);
  const passportRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const emergencyRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const refs: Record<WorkerField, RefObject<HTMLInputElement | HTMLTextAreaElement | null>> = {
    workerCode: firstFieldRef,
    fullName: nameRef,
    designation: designationRef,
    hourlyRate: rateRef,
    overtimeRate: overtimeRef,
    joinDate: joinRef,
    department: departmentRef,
    emiratesId: emiratesIdRef,
    passportNumber: passportRef,
    phone: phoneRef,
    email: emailRef,
    emergencyContact: emergencyRef,
    workLocation: locationRef,
    notes: notesRef,
  };

  const [values, setValues] = useState<WorkerFormValues>(() => initialValues(worker));
  const [checklist, setChecklist] = useState<ChecklistValues>(() => initialChecklist(worker));
  const [touched, setTouched] = useState<Partial<Record<WorkerField, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<FieldMessages>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The company overtime rate, shown in the hint; stays null when it cannot be read.
  const [companyRate, setCompanyRate] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getPayrollSettings();
        if (!cancelled) {
          setCompanyRate(settings.overtimeRatePerHour);
        }
      } catch {
        // The hint simply omits the rate.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A new worker gets the next free ID suggested; it never overwrites something the user already typed.
  useEffect(() => {
    if (worker) {
      return;
    }
    let cancelled = false;
    getNextWorkerCode()
      .then((code) => {
        if (!cancelled) {
          setValues((current) => (current.workerCode === "" ? { ...current, workerCode: code } : current));
        }
      })
      .catch(() => {
        // The ID can still be typed by hand.
      });
    return () => {
      cancelled = true;
    };
  }, [worker]);

  const clientErrors = validateWorker(values);
  const shown: FieldMessages = {};
  for (const field of FIELD_ORDER) {
    const message = (touched[field] ? clientErrors[field] : undefined) ?? serverErrors[field];
    if (message) {
      shown[field] = message;
    }
  }
  const summary = [...FIELD_ORDER.map((field) => shown[field]), generalError].filter((m): m is string => !!m);

  function change(field: WorkerField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => ({ ...current, [field]: undefined }));
    setGeneralError(null);
  }

  function showServerFailure(error: unknown) {
    const mapped: FieldMessages = {};
    const unmapped: string[] = [];
    if (error instanceof ApiError && error.fieldErrors) {
      for (const [key, messages] of Object.entries(error.fieldErrors)) {
        const field = fieldForServerKey(key);
        if (field) {
          mapped[field] = messages.join(" ");
        } else {
          unmapped.push(...messages);
        }
      }
    }
    setServerErrors(mapped);
    if (unmapped.length > 0) {
      setGeneralError(unmapped.join(" "));
    } else if (Object.keys(mapped).length === 0) {
      setGeneralError(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    }
    const firstServerField = FIELD_ORDER.find((field) => mapped[field]);
    refs[firstServerField ?? "workerCode"].current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setTouched(Object.fromEntries(FIELD_ORDER.map((name) => [name, true])));
    setGeneralError(null);

    const firstInvalid = FIELD_ORDER.find((field) => clientErrors[field]);
    if (firstInvalid) {
      refs[firstInvalid].current?.focus();
      return;
    }

    setPending(true);
    setServerErrors({});
    try {
      const input = toWorkerInput(values, checklist);
      const saved = worker ? await updateWorker(worker.id, input) : await createWorker(input);
      onSaved(saved);
    } catch (error) {
      showServerFailure(error);
    } finally {
      setPending(false);
    }
  }

  function field(name: WorkerField) {
    return {
      name,
      value: values[name],
      error: shown[name],
      inputRef: refs[name] as RefObject<HTMLInputElement | null>,
      onChange: (event: { target: { value: string } }) => change(name, event.target.value),
      onBlur: () => setTouched((current) => ({ ...current, [name]: true })),
    };
  }

  function notesField() {
    return {
      value: values.notes,
      error: shown.notes,
      textareaRef: notesRef,
      onChange: (event: { target: { value: string } }) => change("notes", event.target.value),
      onBlur: () => setTouched((current) => ({ ...current, notes: true })),
    };
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-6">
      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-teal-800">Identity</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Worker ID" autoComplete="off" autoCapitalize="characters" spellCheck={false} {...field("workerCode")} />
          <TextField label="Full name" autoComplete="off" {...field("fullName")} />
          <TextField
            label="Designation"
            placeholder="e.g. Glass Installer, Aluminum Fabricator"
            autoComplete="off"
            {...field("designation")}
          />
          <TextField label="Department" placeholder="e.g. Glass Installation" autoComplete="off" {...field("department")} />
          <TextField label="Join date (optional)" type="date" hint="Printed on the payslip." {...field("joinDate")} />
          <TextField label="Site / work location" placeholder="e.g. Musaffah Factory" autoComplete="off" {...field("workLocation")} />
        </div>
      </fieldset>

      <fieldset className="space-y-4 border-t border-gray-200 pt-4">
        <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-teal-800">Pay</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Base hourly rate (AED)" type="text" inputMode="decimal" autoComplete="off" {...field("hourlyRate")} />
          <TextField
            label="Overtime rate (AED/hr) - optional"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            hint={
              companyRate === null
                ? "Leave blank to use the company rate"
                : `Leave blank to use the company rate (${formatRate(companyRate)})`
            }
            {...field("overtimeRate")}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4 border-t border-gray-200 pt-4">
        <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-teal-800">Contact & documents (optional)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Emirates ID"
            placeholder="784-1990-1234567-1"
            autoComplete="off"
            spellCheck={false}
            {...field("emiratesId")}
          />
          <TextField label="Passport number" autoComplete="off" autoCapitalize="characters" spellCheck={false} {...field("passportNumber")} />
          <TextField label="Phone" type="tel" placeholder="+971 50 123 4567" autoComplete="off" {...field("phone")} />
          <TextField label="Email" type="email" autoComplete="off" spellCheck={false} {...field("email")} />
          <div className="sm:col-span-2">
            <TextField
              label="Emergency contact"
              placeholder="e.g. Brother: +971 55 987 6543"
              autoComplete="off"
              {...field("emergencyContact")}
            />
          </div>
          <div className="sm:col-span-2">
            <NotesField {...notesField()} />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <legend className="px-1 text-sm font-semibold uppercase tracking-wide text-teal-800">Onboarding checklist</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {CHECKLIST.map(({ key, label }) => (
            <label key={key} className="flex min-h-11 items-center gap-3 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={checklist[key]}
                onChange={(event) => setChecklist((current) => ({ ...current, [key]: event.target.checked }))}
                className="h-5 w-5 rounded border-gray-300 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {summary.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p className="font-medium">Please fix the following:</p>
          <ul className="mt-1 list-disc pl-5">
            {summary.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-base font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-base font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? (
            <>
              <Loader2 aria-hidden="true" size={16} className="animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save aria-hidden="true" size={16} />
              Save worker
            </>
          )}
        </button>
      </div>
    </form>
  );
}

interface WorkerFormDialogProps {
  open: boolean;
  /** The worker to edit, or null to add a new one. */
  worker: Worker | null;
  onClose: () => void;
  /** Called with the saved worker; the parent closes the dialog. */
  onSaved: (worker: Worker) => void;
}

export function WorkerFormDialog({ open, worker, onClose, onSaved }: WorkerFormDialogProps) {
  const firstFieldRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={worker ? "Edit Worker Profile" : "Add New Worker"}
      initialFocusRef={firstFieldRef}
      size="wide"
    >
      <WorkerForm worker={worker} firstFieldRef={firstFieldRef} onClose={onClose} onSaved={onSaved} />
    </Dialog>
  );
}
