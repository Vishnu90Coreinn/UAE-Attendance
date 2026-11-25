import { useState, type FormEvent } from "react";
import { Ban, Loader2, type LucideIcon } from "lucide-react";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { Button, Textarea } from "../../ui";

interface VoidDialogProps {
  title: string;
  /** What will happen, in a sentence. */
  message: string;
  confirmLabel: string;
  /** Defaults to the red "void" look; an unlock is not destructive. */
  confirmIcon?: LucideIcon;
  danger?: boolean;
  /** Runs the action with the typed reason; a rejection's message is shown in the dialog. */
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
  variant: "center" | "sheet";
}

/** Asks for the reason that is kept with a voided entry or transfer, or an unlocked month. */
export function VoidDialog({ title, message, confirmLabel, confirmIcon: Icon = Ban, danger = true, onConfirm, onClose, variant }: VoidDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      setError("Enter the reason. It is kept with the record.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Something went wrong. Please try again.");
      setPending(false);
    }
  }

  return (
    <Dialog open title={title} onClose={pending ? () => {} : onClose} variant={variant}>
      <form onSubmit={submit} noValidate className="mt-3 space-y-4">
        <p className="text-sm text-ink-700">{message}</p>
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} error={error ?? undefined} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} disabled={pending}>
            {pending ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Icon aria-hidden="true" size={16} />}
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
