import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileText, Paperclip, Plus, Wallet, X } from "lucide-react";
import {
  getFinBillFile, listFinAccounts, listFinBills, listFinCategories, listFinPayees, listFinTaxTypes, removeFinBillFile, removeFinBillPayment, uploadFinBillFiles, voidFinBill,
  type FinAccount, type FinBill, type FinBillDisplay, type FinBillFilter, type FinCategory, type FinPayee, type FinTaxType,
} from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { useUrlSearch } from "../../utils/useUrlSearch";
import { Button, Card, EmptyState, LoadingState, PageHeader, Select, StatusBadge, cx, type StatusTone } from "../../ui";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { BillDialog } from "./BillDialog";
import { BillPayDialog } from "./BillPayDialog";
import { ReceiptDialog } from "./ReceiptDialog";
import { formatDay, formatMoney, todayInUae } from "./financeFormat";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; bills: FinBill[]; accounts: FinAccount[]; categories: FinCategory[]; payees: FinPayee[]; taxTypes: FinTaxType[] };
type Reasoning = { title: string; label: string; confirm: string; run: (reason: string) => Promise<FinBill>; done: string };

const TONES: Record<FinBillDisplay, StatusTone> = { Open: "info", PartPaid: "warning", Paid: "success", Overdue: "danger", Voided: "neutral" };
const WORDS: Record<FinBillDisplay, string> = { Open: "Unpaid", PartPaid: "Part paid", Paid: "Paid", Overdue: "Overdue", Voided: "Voided" };

function failure(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function ReasonDialog({ ask, variant, onClose, onDone }: { ask: Reasoning; variant: "center" | "sheet"; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) return setError("Enter the reason. It is kept with the record.");
    setPending(true);
    setError(null);
    try {
      await ask.run(reason.trim());
      onDone(ask.done);
    } catch (e) {
      setError(failure(e));
      setPending(false);
    }
  }
  return (
    <Dialog open title={ask.title} onClose={pending ? () => {} : onClose} variant={variant}>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <TextField label={ask.label} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoComplete="off" />
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>{ask.confirm}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function BillRow({ bill, canEdit, onPay, onVoid, onTakeBack, onOpenFile, onAddFiles, onRemoveFile }: { bill: FinBill; canEdit: boolean; onPay: () => void; onVoid: () => void; onTakeBack: (entryId: number, entryNo: string) => void; onOpenFile: (index: number) => void; onAddFiles: (files: File[]) => void; onRemoveFile: (fileId: number, name: string) => void }) {
  const voided = bill.status === "Voided";
  return (
    <li className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="break-words text-[15px] font-semibold text-ink-900">{bill.supplierName}</p>
          <p className="text-[13px] text-ink-500">
            <span className="font-mono">{bill.billNo}</span>{bill.supplierRef && <> · their no. {bill.supplierRef}</>} · {formatDay(bill.billDate)}
          </p>
          <p className="text-[13px] text-ink-600">{bill.lines.map((l) => l.category).join(", ")}{bill.taxAmount > 0 && <> · VAT {formatMoney(bill.taxAmount)} · {bill.recoverableTaxPercent ?? 100}% recoverable</>}</p>
        </div>
        <p className="text-right">
          <span className="mr-1 text-xs font-medium text-ink-500">AED</span>
          <span className={cx("font-display text-xl font-bold tabular-nums", voided ? "text-ink-500 line-through" : "text-ink-900")}>{formatMoney(bill.total)}</span>
          {!voided && bill.paid > 0 && <span className="block text-[13px] text-ink-600">{formatMoney(bill.balance)} still owed</span>}
        </p>
        <div className="flex flex-wrap items-center gap-2 sm:w-52">
          <StatusBadge tone={TONES[bill.display]} variant="soft">{WORDS[bill.display]}</StatusBadge>
          {!voided && bill.balance > 0 && <span className={cx("text-[13px] tabular-nums", bill.display === "Overdue" ? "font-semibold text-danger" : "text-ink-700")}>{bill.display === "Overdue" ? "Overdue since " : "Due "}{formatDay(bill.dueDate)}</span>}
        </div>
      </div>
      {voided && bill.voidReason && <p className="text-[13px] text-ink-600">Voided: {bill.voidReason}</p>}
      {bill.payments.length > 0 && (
        <ul className="space-y-1 text-[13px] text-ink-700">
          {bill.payments.map((p) => (
            <li key={p.entryId} className="flex flex-wrap items-center gap-x-3">
              <span className="tabular-nums">{formatDay(p.date)}</span><span>AED {formatMoney(p.amount)} from {p.account}</span><span className="font-mono text-[13px] text-ink-500">{p.entryNo}</span>
              {canEdit && !voided && <Button size="sm" variant="ghost" className="text-red-700" onClick={() => onTakeBack(p.entryId, p.entryNo)} aria-label={`Take back payment ${p.entryNo}`}>Take back</Button>}
            </li>
          ))}
        </ul>
      )}
      {(bill.files?.length ?? 0) > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`Supplier invoice for ${bill.billNo}`}>
          {bill.files!.map((f, i) => (
            <li key={f.id} className="flex items-center rounded-full bg-ink-50 text-[13px] text-ink-800">
              <button type="button" onClick={() => onOpenFile(i)} className="inline-flex min-h-9 max-w-56 items-center gap-1.5 rounded-full px-3 hover:bg-ink-100" aria-label={`View ${f.fileName}`}>
                <FileText aria-hidden="true" size={14} className="shrink-0" /><span className="truncate">{f.fileName}</span>
              </button>
              {canEdit && !voided && <button type="button" onClick={() => onRemoveFile(f.id, f.fileName)} aria-label={`Remove ${f.fileName}`} className="mr-1 inline-flex size-7 items-center justify-center rounded-full text-ink-600 hover:bg-ink-200"><X aria-hidden="true" size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !voided && (
        <div className="flex flex-wrap gap-1">
          {(bill.files?.length ?? 0) < 5 && (
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-700 hover:bg-ink-50 focus-within:outline-2 focus-within:outline-brand-500">
              <Paperclip aria-hidden="true" size={14} /> Attach invoice
              <input type="file" accept="application/pdf,image/jpeg,image/png" multiple className="sr-only" aria-label={`Attach the supplier's invoice to ${bill.billNo}`} onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ""; if (picked.length > 0) onAddFiles(picked); }} />
            </label>
          )}
          {bill.balance > 0 && <Button size="sm" variant="ghost" icon={Wallet} className="text-brand-700" onClick={onPay} aria-label={`Pay ${bill.billNo}`}>Pay</Button>}
          {bill.paid === 0 && <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" onClick={onVoid} aria-label={`Void ${bill.billNo}`}>Void</Button>}
        </div>
      )}
    </li>
  );
}

/** Bills from suppliers. Entering one books the cost and the VAT now and records that the supplier is owed; paying it moves the money out of a bank or cash account. */
export function BillsPage() {
  const { user } = useAuth();
  const canEdit = isManagement(user?.role);
  const desktop = useIsDesktop();
  const variant = desktop ? "center" : "sheet";
  const [filter, setFilter] = useState<FinBillFilter>("unpaid");
  const [search, setSearch] = useState("");
  useUrlSearch((q) => { setSearch(q); setFilter("all"); });   // a bill picked in the top bar, paid or not
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [entering, setEntering] = useState(false);
  const [paying, setPaying] = useState<FinBill | null>(null);
  const [asking, setAsking] = useState<Reasoning | null>(null);
  const [viewing, setViewing] = useState<{ bill: FinBill; index: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [bills, accounts, categories, payees, taxTypes] = await Promise.all([
        listFinBills(filter, search),
        canEdit ? listFinAccounts() : Promise.resolve([] as FinAccount[]),
        canEdit ? listFinCategories(false) : Promise.resolve([] as FinCategory[]),
        canEdit ? listFinPayees("Expense") : Promise.resolve([] as FinPayee[]),
        canEdit ? listFinTaxTypes() : Promise.resolve([] as FinTaxType[]),
      ]);
      setLoad({ status: "ready", bills, accounts, categories, payees, taxTypes });
    } catch (error) {
      setLoad({ status: "error", message: failure(error) });
    }
  }, [canEdit, filter, search]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [refresh, search]);

  const ready = load.status === "ready" ? load : null;
  const open = (ready?.bills ?? []).filter((b) => b.status === "Open");
  const sum = (list: FinBill[]) => list.reduce((total, b) => total + b.balance, 0);
  const today = todayInUae();
  const inSevenDays = new Date(`${today}T00:00:00Z`);
  inSevenDays.setUTCDate(inSevenDays.getUTCDate() + 7);
  const owed = sum(open);
  const overdue = sum(open.filter((b) => b.dueDate < today));
  const soon = sum(open.filter((b) => b.dueDate >= today && b.dueDate <= inSevenDays.toISOString().slice(0, 10)));
  // Bills are paid in the order they fall due, so that is how the unpaid list reads. Other lists keep the newest first.
  const shown = filter === "unpaid" || filter === "overdue" ? [...(ready?.bills ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate)) : (ready?.bills ?? []);
  async function changeFiles(run: () => Promise<FinBill>, done: string) {
    setProblem(null);
    setMessage(null);
    try {
      await run();
      setMessage(done);
      await refresh();
    } catch (error) {
      setProblem(failure(error));
    }
  }
  const finish = (text: string) => { setAsking(null); setPaying(null); setProblem(null); setMessage(text); void refresh(); };

  return (
    <section className="space-y-5">
      <PageHeader
        title="Bills"
        description="Bills from suppliers. Entering a bill books the cost and any VAT now and records that the supplier is owed. Paying it moves the money out of a bank or cash account."
        actions={canEdit && ready && <Button icon={Plus} onClick={() => setEntering(true)}>Enter bill</Button>}
      />
      <SuccessRegion message={message} />
      {problem && <ActionFailure message={problem} />}
      {load.status === "loading" && <LoadingState label="Loading bills..." withCards />}
      {load.status === "error" && <LoadError message={load.message} onRetry={() => { setLoad({ status: "loading" }); void refresh(); }} />}
      {ready && (
        <Card>
          <div className="flex flex-wrap items-end gap-4 px-5 py-4">
            <div className="min-w-44">
              <Select label="Show" value={filter} onChange={(e) => setFilter(e.target.value as FinBillFilter)}>
                <option value="unpaid">Not fully paid</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="voided">Voided</option><option value="all">Everything</option>
              </Select>
            </div>
            <div className="min-w-56 flex-1"><TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Supplier or number" autoComplete="off" /></div>
          </div>
          {filter === "unpaid" && ready.bills.length > 0 && (
            <dl className="grid grid-cols-1 gap-3 border-t border-line bg-ink-50 px-5 py-3 text-sm sm:grid-cols-3">
              <div><dt className="text-ink-600">Owed on these bills</dt><dd className="font-display text-lg font-bold tabular-nums text-ink-900">AED {formatMoney(owed)}</dd></div>
              <div><dt className="text-ink-600">Overdue</dt><dd className={cx("font-display text-lg font-bold tabular-nums", overdue > 0 ? "text-danger" : "text-ink-400")}>AED {formatMoney(overdue)}</dd></div>
              <div><dt className="text-ink-600">Due in the next 7 days</dt><dd className={cx("font-display text-lg font-bold tabular-nums", soon > 0 ? "text-ink-900" : "text-ink-400")}>AED {formatMoney(soon)}</dd></div>
            </dl>
          )}
          {ready.bills.length === 0 ? (
            <EmptyState icon={FileText} title={filter === "unpaid" ? "No unpaid bills" : "No bills here"} description={canEdit ? "Enter a bill when a supplier sends one, even before you pay it." : "A Manager enters the bills. They will appear here."}
              action={canEdit ? <Button icon={Plus} onClick={() => setEntering(true)}>Enter a bill</Button> : undefined} />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {shown.map((b) => (
                <BillRow key={b.id} bill={b} canEdit={canEdit} onPay={() => setPaying(b)}
                  onOpenFile={(index) => setViewing({ bill: b, index })}
                  onAddFiles={(picked) => void changeFiles(() => uploadFinBillFiles(b.id, picked), `The supplier's invoice was attached to ${b.billNo}.`)}
                  onRemoveFile={(fileId, name) => void changeFiles(() => removeFinBillFile(b.id, fileId), `${name} was removed from ${b.billNo}.`)}
                  onVoid={() => setAsking({ title: `Void ${b.billNo}`, label: "Reason for voiding", confirm: "Void bill", run: (r) => voidFinBill(b.id, r), done: `${b.billNo} was voided.` })}
                  onTakeBack={(entryId, entryNo) => setAsking({ title: `Take back ${entryNo}`, label: "Reason for taking the payment back", confirm: "Take payment back", run: (r) => removeFinBillPayment(b.id, entryId, r), done: `The payment was taken back. ${b.billNo} is owed again.` })} />
              ))}
            </ul>
          )}
        </Card>
      )}
      {ready && entering && <BillDialog categories={ready.categories} payees={ready.payees} taxTypes={ready.taxTypes} variant={variant} onClose={() => setEntering(false)} onSaved={(b, note) => { setEntering(false); finish(`${b.billNo} was entered. It is owed until you pay it.`); if (note) setProblem(note); }} />}
      {ready && paying && <BillPayDialog bill={paying} accounts={ready.accounts} variant={variant} onClose={() => setPaying(null)} onPaid={(b) => finish(`Payment saved. ${b.billNo} ${b.balance === 0 ? "is fully paid" : `still owes AED ${formatMoney(b.balance)}`}.`)} />}
      {viewing && viewing.bill.files && <ReceiptDialog title={`Supplier invoice, ${viewing.bill.billNo}`} files={viewing.bill.files} startIndex={viewing.index} variant={variant} onClose={() => setViewing(null)} fetchFile={getFinBillFile} />}
      {asking && <ReasonDialog ask={asking} variant={variant} onClose={() => setAsking(null)} onDone={finish} />}
    </section>
  );
}
