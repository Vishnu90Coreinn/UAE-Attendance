import { useState, type FormEvent } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { createFinTransfer, type FinAccount, type FinTransfer } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Select, Textarea } from "../../ui";
import { formatMoney, parseMoneyInput, todayInUae } from "./financeFormat";

type FieldName = "transferDate" | "fromAccountId" | "toAccountId" | "amount" | "reference" | "notes";

interface TransferDialogProps {
  /** Active accounts only: money cannot be moved to or from a switched-off account. */
  accounts: FinAccount[];
  /** Pre-selects the account the money leaves. */
  fromId?: number;
  onClose: () => void;
  onSaved: (transfer: FinTransfer) => void;
  variant: "center" | "sheet";
}

/** Moves money between two of the company's own accounts. It is not an expense and not income. */
export function TransferDialog({ accounts, fromId, onClose, onSaved, variant }: TransferDialogProps) {
  const [date, setDate] = useState(todayInUae());
  const [from, setFrom] = useState(fromId ? String(fromId) : "");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const source = accounts.find((a) => String(a.id) === from);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Partial<Record<FieldName, string>> = {};
    if (!from) next.fromAccountId = "Choose the account the money leaves.";
    if (!to) next.toAccountId = "Choose the account the money goes to.";
    else if (from === to) next.toAccountId = "Choose two different accounts.";
    const value = parseMoneyInput(amount);
    if (value === null || value <= 0) next.amount = "Enter an amount above zero with at most 2 decimals.";
    if (!date) next.transferDate = "Enter the transfer date.";
    setErrors(next);
    setGeneral(null);
    if (Object.keys(next).length > 0 || value === null) return;

    setPending(true);
    try {
      const saved = await createFinTransfer({ transferDate: date, fromAccountId: Number(from), toAccountId: Number(to), amount: value, reference: reference.trim(), notes: notes.trim() });
      onSaved(saved);
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) {
        const mapped: Partial<Record<FieldName, string>> = {};
        const rest: string[] = [];
        for (const [key, messages] of Object.entries(error.fieldErrors)) {
          if (["transferDate", "fromAccountId", "toAccountId", "amount", "reference", "notes"].includes(key)) mapped[key as FieldName] = messages.join(" ");
          else rest.push(...messages);
        }
        setErrors(mapped);
        setGeneral(rest.length > 0 ? rest.join(" ") : null);
      } else {
        setGeneral(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open title="Transfer between accounts" onClose={pending ? () => {} : onClose} variant={variant}>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <Select label="From account" error={errors.fromAccountId} hint={source ? `Balance AED ${formatMoney(source.balance)}` : undefined} value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">Choose an account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <div aria-hidden="true" className="-my-1 flex justify-center text-ink-400">
          <ArrowRight size={18} className="rotate-90" />
        </div>
        <Select label="To account" error={errors.toAccountId} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose an account</option>
          {accounts
            .filter((a) => String(a.id) !== from)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </Select>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Amount (AED)" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} inputMode="decimal" autoComplete="off" />
          <TextField label="Date" type="date" value={date} max={todayInUae()} onChange={(e) => setDate(e.target.value)} error={errors.transferDate} />
        </div>
        <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} error={errors.reference} maxLength={60} autoComplete="off" />
        <Textarea label="Notes (optional)" error={errors.notes} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {general && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {general}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <ArrowRight aria-hidden="true" size={16} />}
            Transfer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
