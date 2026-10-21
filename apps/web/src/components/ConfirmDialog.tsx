import { useId, useRef } from "react";
import { Loader2, Trash2, type LucideIcon } from "lucide-react";
import { Dialog } from "./Dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Text of the destructive button, for example "Delete". */
  confirmLabel: string;
  confirmIcon?: LucideIcon;
  /** True while the confirmed action runs: both buttons are disabled and the dialog cannot be dismissed. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A question with a safe default: Cancel has focus when it opens, the red button does the work. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  confirmIcon: ConfirmIcon = Trash2,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      title={title}
      onClose={pending ? () => {} : onCancel}
      initialFocusRef={cancelRef}
      descriptionId={messageId}
    >
      <p id={messageId} className="mt-3 text-base text-gray-800">
        {message}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-base font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          aria-busy={pending}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-base font-medium text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? (
            <>
              <Loader2 aria-hidden="true" size={16} className="animate-spin" />
              Working...
            </>
          ) : (
            <>
              <ConfirmIcon aria-hidden="true" size={16} />
              {confirmLabel}
            </>
          )}
        </button>
      </div>
    </Dialog>
  );
}
