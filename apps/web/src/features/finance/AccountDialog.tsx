import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Save } from "lucide-react";
import { createFinAccount, listFinSubmitters, updateFinAccount, type FinAccount, type FinAccountKind, type FinSubmitter } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Select } from "../../ui";
import { parseMoneyInput, todayInUae } from "./financeFormat";

type FieldName = "name" | "kind" | "bankName" | "accountNumber" | "iban" | "openingBalance" | "openingDate" | "holderUserId";

interface AccountDialogProps {
  /** The account being edited, or null to add one. */
  account: FinAccount | null;
  /** The type a new account starts as. */
  defaultKind?: FinAccountKind;
  onClose: () => void;
  onSaved: (account: FinAccount, message: string) => void;
  variant: "center" | "sheet";
}

/** Add or edit a bank or cash account. The server is the judge: its field messages are shown under the fields. */
export function AccountDialog({ account, defaultKind, onClose, onSaved, variant }: AccountDialogProps) {
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<FinAccountKind>(account?.kind ?? defaultKind ?? "Bank");
  const [bankName, setBankName] = useState(account?.bankName ?? "");
  const [accountNumber, setAccountNumber] = useState(account?.accountNumber ?? "");
  const [iban, setIban] = useState(account?.iban ?? "");
  const [openingBalance, setOpeningBalance] = useState(account ? String(account.openingBalance) : "");
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? todayInUae());
  const [staffCanUse, setStaffCanUse] = useState(account?.staffCanUse ?? false);
  const [holder, setHolder] = useState(account?.holderUserId ? String(account.holderUserId) : "");
  const [staff, setStaff] = useState<FinSubmitter[]>([]);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (kind !== "Custody" || staff.length > 0) return;
    let cancelled = false;
    Promise.resolve(listFinSubmitters())
      .then((list) => !cancelled && setStaff(list ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kind, staff.length]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Partial<Record<FieldName, string>> = {};
    if (!name.trim()) next.name = "Enter the account name.";
    const balance = parseMoneyInput(openingBalance);
    if (balance === null) next.openingBalance = "Enter the opening balance as a number, for example 1500.00 (0 if none).";
    if (!openingDate) next.openingDate = "Enter the date the opening balance holds.";
    setErrors(next);
    setGeneral(null);
    if (Object.keys(next).length > 0 || balance === null) return;

    setPending(true);
    try {
      const input = { name: name.trim(), kind, bankName: bankName.trim(), accountNumber: accountNumber.trim(), iban: iban.trim(), openingBalance: balance, openingDate, staffCanUse, holderUserId: kind === "Custody" && holder ? Number(holder) : null };
      const saved = account ? await updateFinAccount(account.id, input) : await createFinAccount(input);
      onSaved(saved, account ? `${saved.name} was updated.` : `${saved.name} was added.`);
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) {
        const mapped: Partial<Record<FieldName, string>> = {};
        const rest: string[] = [];
        for (const [key, messages] of Object.entries(error.fieldErrors)) {
          if (["name", "kind", "bankName", "accountNumber", "iban", "openingBalance", "openingDate", "holderUserId"].includes(key)) mapped[key as FieldName] = messages.join(" ");
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
    <Dialog open title={account ? "Edit account" : "Add account"} onClose={pending ? () => {} : onClose} initialFocusRef={firstField} variant={variant}>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <TextField label="Account name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} inputRef={firstField} maxLength={120} autoComplete="off" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Type" error={errors.kind} value={kind} onChange={(e) => setKind(e.target.value as FinAccountKind)}>
            <option value="Bank">Bank account</option>
            <option value="Cash">Cash</option>
            <option value="Custody">Petty cash held by a staff member</option>
          </Select>
          <TextField label="Bank name (optional)" value={bankName} onChange={(e) => setBankName(e.target.value)} error={errors.bankName} maxLength={80} autoComplete="off" />
        </div>
        {kind === "Custody" && (
          <Select label="Held by" value={holder} onChange={(e) => setHolder(e.target.value)} error={errors.holderUserId}>
            <option value="">Choose the staff member</option>
            {staff.map((u) => (
              <option key={u.userId} value={u.userId}>{u.username}</option>
            ))}
          </Select>
        )}
        <TextField label="Account number (optional)" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} error={errors.accountNumber} maxLength={40} inputMode="numeric" autoComplete="off" />
        <TextField label="IBAN (optional)" value={iban} onChange={(e) => setIban(e.target.value)} error={errors.iban} maxLength={40} autoComplete="off" />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Opening balance (AED)"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            error={errors.openingBalance}
            inputMode="decimal"
            autoComplete="off"
            hint="What the account held on the opening date."
          />
          <TextField
            label="Opening date"
            type="date"
            value={openingDate}
            max={todayInUae()}
            onChange={(e) => setOpeningDate(e.target.value)}
            error={errors.openingDate}
            hint="Nothing can be recorded before this date."
          />
        </div>
        <label className="flex min-h-11 items-start gap-3 text-sm text-ink-900">
          <input type="checkbox" className="mt-0.5 size-5" checked={staffCanUse} onChange={(e) => setStaffCanUse(e.target.checked)} />
          <span>
            Staff may choose this account when they submit an expense
            <span className="block text-xs text-ink-600">Only for staff a Manager has allowed in Settings. Their expenses wait for approval and never show balances.</span>
          </span>
        </label>
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
            {pending ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <Save aria-hidden="true" size={16} />}
            {account ? "Save changes" : "Add account"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
