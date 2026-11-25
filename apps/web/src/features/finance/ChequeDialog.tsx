import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Save } from "lucide-react";
import { createFinCheque, listFinEntries, updateFinCheque, type FinAccount, type FinCheque, type FinChequeDirection, type FinEntry } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Select, Textarea } from "../../ui";
import { formatDay, formatMoney, parseMoneyInput, todayInUae } from "./financeFormat";

type FieldName = "direction" | "serial" | "amount" | "partyName" | "issueDate" | "dueDate" | "accountId" | "entryId" | "notes";
const FIELDS: FieldName[] = ["direction", "serial", "amount", "partyName", "issueDate", "dueDate", "accountId", "entryId", "notes"];

interface ChequeDialogProps {
  /** Null records a new cheque; a cheque edits that one (only while it is open). */
  cheque: FinCheque | null;
  direction: FinChequeDirection;
  accounts: FinAccount[];
  variant: "center" | "sheet";
  onClose: () => void;
  onSaved: (cheque: FinCheque, message: string) => void;
}

/** A cheque written or received: its number, who is on it, the date on it (a later date makes it post-dated), and the expense or income it belongs to. */
export function ChequeDialog({ cheque, direction, accounts, variant, onClose, onSaved }: ChequeDialogProps) {
  const [kind, setKind] = useState<FinChequeDirection>(cheque?.direction ?? direction);
  const issued = kind === "Issued";
  const banks = accounts.filter((a) => a.kind === "Bank" && a.isActive);
  const [serial, setSerial] = useState(cheque?.serial ?? "");
  const [amount, setAmount] = useState(cheque ? String(cheque.amount) : "");
  const [party, setParty] = useState(cheque?.partyName ?? "");
  const [issueDate, setIssueDate] = useState(cheque?.issueDate ?? todayInUae());
  const [dueDate, setDueDate] = useState(cheque?.dueDate ?? todayInUae());
  const [accountId, setAccountId] = useState(cheque ? String(cheque.accountId) : banks.length === 1 ? String(banks[0].id) : "");
  const [entryId, setEntryId] = useState(cheque?.entryId ? String(cheque.entryId) : "");
  const [notes, setNotes] = useState(cheque?.notes ?? "");
  const [entries, setEntries] = useState<FinEntry[]>([]);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const serialRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    listFinEntries(issued ? "Expense" : "Income")
      .then((list) => !cancelled && setEntries(list.items))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [issued]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = parseMoneyInput(amount);
    const next: Partial<Record<FieldName, string>> = {};
    if (!serial.trim()) next.serial = "Enter the cheque number.";
    if (value === null || value <= 0) next.amount = "Enter an amount above zero with at most 2 decimals.";
    if (!party.trim()) next.partyName = issued ? "Enter the name on the cheque." : "Enter who gave the cheque.";
    if (!issueDate) next.issueDate = "Enter the day it was written.";
    if (!dueDate) next.dueDate = "Enter the date on the cheque.";
    else if (issueDate && dueDate < issueDate) next.dueDate = "The cheque date cannot be before the day it was written.";
    if (!accountId) next.accountId = issued ? "Choose the bank account it is drawn on." : "Choose the bank account it will be paid into.";
    setErrors(next);
    setGeneral(null);
    if (Object.keys(next).length > 0 || value === null) return;

    setPending(true);
    try {
      const input = { direction: kind, serial: serial.trim(), amount: value, partyName: party.trim(), issueDate, dueDate, accountId: Number(accountId), entryId: entryId ? Number(entryId) : null, notes: notes.trim() };
      const saved = cheque ? await updateFinCheque(cheque.id, input) : await createFinCheque(input);
      onSaved(saved, cheque ? `Cheque ${saved.serial} was updated.` : `Cheque ${saved.serial} was added.`);
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) {
        const mapped: Partial<Record<FieldName, string>> = {};
        const rest: string[] = [];
        for (const [key, messages] of Object.entries(error.fieldErrors)) {
          if ((FIELDS as string[]).includes(key)) mapped[key as FieldName] = messages.join(" ");
          else rest.push(...messages);
        }
        setErrors(mapped);
        setGeneral(rest.length ? rest.join(" ") : null);
      } else {
        setGeneral(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  const postDated = dueDate > issueDate;
  return (
    <Dialog open title={cheque ? "Edit cheque" : issued ? "Add a cheque you wrote" : "Add a cheque you received"} onClose={pending ? () => {} : onClose} initialFocusRef={serialRef} variant={variant} size="wide">
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        {!cheque && (
          <Select label="Type" value={kind} onChange={(e) => { setKind(e.target.value as FinChequeDirection); setEntryId(""); }} error={errors.direction}>
            <option value="Issued">Issued: you wrote it (payable)</option>
            <option value="Received">Received: you were given it (receivable)</option>
          </Select>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Cheque number" value={serial} onChange={(e) => setSerial(e.target.value)} error={errors.serial} inputRef={serialRef} maxLength={30} autoComplete="off" />
          <TextField label="Amount (AED)" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} inputMode="decimal" autoComplete="off" placeholder="0.00" />
        </div>
        <TextField label={issued ? "Name on the cheque (payee)" : "Given by"} value={party} onChange={(e) => setParty(e.target.value)} error={errors.partyName} maxLength={120} autoComplete="off" />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Written on" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} error={errors.issueDate} />
          <TextField label="Date on the cheque" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={errors.dueDate} hint={postDated ? "A later date makes this a post-dated cheque. It counts as money already committed until it clears." : undefined} />
        </div>
        <Select label={issued ? "Drawn on (bank account)" : "Paid into (bank account)"} value={accountId} onChange={(e) => setAccountId(e.target.value)} error={errors.accountId}>
          <option value="">Choose a bank account</option>
          {banks.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
        <Select label={issued ? "The expense it pays (optional)" : "The income it is for (optional)"} value={entryId} onChange={(e) => setEntryId(e.target.value)} error={errors.entryId}>
          <option value="">Not linked</option>
          {entries.map((e) => (
            <option key={e.id} value={e.id}>{e.entryNo} · {formatDay(e.entryDate)} · {e.party} · AED {formatMoney(e.amount)}</option>
          ))}
        </Select>
        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} error={errors.notes} rows={2} maxLength={2000} />
        {general && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{general}</p>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Save aria-hidden="true" size={16} />}
            {cheque ? "Save cheque" : "Add cheque"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
