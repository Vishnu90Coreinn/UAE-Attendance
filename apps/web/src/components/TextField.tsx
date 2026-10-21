import { useId, type InputHTMLAttributes, type Ref } from "react";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> {
  /** Always visible; placeholders are only examples. */
  label: string;
  /** What to fix. Shown under the field and linked to it for screen readers. */
  error?: string;
  /** Helper text shown under the field and read out after the label (and after any error). */
  hint?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/** A labelled text input, at least 44px tall, with its hint and error message under it. */
export function TextField({ label, error, hint, inputRef, ...input }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">
        {label}
      </label>
      <input
        {...input}
        id={id}
        ref={inputRef}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`mt-1 block min-h-11 w-full rounded-lg border bg-white px-3 text-base text-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${error ? "border-red-600" : "border-gray-300"}`}
      />
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-gray-600">
          {hint}
        </p>
      )}
    </div>
  );
}
