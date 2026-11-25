import { useState, type FormEvent } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { createLedgerAccount, updateLedgerAccount, type LedgerAccount } from "../../api/finance";
import { ApiError } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Card, CardHeader, Select, StatusBadge, cx } from "../../ui";
import { formatMoney, quietZero } from "./financeFormat";

const TYPES: LedgerAccount["type"][] = ["Asset", "Liability", "Equity", "Revenue", "Expense"];

function AccountDialog({ account, variant, onClose, onSaved }: { account: LedgerAccount | null; variant: "center" | "sheet"; onClose: () => void; onSaved: (message: string) => void }) {
  const [code, setCode] = useState(account?.code ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<LedgerAccount["type"]>(account?.type ?? "Expense");
  const [active, setActive] = useState(account?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const posted = account !== null && (account.debit > 0 || account.credit > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const saved = account ? await updateLedgerAccount(account.id, { code: code.trim(), name: name.trim(), type, isActive: active }) : await createLedgerAccount({ code: code.trim(), name: name.trim(), type });
      onSaved(account ? `${saved.name} was updated.` : `${saved.code} ${saved.name} was added to the chart.`);
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) setErrors(Object.fromEntries(Object.entries(error.fieldErrors).map(([k, v]) => [k, v.join(" ")])));
      else setErrors({ general: error instanceof ApiError ? error.message : "Something went wrong. Please try again." });
      setPending(false);
    }
  }

  return (
    <Dialog open title={account ? "Edit account" : "Add account"} onClose={pending ? () => {} : onClose} variant={variant}>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value)} error={errors.code} maxLength={20} autoComplete="off" disabled={account?.isSystem} />
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={120} autoComplete="off" />
        </div>
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as LedgerAccount["type"])} error={errors.type} disabled={posted}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        {posted && <p className="text-xs text-ink-600">The type is fixed because this account already has postings.</p>}
        {account && !account.isSystem && (
          <label className="flex min-h-11 items-center gap-3 text-sm text-ink-900">
            <input type="checkbox" className="size-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Offer this account for new journals
          </label>
        )}
        {errors.isActive && <p role="alert" className="text-sm text-danger">{errors.isActive}</p>}
        {errors.general && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errors.general}</p>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending && <Loader2 aria-hidden="true" size={16} className="animate-spin" />}{account ? "Save account" : "Add account"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The chart of accounts: every account with its balance, where the accountant can rename, recode, add and switch off. */
export function ChartTab({ accounts, variant, canEdit, onChanged }: { accounts: LedgerAccount[]; variant: "center" | "sheet"; canEdit: boolean; onChanged: (message: string) => void }) {
  const [editing, setEditing] = useState<LedgerAccount | "new" | null>(null);
  return (
    <Card>
      <CardHeader title="Chart of accounts" description="Accounts are never deleted, only switched off. Opening balance equity is needed by the system." />
      {canEdit && <div className="px-5 pb-3"><Button icon={Plus} onClick={() => setEditing("new")}>Add account</Button></div>}
      <ul className="divide-y divide-line border-t border-line">
        {accounts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
            <span className="w-14 font-mono text-xs text-ink-500">{a.code}</span>
            <span className="min-w-0 flex-1 basis-48">
              <span className={cx("break-words text-[15px] font-medium", a.isActive ? "text-ink-900" : "text-ink-500 line-through")}>{a.name}</span>
              <span className="block text-xs text-ink-500">{a.type}{a.isSystem ? " · system" : ""}</span>
            </span>
            {!a.isActive && <StatusBadge tone="neutral" variant="soft">Switched off</StatusBadge>}
            <span className={cx("w-32 text-right font-display text-base font-bold tabular-nums text-ink-900", quietZero(a.balance))}>{formatMoney(a.balance)}</span>
            {canEdit && <Button size="sm" variant="ghost" icon={Pencil} className="text-ink-600" onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`}>Edit</Button>}
          </li>
        ))}
      </ul>
      {editing && <AccountDialog account={editing === "new" ? null : editing} variant={variant} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); onChanged(m); }} />}
    </Card>
  );
}
