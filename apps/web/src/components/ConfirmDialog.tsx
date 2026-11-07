import { useId, useRef } from "react";
import { Loader2, Trash2, type LucideIcon } from "lucide-react";
import { buttonClass } from "../ui";
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
      <p id={messageId} className="mt-3 text-base text-ink-800">
        {message}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={pending} className={buttonClass("secondary")}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={pending} aria-busy={pending} className={buttonClass("danger")}>
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
