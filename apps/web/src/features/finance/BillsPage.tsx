import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileText, Plus, Wallet } from "lucide-react";
import {
  listFinAccounts, listFinBills, listFinCategories, listFinPayees, listFinTaxTypes, removeFinBillPayment, voidFinBill,
  type FinAccount, type FinBill, type FinBillDisplay, type FinBillFilter, type FinCategory, type FinPayee, type FinTaxType,
} from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { useAuth } from "../../contexts/AuthContext";
import { isManagement } from "../../permissions";
import { useIsDesktop } from "../../utils/useIsDesktop";
import { Button, Card, EmptyState, LoadingState, PageHeader, Select, StatusBadge, cx, type StatusTone } from "../../ui";
import { ActionFailure, LoadError, SuccessRegion } from "../workers/WorkersFeedback";
import { BillDialog } from "./BillDialog";
import { BillPayDialog } from "./BillPayDialog";
import { formatDay, formatMoney } from "./financeFormat";

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

function BillRow({ bill, canEdit, onPay, onVoid, onTakeBack }: { bill: FinBill; canEdit: boolean; onPay: () => void; onVoid: () => void; onTakeBack: (entryId: number, entryNo: string) => void }) {
  const voided = bill.status === "Voided";
  return (
    <li className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="break-words text-[15px] font-semibold text-ink-900">{bill.supplierName}</p>
          <p className="text-xs text-ink-500">
            <span className="font-mono">{bill.billNo}</span>{bill.supplierRef && <> · their no. {bill.supplierRef}</>} · {formatDay(bill.billDate)}
          </p>
          <p className="text-[13px] text-ink-600">{bill.lines.map((l) => l.category).join(", ")}{bill.taxAmount > 0 && <> · VAT {formatMoney(bill.taxAmount)}</>}</p>
        </div>
        <p className="text-right">
          <span className="mr-1 text-xs font-medium text-ink-500">AED</span>
          <span className={cx("font-display text-xl font-bold tabular-nums", voided ? "text-ink-500 line-through" : "text-ink-900")}>{formatMoney(bill.total)}</span>
          {!voided && bill.paid > 0 && <span className="block text-xs text-ink-600">{formatMoney(bill.balance)} still owed</span>}
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
              <span className="tabular-nums">{formatDay(p.date)}</span><span>AED {formatMoney(p.amount)} from {p.account}</span><span className="font-mono text-xs text-ink-500">{p.entryNo}</span>
              {canEdit && !voided && <Button size="sm" variant="ghost" className="text-red-700" onClick={() => onTakeBack(p.entryId, p.entryNo)} aria-label={`Take back payment ${p.entryNo}`}>Take back</Button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !voided && (
        <div className="flex flex-wrap gap-1">
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
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [entering, setEntering] = useState(false);
  const [paying, setPaying] = useState<FinBill | null>(null);
  const [asking, setAsking] = useState<Reasoning | null>(null);
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
  const owed = (ready?.bills ?? []).filter((b) => b.status === "Open").reduce((sum, b) => sum + b.balance, 0);
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
            {filter === "unpaid" && <p className="pb-2 text-sm text-ink-700">Owed on these bills: <span className="font-semibold tabular-nums">AED {formatMoney(owed)}</span></p>}
          </div>
          {ready.bills.length === 0 ? (
            <EmptyState icon={FileText} title={filter === "unpaid" ? "No unpaid bills" : "No bills here"} description={canEdit ? "Enter a bill when a supplier sends one, even before you pay it." : "A Manager enters the bills. They will appear here."}
              action={canEdit ? <Button icon={Plus} onClick={() => setEntering(true)}>Enter a bill</Button> : undefined} />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {ready.bills.map((b) => (
                <BillRow key={b.id} bill={b} canEdit={canEdit} onPay={() => setPaying(b)}
                  onVoid={() => setAsking({ title: `Void ${b.billNo}`, label: "Reason for voiding", confirm: "Void bill", run: (r) => voidFinBill(b.id, r), done: `${b.billNo} was voided.` })}
                  onTakeBack={(entryId, entryNo) => setAsking({ title: `Take back ${entryNo}`, label: "Reason for taking the payment back", confirm: "Take payment back", run: (r) => removeFinBillPayment(b.id, entryId, r), done: `The payment was taken back. ${b.billNo} is owed again.` })} />
              ))}
            </ul>
          )}
        </Card>
      )}
      {ready && entering && <BillDialog categories={ready.categories} payees={ready.payees} taxTypes={ready.taxTypes} variant={variant} onClose={() => setEntering(false)} onSaved={(b) => { setEntering(false); finish(`${b.billNo} was entered. It is owed until you pay it.`); }} />}
      {ready && paying && <BillPayDialog bill={paying} accounts={ready.accounts} variant={variant} onClose={() => setPaying(null)} onPaid={(b) => finish(`Payment saved. ${b.billNo} ${b.balance === 0 ? "is fully paid" : `still owes AED ${formatMoney(b.balance)}`}.`)} />}
      {asking && <ReasonDialog ask={asking} variant={variant} onClose={() => setAsking(null)} onDone={finish} />}
    </section>
  );
}
