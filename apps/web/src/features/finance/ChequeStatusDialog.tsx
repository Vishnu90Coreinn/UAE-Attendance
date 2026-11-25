import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { changeFinChequeStatus, type FinCheque, type FinChequeStatus } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Textarea } from "../../ui";
import { todayInUae } from "./financeFormat";

/** What each next status means to the person clicking it, so the button is never a guess. */
export const STATUS_ACTIONS: Record<FinChequeStatus, { label: string; help: string; noteRequired: boolean; danger?: boolean }> = {
  Issued: { label: "Issued", help: "", noteRequired: false },
  Received: { label: "Received", help: "", noteRequired: false },
  Delivered: { label: "Mark as handed over", help: "The cheque has been given to the person it is written to.", noteRequired: false },
  Deposited: { label: "Mark as deposited", help: "The cheque has been paid into the bank.", noteRequired: false },
  Cleared: { label: "Mark as cleared", help: "The money has moved at the bank. Record the expense or income if you have not already.", noteRequired: false },
  Bounced: { label: "Mark as bounced", help: "The bank returned it. If you had recorded an income for it, void that income separately.", noteRequired: true, danger: true },
  Cancelled: { label: "Cancel cheque", help: "The cheque is no longer valid. It stays in the register.", noteRequired: true, danger: true },
};

interface ChequeStatusDialogProps {
  cheque: FinCheque;
  status: FinChequeStatus;
  variant: "center" | "sheet";
  onClose: () => void;
  onDone: (cheque: FinCheque, message: string) => void;
}

/** Moves a cheque to its next status on a chosen day, with a reason when it bounced or was cancelled. */
export function ChequeStatusDialog({ cheque, status, variant, onClose, onDone }: ChequeStatusDialogProps) {
  const action = STATUS_ACTIONS[status];
  const [date, setDate] = useState(todayInUae());
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ date?: string; note?: string }>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (action.noteRequired && !note.trim()) {
      setErrors({ note: status === "Bounced" ? "Enter why it bounced." : "Enter why it was cancelled." });
      return;
    }
    setErrors({});
    setGeneral(null);
    setPending(true);
    try {
      const saved = await changeFinChequeStatus(cheque.id, status, date, note.trim());
      onDone(saved, `Cheque ${saved.serial} is now ${saved.status.toLowerCase()}.`);
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) {
        setErrors({ date: error.fieldErrors.date?.join(" "), note: error.fieldErrors.note?.join(" ") });
      } else {
        setGeneral(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      }
      setPending(false);
    }
  }

  return (
    <Dialog open title={`${action.label}: cheque ${cheque.serial}`} onClose={pending ? () => {} : onClose} variant={variant}>
      <form onSubmit={submit} noValidate className="mt-3 space-y-4">
        <p className="text-sm text-ink-700">{action.help}</p>
        <TextField label="On" type="date" value={date} max={todayInUae()} onChange={(e) => setDate(e.target.value)} error={errors.date} />
        <Textarea label={action.noteRequired ? "Reason" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} error={errors.note} />
        {general && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{general}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Back</Button>
          <Button type="submit" variant={action.danger ? "danger" : "primary"} disabled={pending}>
            {pending && <Loader2 aria-hidden="true" size={16} className="animate-spin" />}
            {action.label}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
