import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Loader2, Save } from "lucide-react";
import { ApiError } from "../../api/client";
import { createWorker, getNextWorkerCode, updateWorker, type Worker } from "../../api/workers";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { formatRate } from "../../utils/money";
import {
  FIELD_ORDER,
  fieldForServerKey,
  toWorkerInput,
  validateWorker,
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
        hourlyRate: formatRate(worker.hourlyRate),
      }
    : { workerCode: "", fullName: "", designation: "", hourlyRate: "" };
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
  const refs: Record<WorkerField, RefObject<HTMLInputElement | null>> = {
    workerCode: firstFieldRef,
    fullName: nameRef,
    designation: designationRef,
    hourlyRate: rateRef,
  };

  const [values, setValues] = useState<WorkerFormValues>(() => initialValues(worker));
  const [touched, setTouched] = useState<Partial<Record<WorkerField, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<FieldMessages>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    setTouched({ workerCode: true, fullName: true, designation: true, hourlyRate: true });
    setGeneralError(null);

    const firstInvalid = FIELD_ORDER.find((field) => clientErrors[field]);
    if (firstInvalid) {
      refs[firstInvalid].current?.focus();
      return;
    }

    setPending(true);
    setServerErrors({});
    try {
      const input = toWorkerInput(values);
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
      inputRef: refs[name],
      onChange: (event: { target: { value: string } }) => change(name, event.target.value),
      onBlur: () => setTouched((current) => ({ ...current, [name]: true })),
    };
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
      <TextField label="Worker ID" autoComplete="off" autoCapitalize="characters" spellCheck={false} {...field("workerCode")} />
      <TextField label="Full name" autoComplete="off" {...field("fullName")} />
      <TextField
        label="Designation"
        placeholder="e.g. Glass Installer, Aluminum Fabricator"
        autoComplete="off"
        {...field("designation")}
      />
      <TextField label="Base hourly rate (AED)" type="text" inputMode="decimal" autoComplete="off" {...field("hourlyRate")} />

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
    >
      <WorkerForm worker={worker} firstFieldRef={firstFieldRef} onClose={onClose} onSaved={onSaved} />
    </Dialog>
  );
}
