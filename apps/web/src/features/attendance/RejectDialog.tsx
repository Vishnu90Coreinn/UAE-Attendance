import { useRef, useState, type FormEvent } from "react";
import { buttonClass } from "../../ui";
import { Loader2, X } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";

/** Asks the manager why an entry is being sent back, so the supervisor knows what to correct. */
export function RejectDialog({
  open,
  workerName,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  workerName: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  return (
    <Dialog
      open={open}
      title="Send entry back"
      onClose={pending ? () => {} : onCancel}
    >
      <RejectForm
        workerName={workerName}
        pending={pending}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    </Dialog>
  );
}

function RejectForm({
  workerName,
  pending,
  onCancel,
  onConfirm,
}: {
  workerName: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Enter a reason so the supervisor knows what to correct.");
      input.current?.focus();
      return;
    }
    if (trimmed.length > 200) {
      setError("Use 200 characters or fewer.");
      input.current?.focus();
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-4">
      <p className="text-base text-ink-800">
        {workerName}'s entry goes back to the supervisor. It does not count
        toward payroll until it is corrected and approved.
      </p>
      <TextField
        label="Reason"
        value={reason}
        inputRef={input}
        maxLength={200}
        error={error}
        disabled={pending}
        onChange={(event) => {
          setReason(event.target.value);
          setError(undefined);
        }}
      />
      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className={buttonClass("secondary", "md")}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className={buttonClass("danger", "md")}
        >
          {pending ? (
            <>
              <Loader2 aria-hidden="true" size={16} className="animate-spin" />
              Working...
            </>
          ) : (
            <>
              <X aria-hidden="true" size={16} />
              Send back
            </>
          )}
        </button>
      </div>
    </form>
  );
}
