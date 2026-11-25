import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { FileText, Loader2, Paperclip, Save, X } from "lucide-react";
import { addFinCapital, correctFinCapital, type FinAccount, type FinCapitalEntry, type FinCapitalKind, type FinPartner } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Select, Textarea } from "../../ui";
import { parseMoneyInput, todayInUae } from "./financeFormat";
import { formatBytes, receiptProblem, RECEIPT_MAX_FILES, shrinkPhoto } from "./receiptFile";

type FieldName = "amount" | "entryDate" | "partnerId" | "accountId" | "reference" | "notes" | "files";
const FIELDS: FieldName[] = ["amount", "entryDate", "partnerId", "accountId", "reference", "notes", "files"];

interface CapitalDialogProps {
  kind: FinCapitalKind;
  /** When set, the dialog corrects this entry: it is voided and the saved form replaces it. */
  entry?: FinCapitalEntry;
  partners: FinPartner[];
  accounts: FinAccount[];
  defaultPartnerId?: number;
  variant: "center" | "sheet";
  onClose: () => void;
  onSaved: (entry: FinCapitalEntry) => void;
}

/** Capital a partner puts in (into an account) or takes back (out of an account). An attachment is optional. */
export function CapitalDialog({ kind, entry, partners, accounts, defaultPartnerId, variant, onClose, onSaved }: CapitalDialogProps) {
  const putIn = kind === "Capital";
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [date, setDate] = useState(entry?.entryDate ?? todayInUae());
  const [partnerId, setPartnerId] = useState(() => (entry?.partnerId ? String(entry.partnerId) : defaultPartnerId ? String(defaultPartnerId) : partners.length === 1 ? String(partners[0].id) : ""));
  const [accountId, setAccountId] = useState(() => (entry ? String(entry.accountId) : accounts.length === 1 ? String(accounts[0].id) : ""));
  const [reference, setReference] = useState(entry?.reference ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [keep, setKeep] = useState<number[]>(() => entry?.attachments.map((a) => a.id) ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    const accepted: File[] = [];
    for (const file of picked) {
      const prepared = await shrinkPhoto(file);
      const problem = receiptProblem(prepared);
      if (problem) {
        setErrors((current) => ({ ...current, files: problem }));
        return;
      }
      accepted.push(prepared);
    }
    setFiles((current) => {
      const next = [...current, ...accepted];
      if (next.length + keep.length > RECEIPT_MAX_FILES) {
        setErrors((e) => ({ ...e, files: `Attach at most ${RECEIPT_MAX_FILES} files.` }));
        return current;
      }
      setErrors((e) => ({ ...e, files: undefined }));
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Partial<Record<FieldName, string>> = {};
    const value = parseMoneyInput(amount);
    if (value === null || value <= 0) next.amount = "Enter an amount above zero with at most 2 decimals.";
    if (!date) next.entryDate = "Enter the date.";
    if (!partnerId) next.partnerId = "Choose the partner.";
    if (!accountId) next.accountId = putIn ? "Choose the account the money went into." : "Choose the account the money was paid from.";
    setErrors(next);
    setGeneral(null);
    if (Object.keys(next).length > 0 || value === null) return;

    setPending(true);
    try {
      const input = { entryDate: date, partnerId: Number(partnerId), accountId: Number(accountId), amount: value, reference: reference.trim(), notes: notes.trim(), files, keepAttachmentIds: keep };
      onSaved(entry ? await correctFinCapital(entry.id, input) : await addFinCapital(kind, input));
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

  const title = entry ? (putIn ? "Correct capital added" : "Correct capital returned") : putIn ? "Add capital" : "Return capital";
  return (
    <Dialog open title={title} onClose={pending ? () => {} : onClose} initialFocusRef={amountRef} variant={variant} size="wide">
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        {entry && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{entry.entryNo} will be voided and kept, and what you save here replaces it with a new number.</p>}
        <p className="text-sm text-ink-600">
          {putIn ? "Money a partner puts into the company. It raises the account's balance and the partner's capital. It is not income." : "Capital paid back to a partner. It lowers the account's balance and the partner's capital. It is not an expense."}
        </p>
        <div className="rounded-lg border border-line bg-ink-50 p-4">
          <TextField label="Amount (AED)" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} inputRef={amountRef} inputMode="decimal" autoComplete="off" placeholder="0.00" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Partner" value={partnerId} error={errors.partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">Choose a partner</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Select label={putIn ? "Paid into" : "Paid from"} value={accountId} error={errors.accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose an account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Date" type="date" value={date} max={todayInUae()} onChange={(e) => setDate(e.target.value)} error={errors.entryDate} />
          <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} error={errors.reference} maxLength={60} autoComplete="off" />
        </div>
        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} error={errors.notes} rows={2} maxLength={2000} />

        <fieldset className="rounded-lg border border-dashed border-ink-300 p-4">
          <legend className="px-1 text-sm font-medium text-ink-800">Attachment (optional)</legend>
          <p className="text-sm text-ink-600">For example the deposit slip or transfer advice. A photo, a PDF or a PNG, up to 5 MB each.</p>
          <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50 focus-within:outline-2 focus-within:outline-brand-500 md:min-h-10">
            <Paperclip aria-hidden="true" size={16} /> Choose file
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/*" multiple className="sr-only" onChange={(e) => void addFiles(e)} />
          </label>
          {entry && entry.attachments.length > 0 && (
            <ul className="mt-3 space-y-2" aria-label="Files already on this entry">
              {entry.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-2 text-sm">
                  <input id={`keep-${a.id}`} type="checkbox" className="size-5" checked={keep.includes(a.id)} onChange={(e) => setKeep((cur) => (e.target.checked ? [...cur, a.id] : cur.filter((n) => n !== a.id)))} />
                  <label htmlFor={`keep-${a.id}`} className="min-w-0 flex-1 truncate text-ink-900">Keep {a.fileName}</label>
                  <span className="shrink-0 text-ink-500">{formatBytes(a.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          )}
          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-2 text-sm">
                  <FileText aria-hidden="true" size={16} className="shrink-0 text-ink-500" />
                  <span className="min-w-0 flex-1 truncate text-ink-900">{f.name}</span>
                  <span className="shrink-0 text-ink-500">{formatBytes(f.size)}</span>
                  <button type="button" onClick={() => setFiles((cur) => cur.filter((_, n) => n !== i))} aria-label={`Remove ${f.name}`} className="inline-flex size-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-200">
                    <X aria-hidden="true" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {errors.files && <p role="alert" className="mt-2 text-sm text-danger">{errors.files}</p>}
        </fieldset>

        {general && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{general}</p>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Save aria-hidden="true" size={16} />}
            {entry ? "Save correction" : putIn ? "Save capital" : "Save return"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
