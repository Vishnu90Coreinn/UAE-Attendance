import { useRef, useState, type FormEvent } from "react";
import { Loader2, Save } from "lucide-react";
import { createFinPayee, updateFinPayee, type FinCategory, type FinEntryKind, type FinPayee } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Select, Textarea } from "../../ui";

type FieldName = "name" | "kind" | "defaultCategoryId" | "phone" | "taxNumber" | "notes";
const FIELDS: FieldName[] = ["name", "kind", "defaultCategoryId", "phone", "taxNumber", "notes"];

interface PayeeDialogProps {
  /** Null adds a payee; a payee edits that payee. */
  payee: FinPayee | null;
  /** The kind a new payee starts as. */
  kind: FinEntryKind;
  categories: FinCategory[];
  variant: "center" | "sheet";
  onClose: () => void;
  onSaved: (payee: FinPayee, message: string) => void;
}

/** A person or company the business pays or is paid by, with the category usually used for it. */
export function PayeeDialog({ payee, kind, categories, variant, onClose, onSaved }: PayeeDialogProps) {
  const [chosenKind, setChosenKind] = useState<FinEntryKind>(payee?.kind ?? kind);
  const [name, setName] = useState(payee?.name ?? "");
  const [categoryId, setCategoryId] = useState(payee?.defaultCategoryId ? String(payee.defaultCategoryId) : "");
  const [phone, setPhone] = useState(payee?.phone ?? "");
  const [taxNumber, setTaxNumber] = useState(payee?.taxNumber ?? "");
  const [notes, setNotes] = useState(payee?.notes ?? "");
  const [active, setActive] = useState(payee?.isActive ?? true);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const options = categories.filter((c) => c.kind === chosenKind && c.isActive && !c.isSystem);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setErrors({ name: "Enter the name." });
      return;
    }
    setErrors({});
    setGeneral(null);
    setPending(true);
    try {
      const input = { kind: chosenKind, name: name.trim(), defaultCategoryId: categoryId ? Number(categoryId) : null, phone: phone.trim(), taxNumber: taxNumber.trim(), notes: notes.trim(), isActive: active };
      const saved = payee ? await updateFinPayee(payee.id, input) : await createFinPayee(input);
      onSaved(saved, payee ? `${saved.name} was updated.` : `${saved.name} was added.`);
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

  return (
    <Dialog open title={payee ? "Edit payee" : "Add payee"} onClose={pending ? () => {} : onClose} initialFocusRef={nameRef} variant={variant}>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        {!payee && (
          <Select label="Type" value={chosenKind} onChange={(e) => { setChosenKind(e.target.value as FinEntryKind); setCategoryId(""); }} error={errors.kind}>
            <option value="Expense">Paid to (expenses)</option>
            <option value="Income">Received from (income)</option>
          </Select>
        )}
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} inputRef={nameRef} maxLength={120} autoComplete="off" />
        <Select label="Usual category (optional)" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} error={errors.defaultCategoryId}>
          <option value="">No usual category</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} maxLength={40} autoComplete="off" />
          <TextField label="Tax number (optional)" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} error={errors.taxNumber} maxLength={40} autoComplete="off" />
        </div>
        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} error={errors.notes} rows={2} maxLength={500} />
        {payee && (
          <label className="flex min-h-11 items-center gap-3 text-sm text-ink-900">
            <input type="checkbox" className="size-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Offer this payee on new entries
          </label>
        )}
        {general && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{general}</p>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Save aria-hidden="true" size={16} />}
            {payee ? "Save payee" : "Add payee"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
