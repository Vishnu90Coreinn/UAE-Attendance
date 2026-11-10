import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

export const controlClass = (invalid?: boolean) =>
  cx(
    "mt-1 block min-h-11 w-full rounded-lg border bg-white px-3 text-base text-ink-900 placeholder:text-ink-400 transition-colors duration-150 hover:border-ink-400 focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-500/30 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500 md:min-h-10 md:text-sm",
    invalid ? "border-danger" : "border-ink-300",
  );

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  /** For table cells whose column header already names the field: keeps the label for screen readers only. */
  hideLabel?: boolean;
  /** Receives the ids to wire onto the control. */
  children: (props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string; className: string }) => ReactNode;
}

/** Visible label, control, hint and error, wired together for screen readers. */
export function Field({ label, error, hint, hideLabel, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");
  const control = controlClass(!!error);
  return (
    <div>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "block text-sm font-medium text-ink-800"}>
        {label}
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy || undefined,
        className: hideLabel ? control.replace("mt-1 ", "") : control,
      })}
      {error && (
        <p id={errorId} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-ink-600">
          {hint}
        </p>
      )}
    </div>
  );
}

type WithField<T> = Omit<T, "id" | "className"> & { label: string; error?: string; hint?: string; hideLabel?: boolean };

export function Input({ label, error, hint, hideLabel, ...rest }: WithField<InputHTMLAttributes<HTMLInputElement>>) {
  return (
    <Field label={label} error={error} hint={hint} hideLabel={hideLabel}>
      {(p) => <input {...rest} {...p} />}
    </Field>
  );
}

export function Select({ label, error, hint, children, ...rest }: WithField<SelectHTMLAttributes<HTMLSelectElement>>) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(p) => (
        <select {...rest} {...p}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function Textarea({ label, error, hint, ...rest }: WithField<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(p) => <textarea {...rest} {...p} />}
    </Field>
  );
}

/** Class for a bare control (no label wrapper), for toolbars and table cells. Same look as `Field`. */
export const inputClass = controlClass().replace("mt-1 block ", "block ");
