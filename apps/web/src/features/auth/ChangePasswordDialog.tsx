import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { changePassword } from "../../api/auth";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";

const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

type Field = "current" | "next" | "confirm";

const FIELD_ORDER: readonly Field[] = ["current", "next", "confirm"];

/** The API's validation keys (camelCase) mapped to the form fields they belong to. */
const SERVER_FIELD: Record<string, Field> = {
  currentpassword: "current",
  newpassword: "next",
};

type Messages = Partial<Record<Field, string>>;

function validate(values: Record<Field, string>): Messages {
  const errors: Messages = {};
  if (values.current === "") {
    errors.current = "Enter your current password.";
  }
  if (values.next.length < MIN_LENGTH) {
    errors.next = `New password must be at least ${MIN_LENGTH} characters.`;
  } else if (values.next.length > MAX_LENGTH) {
    errors.next = `New password must be at most ${MAX_LENGTH} characters.`;
  }
  if (values.confirm !== values.next) {
    errors.confirm = "The confirmation does not match the new password.";
  }
  return errors;
}

const inputClass =
  "mt-1 block min-h-11 w-full rounded-lg border bg-white px-3 text-base text-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-base font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

interface FormProps {
  firstFieldRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
}

/** Mounted only while the dialog is open, so every opening starts with empty fields and no errors. */
function ChangePasswordForm({ firstFieldRef, onClose }: FormProps) {
  const idPrefix = useId();
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const refs: Record<Field, RefObject<HTMLInputElement | null>> = {
    current: firstFieldRef,
    next: nextRef,
    confirm: confirmRef,
  };

  const [values, setValues] = useState<Record<Field, string>>({ current: "", next: "", confirm: "" });
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Messages>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) {
      closeRef.current?.focus();
    }
  }, [done]);

  const clientErrors = validate(values);
  const shown: Messages = {};
  for (const field of FIELD_ORDER) {
    const message = (touched[field] ? clientErrors[field] : undefined) ?? serverErrors[field];
    if (message) {
      shown[field] = message;
    }
  }
  const summary = [...FIELD_ORDER.map((f) => shown[f]), generalError].filter((m): m is string => !!m);

  function change(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => ({ ...current, [field]: undefined }));
    setGeneralError(null);
  }

  function markTouched(field: Field) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setTouched({ current: true, next: true, confirm: true });
    setGeneralError(null);

    const firstInvalid = FIELD_ORDER.find((f) => clientErrors[f]);
    if (firstInvalid) {
      refs[firstInvalid].current?.focus();
      return;
    }

    setPending(true);
    setServerErrors({});
    try {
      await changePassword(values.current, values.next);
      setDone(true);
    } catch (e) {
      const mapped: Messages = {};
      const unmapped: string[] = [];
      if (e instanceof ApiError && e.fieldErrors) {
        for (const [key, messages] of Object.entries(e.fieldErrors)) {
          const field = SERVER_FIELD[key.toLowerCase()];
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
        setGeneralError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      }
      const firstServerField = FIELD_ORDER.find((f) => mapped[f]);
      refs[firstServerField ?? "current"].current?.focus();
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="mt-4 space-y-4">
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          <CheckCircle2 aria-hidden="true" size={20} className="mt-0.5 shrink-0" />
          Your password has been changed.
        </p>
        <div className="flex justify-end">
          <button ref={closeRef} type="button" onClick={onClose} className={secondaryButtonClass}>
            Close
          </button>
        </div>
      </div>
    );
  }

  function fieldProps(field: Field, hintId?: string) {
    const errorId = `${idPrefix}-${field}-error`;
    const describedBy = [hintId, shown[field] ? errorId : undefined].filter(Boolean).join(" ");
    return {
      errorId,
      input: {
        id: `${idPrefix}-${field}`,
        name: field === "current" ? "currentPassword" : field === "next" ? "newPassword" : "confirmPassword",
        type: "password" as const,
        value: values[field],
        onChange: (e: { target: { value: string } }) => change(field, e.target.value),
        onBlur: () => markTouched(field),
        "aria-invalid": shown[field] ? true : undefined,
        "aria-describedby": describedBy || undefined,
        className: `${inputClass} ${shown[field] ? "border-red-600" : "border-gray-300"}`,
      },
    };
  }

  const current = fieldProps("current");
  const next = fieldProps("next", `${idPrefix}-next-hint`);
  const confirm = fieldProps("confirm");

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
      <div>
        <label htmlFor={current.input.id} className="block text-sm font-medium text-gray-800">
          Current password
        </label>
        <input {...current.input} ref={firstFieldRef} autoComplete="current-password" />
        {shown.current && (
          <p id={current.errorId} className="mt-1 text-sm text-red-700">
            {shown.current}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={next.input.id} className="block text-sm font-medium text-gray-800">
          New password
        </label>
        <input {...next.input} ref={nextRef} autoComplete="new-password" />
        <p id={`${idPrefix}-next-hint`} className="mt-1 text-sm text-gray-500">
          At least {MIN_LENGTH} characters
        </p>
        {shown.next && (
          <p id={next.errorId} className="mt-1 text-sm text-red-700">
            {shown.next}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={confirm.input.id} className="block text-sm font-medium text-gray-800">
          Confirm new password
        </label>
        <input {...confirm.input} ref={confirmRef} autoComplete="new-password" />
        {shown.confirm && (
          <p id={confirm.errorId} className="mt-1 text-sm text-red-700">
            {shown.confirm}
          </p>
        )}
      </div>

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
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
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
              <KeyRound aria-hidden="true" size={16} />
              Save password
            </>
          )}
        </button>
      </div>
    </form>
  );
}

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

/** The parent owns `open`; Cancel, Close and Esc all call onClose. */
export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps) {
  const firstFieldRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onClose={onClose} title="Change password" initialFocusRef={firstFieldRef}>
      <ChangePasswordForm firstFieldRef={firstFieldRef} onClose={onClose} />
    </Dialog>
  );
}
