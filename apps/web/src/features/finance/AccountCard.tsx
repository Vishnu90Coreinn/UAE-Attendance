import { useEffect, useState } from "react";
import { ArrowLeftRight, Check, Copy, Eye, EyeOff, Landmark, Pencil, Power, Wallet } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { FinAccount } from "../../api/finance";
import { Button, Mark, RowMenu, StatusBadge, cx } from "../../ui";
import { formatDay, formatMoney } from "./financeFormat";

const iconButton =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

/** The first and last four characters; the rest is covered until asked for. */
function maskIban(iban: string): string {
  const compact = iban.replace(/\s+/g, "");
  return compact.length <= 8 ? compact : `${compact.slice(0, 4)} •••• ${compact.slice(-4)}`;
}

function Iban({ iban, account }: { iban: string; account: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState<"" | "IBAN copied" | "The IBAN could not be copied">("");
  // The Partner is already sent a masked number by the server: there is nothing to reveal or copy.
  const hidden = iban.includes("•");

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 4000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(iban);
      setCopied("IBAN copied");
    } catch {
      setCopied("The IBAN could not be copied");
    }
  }

  return (
    <div>
      <div className="flex min-h-11 items-center justify-between gap-2">
        <dt className="text-ink-600">IBAN</dt>
        <dd className="flex min-w-0 items-center justify-end">
          <span className="break-all text-right font-mono text-[13px] tabular-nums text-ink-800">{hidden || shown ? iban : maskIban(iban)}</span>
          {!hidden && (
            <>
              <button type="button" className={iconButton} onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-label={`${shown ? "Hide" : "Show"} IBAN of ${account}`}>
                {shown ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
              </button>
              <button type="button" className={iconButton} onClick={() => void copy()} aria-label={`Copy IBAN of ${account}`}>
                {copied === "IBAN copied" ? <Check aria-hidden="true" size={16} className="text-brand-700" /> : <Copy aria-hidden="true" size={16} />}
              </button>
            </>
          )}
        </dd>
      </div>
      <p aria-live="polite" className={cx("text-right text-[13px] text-brand-700", !copied && "sr-only")}>{copied}</p>
    </div>
  );
}

/** What the bank has not yet paid out or taken in, said where it cannot be missed, with the way to the cheques. */
function ChequeNotice({ account, count }: { account: FinAccount; count: number }) {
  const uncleared = account.unclearedCheques ?? 0;
  if (uncleared === 0) return null;
  return (
    <div role="status" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      <p>
        <span className="font-semibold">{count === 0 ? "Cheques pending" : `${count} ${count === 1 ? "cheque" : "cheques"} pending`}</span>
        {" · "}
        <span className="tabular-nums">AED {formatMoney(Math.abs(uncleared))}</span> not yet cleared. Expected balance after clearing:{" "}
        <span className="font-semibold tabular-nums">AED {formatMoney(account.balance)}</span>.
      </p>
      <Link to="/finance/cheques" className="inline-flex min-h-11 items-center font-semibold underline">View cheques</Link>
    </div>
  );
}

export function AccountCard({ account, quiet, chequeCount, canEdit, onEdit, onTransfer, onSwitch }: {
  account: FinAccount;
  /** No income, expense or transfer has touched it yet. */
  quiet: boolean;
  chequeCount: number;
  canEdit: boolean;
  onEdit: () => void;
  onTransfer: () => void;
  onSwitch: () => void;
}) {
  const navigate = useNavigate();
  const Icon = account.kind === "Bank" ? Landmark : Wallet;
  const overdrawn = account.balance < 0;
  return (
    <article aria-label={account.name} className={cx("flex flex-col rounded-card border border-line bg-white p-5 shadow-card", !account.isActive && "bg-ink-50")}>
      <header className="flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="break-words font-display text-lg font-bold leading-snug text-ink-900">{account.name}</h4>
          <p className="mt-0.5 text-sm text-ink-600">{[account.kind === "Cash" ? "Cash" : account.kind === "Custody" ? `Petty cash held by ${account.holderName ?? "staff"}` : "Bank account", account.bankName].filter(Boolean).join(" · ")}</p>
        </div>
        {!account.isActive && <StatusBadge tone="neutral" variant="soft">Inactive</StatusBadge>}
        {overdrawn && account.isActive && <StatusBadge tone="danger">Overdrawn</StatusBadge>}
      </header>

      <p className={cx("mt-4 flex items-baseline gap-2 tabular-nums", overdrawn ? "text-danger" : "text-ink-900")}>
        <span className="text-sm font-medium text-ink-500">AED</span>
        <Mark value={account.balance} className="font-display text-2xl font-semibold tracking-tight">{formatMoney(account.balance)}</Mark>
      </p>
      <ChequeNotice account={account} count={chequeCount} />
      {quiet && <p className="mt-3 text-sm text-ink-600">No transactions yet. Record your first expense or income.</p>}

      {(account.accountNumber || account.iban || account.openingBalance !== 0) && (
        <dl className="mt-4 grid gap-1 border-t border-line pt-3 text-sm">
          {account.accountNumber && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-600">Account no.</dt>
              <dd className="font-mono text-[13px] tabular-nums text-ink-800">{account.accountNumber}</dd>
            </div>
          )}
          {account.iban && <Iban iban={account.iban} account={account.name} />}
          {account.openingBalance !== 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-600">Opening</dt>
              <dd className="tabular-nums text-ink-900">
                AED {formatMoney(account.openingBalance)} <span className="text-ink-500">on {formatDay(account.openingDate)}</span>
              </dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-auto pt-4">
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <RowMenu
            label={`Activity of ${account.name}`}
            triggerText="View activity"
            triggerClassName="-ml-2 inline-flex h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            items={[
              { label: "Expenses paid from it", onSelect: () => navigate(`/finance/expenses?account=${account.id}&period=all`) },
              { label: "Income received into it", onSelect: () => navigate(`/finance/income?account=${account.id}&period=all`) },
            ]}
          />
          {canEdit && (
            <div className="ml-auto flex items-center gap-1">
              {account.isActive && (
                <Button variant="secondary" icon={ArrowLeftRight} onClick={onTransfer} aria-label={`Transfer from ${account.name}`}>
                  Transfer
                </Button>
              )}
              <RowMenu
                label={`More actions for ${account.name}`}
                triggerClassName={iconButton}
                items={[
                  { label: "Edit details", icon: Pencil, onSelect: onEdit },
                  { label: account.isActive ? "Deactivate account" : "Reactivate account", icon: Power, danger: account.isActive, onSelect: onSwitch },
                ]}
              />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
