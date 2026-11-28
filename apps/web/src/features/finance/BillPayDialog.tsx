import { useRef, useState, type FormEvent } from "react";
import { Loader2, Wallet } from "lucide-react";
import { payFinBill, type FinAccount, type FinBill } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Select } from "../../ui";
import { formatMoney, parseMoneyInput, todayInUae } from "./financeFormat";

/** Pay all or part of a supplier bill from a bank or cash account. This adds an expense to that account that clears the debt; it is not a second cost. */
export function BillPayDialog({ bill, accounts, variant, onClose, onPaid }: { bill: FinBill; accounts: FinAccount[]; variant: "center" | "sheet"; onClose: () => void; onPaid: (bill: FinBill) => void }) {
  const active = accounts.filter((a) => a.isActive);
  const [amount, setAmount] = useState(String(bill.balance));
  const [date, setDate] = useState(todayInUae());
  const [accountId, setAccountId] = useState(active.length === 1 ? String(active[0].id) : "");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = parseMoneyInput(amount);
    const found: Record<string, string> = {};
    if (value === null || value <= 0) found.amount = "Enter an amount above zero with at most 2 decimals.";
    else if (value > bill.balance) found.amount = `The payment is more than the balance owed (${formatMoney(bill.balance)}).`;
    if (!date) found.date = "Enter the payment date.";
    if (!accountId) found.accountId = "Choose the account the money is paid from.";
    setErrors(found);
    setGeneral(null);
    if (Object.keys(found).length > 0 || value === null) return;
    setPending(true);
    try {
      onPaid(await payFinBill(bill.id, { date, amount: value, accountId: Number(accountId), reference: reference.trim() }));
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
    <Dialog open title={`Pay ${bill.billNo}`} onClose={pending ? () => {} : onClose} initialFocusRef={first} variant={variant}>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <p className="text-sm text-ink-700">{bill.supplierName}. Balance owed AED {formatMoney(bill.balance)}.</p>
        <TextField label="Amount (AED)" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} inputMode="decimal" inputRef={first} autoComplete="off" />
        <TextField label="Payment date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} max={todayInUae()} />
        <Select label="Paid from" value={accountId} onChange={(e) => setAccountId(e.target.value)} error={errors.accountId} hint="The money leaves this account.">
          <option value="">Choose an account</option>
          {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} error={errors.reference} maxLength={60} autoComplete="off" />
        {general && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{general}</p>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Wallet aria-hidden="true" size={16} />}Save payment</Button>
        </div>
      </form>
    </Dialog>
  );
}
