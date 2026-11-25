import { useRef, useState, type FormEvent } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { createFinBill, type FinBill, type FinCategory, type FinPayee, type FinTaxType } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Select, Textarea } from "../../ui";
import { formatMoney, parseMoneyInput, todayInUae, vatOf } from "./financeFormat";

interface Line { category: string; amount: string; note: string }

function plusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A bill from a supplier, entered when it arrives: the cost is booked now and the supplier is owed until it is paid. Line amounts are before VAT. */
export function BillDialog({ categories, payees, taxTypes, variant, onClose, onSaved }: {
  categories: FinCategory[]; payees: FinPayee[]; taxTypes: FinTaxType[]; variant: "center" | "sheet"; onClose: () => void; onSaved: (bill: FinBill) => void;
}) {
  const expense = categories.filter((c) => c.kind === "Expense" && c.isActive);
  const [payeeId, setPayeeId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [billDate, setBillDate] = useState(todayInUae());
  const [dueDate, setDueDate] = useState(plusDays(todayInUae(), 30));
  const [taxTypeId, setTaxTypeId] = useState(taxTypes.find((t) => t.treatment === "Standard")?.id.toString() ?? "");
  const [lines, setLines] = useState<Line[]>([{ category: "", amount: "", note: "" }]);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  const net = lines.reduce((sum, l) => sum + (parseMoneyInput(l.amount) ?? 0), 0);
  const tax = taxTypes.find((t) => String(t.id) === taxTypeId);
  const vat = tax && net > 0 ? vatOf(net, tax.treatment, tax.rate, false) : null;

  function setLine(i: number, patch: Partial<Line>) {
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!supplier.trim()) found.supplierName = "Enter the supplier.";
    if (!billDate) found.billDate = "Enter the bill date.";
    if (!dueDate) found.dueDate = "Enter the due date.";
    else if (billDate && dueDate < billDate) found.dueDate = "The due date cannot be before the bill date.";
    if (lines.some((l) => !l.category || (parseMoneyInput(l.amount) ?? 0) <= 0)) found.lines = "Every line needs a category and an amount above zero.";
    setErrors(found);
    setGeneral(null);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try {
      onSaved(await createFinBill({
        supplierName: supplier.trim(), payeeId: payeeId ? Number(payeeId) : null, supplierRef: supplierRef.trim(), billDate, dueDate, notes: notes.trim(),
        taxTypeId: taxTypeId ? Number(taxTypeId) : null, lines: lines.map((l) => ({ categoryId: Number(l.category), amount: parseMoneyInput(l.amount)!, note: l.note.trim() })),
      }));
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) {
        const mapped: Record<string, string> = {};
        for (const [key, messages] of Object.entries(error.fieldErrors)) mapped[key] = messages.join(" ");
        setErrors(mapped);
      } else {
        setGeneral(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open title="Enter a supplier bill" onClose={pending ? () => {} : onClose} initialFocusRef={first} variant={variant} size="wide">
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <Select label="Supplier from your list (optional)" value={payeeId} onChange={(e) => { setPayeeId(e.target.value); const p = payees.find((x) => String(x.id) === e.target.value); if (p) { setSupplier(p.name); if (p.defaultCategoryId && lines.length === 1 && !lines[0].category) setLine(0, { category: String(p.defaultCategoryId) }); } }}>
          <option value="">Not in the list</option>
          {payees.filter((p) => p.kind === "Expense").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} error={errors.supplierName} inputRef={first} maxLength={120} autoComplete="off" />
          <TextField label="Supplier's invoice number (optional)" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} error={errors.supplierRef} maxLength={60} autoComplete="off" />
          <TextField label="Bill date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} error={errors.billDate} max={todayInUae()} />
          <TextField label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={errors.dueDate} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-800">What the bill is for (amounts before VAT)</legend>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-end gap-2">
              <Select label={`Category ${i + 1}`} hideLabel value={l.category} onChange={(e) => setLine(i, { category: e.target.value })}>
                <option value="">Category</option>
                {expense.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <TextField label={`Amount ${i + 1}`} hideLabel value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} inputMode="decimal" placeholder="0.00" autoComplete="off" />
              {lines.length > 1 ? <Button variant="secondary" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}><Trash2 aria-hidden="true" size={16} /></Button> : <span />}
            </div>
          ))}
          {errors.lines && <p role="alert" className="text-sm text-danger">{errors.lines}</p>}
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setLines((cur) => [...cur, { category: "", amount: "", note: "" }])}>Add a line</Button>
        </fieldset>
        {taxTypes.length > 0 && (
          <Select label="VAT" value={taxTypeId} onChange={(e) => setTaxTypeId(e.target.value)} error={errors.taxTypeId}
            hint={vat ? (tax?.treatment === "ReverseCharge" ? `Reverse charge: the supplier is owed AED ${formatMoney(vat.cash)}; VAT of AED ${formatMoney(vat.tax)} is recorded as both payable and recoverable.` : `VAT AED ${formatMoney(vat.tax)}. The supplier is owed AED ${formatMoney(vat.cash)}.`) : undefined}>
            <option value="">No VAT recorded</option>
            {taxTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        )}
        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
        {general && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{general}</p>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Save aria-hidden="true" size={16} />}Enter bill</Button>
        </div>
      </form>
    </Dialog>
  );
}
