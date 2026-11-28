import { useRef, useState, type FormEvent } from "react";
import { Loader2, Plus, Save, X } from "lucide-react";
import { createRecurringJournal, postManualJournal, type LedgerAccount } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Select } from "../../ui";
import { formatMoney, parseMoneyInput, todayInUae } from "./financeFormat";

interface Row {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}
const blank = (): Row => ({ accountId: "", debit: "", credit: "", memo: "" });

/**
 * A journal posted by hand: lines of debits and credits that must balance. It is kept, and undone only by a reversal.
 * In recurring mode the same lines are saved as a template that posts every month (a day of the month, a first month and an optional last month) instead of one dated journal.
 */
export function ManualJournalDialog({ accounts, variant, onClose, onPosted, recurring = false }: { accounts: LedgerAccount[]; variant: "center" | "sheet"; onClose: () => void; onPosted: (label: string) => void; recurring?: boolean }) {
  const [date, setDate] = useState(todayInUae());
  const [day, setDay] = useState("1");
  const [startMonth, setStartMonth] = useState(todayInUae().slice(0, 7));
  const [endMonth, setEndMonth] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([blank(), blank()]);
  const [errors, setErrors] = useState<{ date?: string; description?: string; lines?: string; dayOfMonth?: string; startMonth?: string; endMonth?: string }>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const usable = accounts.filter((a) => a.isActive);

  const cents = (text: string) => Math.round((parseMoneyInput(text) ?? 0) * 100);
  const debit = rows.reduce((sum, r) => sum + cents(r.debit), 0);
  const credit = rows.reduce((sum, r) => sum + cents(r.credit), 0);
  const balanced = debit === credit && debit > 0;
  const set = (i: number, patch: Partial<Row>) => setRows((cur) => cur.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!description.trim()) next.description = "Enter what this journal is for.";
    if (!recurring && !date) next.date = "Enter the date.";
    if (recurring && !startMonth) next.startMonth = "Choose the first month.";
    if (recurring && endMonth && endMonth < startMonth) next.endMonth = "The last month cannot be before the first.";
    const parsed = rows.map((r) => ({ accountId: Number(r.accountId), debit: r.debit.trim() ? parseMoneyInput(r.debit) : null, credit: r.credit.trim() ? parseMoneyInput(r.credit) : null, memo: r.memo.trim() }));
    if (parsed.some((r) => !r.accountId || (r.debit === null) === (r.credit === null) || (r.debit ?? r.credit ?? 0) <= 0)) next.lines = "Every line needs an account and either a debit or a credit above zero.";
    else if (!balanced) next.lines = `Debits are ${formatMoney(debit / 100)} and credits are ${formatMoney(credit / 100)}. They must be equal.`;
    setErrors(next);
    setGeneral(null);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    try {
      const lines = parsed.map((r) => ({ accountId: r.accountId, debit: r.debit ?? undefined, credit: r.credit ?? undefined, memo: r.memo || undefined }));
      if (recurring) {
        const saved = await createRecurringJournal({ description: description.trim(), dayOfMonth: Number(day), startMonth, endMonth: endMonth || undefined, lines });
        onPosted(saved.description);
      } else {
        onPosted((await postManualJournal({ date, description: description.trim(), lines })).number);
      }
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) {
        setErrors({ date: error.fieldErrors.date?.join(" "), description: error.fieldErrors.description?.join(" "), lines: error.fieldErrors.lines?.join(" "), dayOfMonth: error.fieldErrors.dayOfMonth?.join(" "), startMonth: error.fieldErrors.startMonth?.join(" "), endMonth: error.fieldErrors.endMonth?.join(" ") });
      } else {
        setGeneral(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open title={recurring ? "Set up a monthly journal" : "Post a journal"} onClose={pending ? () => {} : onClose} initialFocusRef={first} variant={variant} size="wide">
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        {recurring ? (
          <>
            <TextField label="What it is for" value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} maxLength={200} autoComplete="off" inputRef={first} hint="For example: Spread annual insurance. The month is added to the description each time it posts." />
            <div className="grid gap-4 sm:grid-cols-3">
              <Select label="Day of the month" value={day} onChange={(e) => setDay(e.target.value)} error={errors.dayOfMonth} hint="A shorter month uses its last day.">
                {Array.from({ length: 31 }, (_, n) => n + 1).map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
              <TextField label="First month" type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} error={errors.startMonth} />
              <TextField label="Last month (optional)" type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} error={errors.endMonth} hint="Leave empty to repeat until you stop it." />
            </div>
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <TextField label="Date" type="date" value={date} max={todayInUae()} onChange={(e) => setDate(e.target.value)} error={errors.date} inputRef={first} />
            <TextField label="What it is for" value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} maxLength={280} autoComplete="off" />
          </div>
        )}
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-end">
              <div className="col-span-2 sm:col-span-1">
                <Select label={`Line ${i + 1} account`} value={r.accountId} onChange={(e) => set(i, { accountId: e.target.value })}>
                  <option value="">Choose</option>
                  {usable.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </Select>
              </div>
              <TextField label={`Line ${i + 1} debit`} value={r.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : r.credit })} inputMode="decimal" autoComplete="off" placeholder="0.00" />
              <TextField label={`Line ${i + 1} credit`} value={r.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : r.debit })} inputMode="decimal" autoComplete="off" placeholder="0.00" />
              <div className="col-span-2 sm:col-span-1"><TextField label={`Line ${i + 1} note`} value={r.memo} onChange={(e) => set(i, { memo: e.target.value })} maxLength={200} autoComplete="off" /></div>
              {rows.length > 2 && (
                <button type="button" onClick={() => setRows((cur) => cur.filter((_, n) => n !== i))} aria-label={`Remove line ${i + 1}`} className="inline-flex size-11 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-200">
                  <X aria-hidden="true" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setRows((cur) => [...cur, blank()])} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
            <Plus aria-hidden="true" size={14} /> Add a line
          </button>
          <p aria-live="polite" className={balanced ? "text-sm font-medium text-brand-700" : "text-sm text-ink-700"}>
            Debits {formatMoney(debit / 100)} · Credits {formatMoney(credit / 100)} · {balanced ? "Balanced" : debit === credit ? "Nothing entered" : `Difference ${formatMoney(Math.abs(debit - credit) / 100)}`}
          </p>
        </div>
        {errors.lines && <p role="alert" className="text-sm text-danger">{errors.lines}</p>}
        {general && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{general}</p>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Save aria-hidden="true" size={16} />}
            {recurring ? "Save monthly journal" : "Post journal"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
