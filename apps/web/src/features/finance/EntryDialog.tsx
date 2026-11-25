import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Camera, FileText, Loader2, Paperclip, Plus, Save, Split, X } from "lucide-react";
import { correctFinEntry, createFinEntry, listFinParties, listFinPayees, submitFinExpense, type FinAccount, type FinCategory, type FinEntry, type FinEntryKind, type FinPayee } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Select, Textarea } from "../../ui";
import { formatMoney, todayInUae, parseMoneyInput } from "./financeFormat";
import { formatBytes, receiptProblem, RECEIPT_MAX_FILES, shrinkPhoto } from "./receiptFile";

type FieldName = "amount" | "entryDate" | "categoryId" | "accountId" | "party" | "reference" | "notes" | "files" | "payeeId" | "lines";
const FIELDS: FieldName[] = ["amount", "entryDate", "categoryId", "accountId", "party", "reference", "notes", "files", "payeeId", "lines"];

interface LineDraft {
  categoryId: string;
  amount: string;
  note: string;
}
const LAST_ACCOUNT = "hrpayroll.finance.lastAccount";
const lastCategoryKey = (kind: FinEntryKind) => `hrpayroll.finance.last${kind}Category`;

function remembered(key: string, valid: number[]): string {
  try {
    const saved = localStorage.getItem(key);
    return saved && valid.includes(Number(saved)) ? saved : "";
  } catch {
    return "";
  }
}

interface EntryDialogProps {
  kind: FinEntryKind;
  /** When set, the dialog corrects this entry: it is voided and the saved form replaces it. */
  entry?: FinEntry;
  accounts: FinAccount[];
  categories: FinCategory[];
  onClose: () => void;
  onSaved: (entry: FinEntry) => void;
  variant: "center" | "sheet";
  /** Staff entering an expense for approval: it is sent to the submit endpoint and the saved payees come from here. */
  submit?: { payees: FinPayee[] };
}

/** Record an expense (receipt required) or an income (attachment optional). The amount comes first and the last account and category are remembered. */
export function EntryDialog({ kind, entry, accounts, categories, onClose, onSaved, variant, submit: submitMode }: EntryDialogProps) {
  const income = kind === "Income";
  const LAST_CATEGORY = lastCategoryKey(kind);
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [date, setDate] = useState(entry?.entryDate ?? todayInUae());
  const [categoryId, setCategoryId] = useState(() => (entry ? String(entry.categoryId) : remembered(LAST_CATEGORY, categories.map((c) => c.id))));
  const [accountId, setAccountId] = useState(() => (entry ? String(entry.accountId) : "") || remembered(LAST_ACCOUNT, accounts.map((a) => a.id)) || (accounts.length === 1 ? String(accounts[0].id) : ""));
  const [party, setParty] = useState(entry?.party ?? "");
  const [payees, setPayees] = useState<FinPayee[]>(submitMode?.payees ?? []);
  const [payeeId, setPayeeId] = useState(entry?.payeeId ? String(entry.payeeId) : "");
  const [split, setSplit] = useState((entry?.lines?.length ?? 0) > 1);
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (entry?.lines?.length ?? 0) > 1 ? entry!.lines!.map((l) => ({ categoryId: String(l.categoryId), amount: String(l.amount), note: l.note ?? "" })) : [{ categoryId: "", amount: "", note: "" }, { categoryId: "", amount: "", note: "" }],
  );
  const [reference, setReference] = useState(entry?.reference ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [keep, setKeep] = useState<number[]>(() => entry?.attachments.map((a) => a.id) ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (submitMode) return;   // staff may not read the manager lists; their payees arrive with the form
    listFinParties(kind).then((list) => !cancelled && setSuggestions(list)).catch(() => {});
    listFinPayees(kind).then((list) => !cancelled && setPayees(list)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function pickPayee(value: string) {
    setPayeeId(value);
    const chosen = payees.find((p) => String(p.id) === value);
    if (!chosen) return;
    setParty(chosen.name);
    if (chosen.defaultCategoryId && !split && !categoryId && categories.some((c) => c.id === chosen.defaultCategoryId)) setCategoryId(String(chosen.defaultCategoryId));
  }

  function startSplit() {
    setLines([{ categoryId, amount, note: "" }, { categoryId: "", amount: "", note: "" }]);
    setSplit(true);
  }

  function setLine(index: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  /** What is still to be put on a line, in cents, so the lines can be seen to add up before saving. */
  const assignedCents = lines.reduce((sum, l) => sum + Math.round((parseMoneyInput(l.amount) ?? 0) * 100), 0);
  const totalCents = Math.round((parseMoneyInput(amount) ?? 0) * 100);
  const leftCents = totalCents - assignedCents;

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
      if (next.length > RECEIPT_MAX_FILES) {
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
    if (!split && !categoryId) next.categoryId = "Choose a category.";
    let lineInput: { categoryId: number; amount: number; note?: string }[] | undefined;
    if (split) {
      const parsed = lines.map((l) => ({ categoryId: Number(l.categoryId), amount: parseMoneyInput(l.amount), note: l.note.trim() }));
      if (parsed.some((l) => !l.categoryId || l.amount === null || l.amount <= 0)) next.lines = "Every line needs a category and an amount above zero.";
      else if (leftCents !== 0) next.lines = leftCents > 0 ? `AED ${formatMoney(leftCents / 100)} is still to be put on a line.` : `The lines are AED ${formatMoney(-leftCents / 100)} over the amount.`;
      else lineInput = parsed.map((l) => ({ categoryId: l.categoryId, amount: l.amount as number, note: l.note || undefined }));
    }
    if (!accountId) next.accountId = income ? "Choose the account the money went into." : "Choose the account it was paid from.";
    if (!party.trim()) next.party = income ? "Enter who it was received from." : "Enter who was paid.";
    if (!income && files.length + keep.length === 0) next.files = "Attach the receipt or supplier invoice.";
    setErrors(next);
    setGeneral(null);
    if (Object.keys(next).length > 0 || value === null) return;

    setPending(true);
    try {
      const primary = split && lineInput ? [...lineInput].sort((a, b) => b.amount - a.amount)[0].categoryId : Number(categoryId);
      const input = { entryDate: date, categoryId: primary, accountId: Number(accountId), party: party.trim(), amount: value, reference: reference.trim(), notes: notes.trim(), files, keepAttachmentIds: keep, payeeId: payeeId ? Number(payeeId) : null, lines: lineInput };
      const saved = submitMode ? await submitFinExpense(input) : entry ? await correctFinEntry(kind, entry.id, input) : await createFinEntry(kind, input);
      try {
        localStorage.setItem(LAST_ACCOUNT, accountId);
        if (!split) localStorage.setItem(LAST_CATEGORY, categoryId);
      } catch {
        // Not remembering is harmless.
      }
      onSaved(saved);
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
    <Dialog open title={entry ? (income ? "Correct income" : "Correct expense") : income ? "Add income" : "Add expense"} onClose={pending ? () => {} : onClose} initialFocusRef={amountRef} variant={variant} size="wide">
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        {entry && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{entry.entryNo} will be voided and kept, and what you save here replaces it with a new number.</p>}
        <div className="rounded-lg border border-line bg-ink-50 p-4">
          <TextField label="Amount (AED)" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} inputRef={amountRef} inputMode="decimal" autoComplete="off" placeholder="0.00" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {split ? (
            <div className="flex items-end">
              <p className="rounded-lg bg-brand-50 px-3 py-2.5 text-sm text-brand-800">Split between {lines.length} categories, below.</p>
            </div>
          ) : (
            <div>
              <Select label="Category" value={categoryId} error={errors.categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Choose a category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
              <button type="button" onClick={startSplit} className="mt-1.5 inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
                <Split aria-hidden="true" size={14} /> Split between categories
              </button>
            </div>
          )}
          <Select label={income ? "Received into" : "Paid from"} value={accountId} error={errors.accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose an account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            {payees.length > 0 && (
              <div className="mb-3">
                <Select label={income ? "Saved source (optional)" : "Saved payee (optional)"} value={payeeId} error={errors.payeeId} onChange={(e) => pickPayee(e.target.value)}>
                  <option value="">Type a name instead</option>
                  {payees.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>
            )}
            <TextField label={income ? "Received from" : "Paid to"} value={party} onChange={(e) => { setParty(e.target.value); setPayeeId(""); }} error={errors.party} maxLength={120} autoComplete="off" list={`fin-${kind}-parties`} />
            <datalist id={`fin-${kind}-parties`}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <TextField label="Date" type="date" value={date} max={todayInUae()} onChange={(e) => setDate(e.target.value)} error={errors.entryDate} />
        </div>
        {split && (
          <fieldset className="rounded-lg border border-line p-4" aria-describedby="split-help">
            <legend className="px-1 text-sm font-medium text-ink-800">Split between categories</legend>
            <p id="split-help" className="text-sm text-ink-600">Give each part its own category. The lines must add up to the amount.</p>
            <ul className="mt-3 space-y-3">
              {lines.map((l, i) => (
                <li key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] sm:items-end">
                  <Select label={`Line ${i + 1} category`} value={l.categoryId} onChange={(e) => setLine(i, { categoryId: e.target.value })}>
                    <option value="">Choose</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                  <TextField label={`Line ${i + 1} amount`} value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} inputMode="decimal" autoComplete="off" placeholder="0.00" />
                  <TextField label={`Line ${i + 1} note`} value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} maxLength={200} autoComplete="off" />
                  {lines.length > 2 && (
                    <button type="button" onClick={() => setLines((cur) => cur.filter((_, n) => n !== i))} aria-label={`Remove line ${i + 1}`} className="inline-flex size-11 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-200">
                      <X aria-hidden="true" size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setLines((cur) => [...cur, { categoryId: "", amount: "", note: "" }])} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
                <Plus aria-hidden="true" size={14} /> Add a line
              </button>
              <p aria-live="polite" className={leftCents === 0 && totalCents > 0 ? "text-sm font-medium text-brand-700" : "text-sm text-ink-700"}>
                {leftCents === 0 && totalCents > 0 ? "The lines add up." : leftCents > 0 ? `AED ${formatMoney(leftCents / 100)} still to assign` : `AED ${formatMoney(-leftCents / 100)} over`}
              </p>
            </div>
            {errors.lines && <p role="alert" className="mt-2 text-sm text-danger">{errors.lines}</p>}
            <button type="button" onClick={() => { setSplit(false); setErrors((e) => ({ ...e, lines: undefined })); }} className="mt-2 text-sm font-medium text-ink-600 hover:underline">Use one category instead</button>
          </fieldset>
        )}
        <TextField label={income ? "Reference (optional)" : "Invoice, cheque or receipt no. (optional)"} value={reference} onChange={(e) => setReference(e.target.value)} error={errors.reference} maxLength={60} autoComplete="off" />
        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} error={errors.notes} rows={2} maxLength={2000} />

        <fieldset className="rounded-lg border border-dashed border-ink-300 p-4" aria-describedby="receipt-help">
          <legend className="px-1 text-sm font-medium text-ink-800">{income ? "Attachment (optional)" : "Receipt or supplier invoice"}</legend>
          <p id="receipt-help" className="text-sm text-ink-600">{income ? "Optional, for example a remittance advice or the cheque. A photo" : `Required. A photo, a PDF or a PNG, up to 5 MB each, at most ${RECEIPT_MAX_FILES} files.`}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50 focus-within:outline-2 focus-within:outline-brand-500 md:min-h-10">
              <Camera aria-hidden="true" size={16} /> Take photo
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void addFiles(e)} />
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50 focus-within:outline-2 focus-within:outline-brand-500 md:min-h-10">
              <Paperclip aria-hidden="true" size={16} /> Choose file
              <input type="file" accept="application/pdf,image/jpeg,image/png" multiple className="sr-only" onChange={(e) => void addFiles(e)} />
            </label>
          </div>
          {entry && entry.attachments.length > 0 && (
            <ul className="mt-3 space-y-2" aria-label="Receipts already on this entry">
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
            {entry ? "Save correction" : income ? "Save income" : submitMode ? "Submit for approval" : "Save expense"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
