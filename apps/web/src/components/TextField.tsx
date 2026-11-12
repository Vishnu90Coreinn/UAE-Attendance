import { type InputHTMLAttributes, type Ref } from "react";
import { Field } from "../ui";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> {
  /** Always visible; placeholders are only examples. */
  label: string;
  /** What to fix. Shown under the field and linked to it for screen readers. */
  error?: string;
  /** Helper text shown under the field and read out after the label (and after any error). */
  hint?: string;
  /** Keep the label for screen readers only; use where a table header already names the field. */
  hideLabel?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

/** A labelled text input with its hint and error message under it. Built on the shared `Field`. */
export function TextField({ label, error, hint, hideLabel, inputRef, ...input }: TextFieldProps) {
  return (
    <Field label={label} error={error} hint={hint} hideLabel={hideLabel}>
      {(p) => <input {...input} {...p} ref={inputRef} />}
    </Field>
  );
}
