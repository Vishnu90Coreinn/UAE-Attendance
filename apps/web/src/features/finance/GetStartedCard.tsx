import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle } from "lucide-react";
import { listFinAccounts, listFinCategories, listFinMonthLocks, listFinPartners } from "../../api/finance";
import { Button, Card, CardHeader, cx } from "../../ui";
import { isVatSettlementCategory } from "./financeFormat";

const DISMISSED = "hrpayroll.finance.getStartedDismissed";

interface Step {
  label: string;
  to: string;
  done: boolean;
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === "yes";
  } catch {
    return false;
  }
}

/** First run: the few things to set up before the figures mean anything, ticked off from what is already there. It goes away once all are done, or when hidden. */
export function GetStartedCard() {
  const [hidden, setHidden] = useState(wasDismissed);
  const [steps, setSteps] = useState<Step[] | null>(null);

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    Promise.all([listFinAccounts(), listFinPartners(), listFinCategories(false), listFinMonthLocks()])
      .then(([accounts, partners, categories, locks]) => {
        if (cancelled || !accounts || !partners || !categories || !locks) return;
        const spending = categories.filter((c) => c.kind === "Expense" && c.isActive && !c.isSystem && !isVatSettlementCategory(c.id));
        setSteps([
          { label: "Add the bank and cash accounts", to: "/finance/accounts", done: accounts.length > 0 },
          { label: "Add the partners and the capital they put in", to: "/finance/partners", done: partners.partners.length > 0 },
          { label: "Enter the opening balances", to: "/finance/accounts", done: accounts.some((a) => a.openingBalance !== 0) },
          { label: "Say which VAT each expense category carries", to: "/finance/setup#categories", done: spending.length > 0 && spending.every((c) => c.noVat || c.defaultTaxTypeId) },
          { label: "Lock the first finished month, once the accountant has it", to: "/finance/setup#month-lock", done: locks.some((l) => l.isLocked) },
        ]);
      })
      .catch(() => {});   // a missing checklist must never get in the way of the page
    return () => {
      cancelled = true;
    };
  }, [hidden]);

  if (hidden || !steps || steps.every((s) => s.done)) return null;

  function hide() {
    try {
      localStorage.setItem(DISMISSED, "yes");
    } catch {
      // Hidden for this visit even if it cannot be remembered.
    }
    setHidden(true);
  }

  return (
    <Card>
      <CardHeader title="Get started" description={`${steps.filter((s) => s.done).length} of ${steps.length} done`} actions={<Button size="sm" variant="ghost" onClick={hide}>Hide</Button>} />
      <ul className="divide-y divide-line border-t border-line">
        {steps.map((s) => (
          <li key={s.label}>
            <Link to={s.to} className="flex min-h-11 items-center gap-3 px-5 py-2.5 text-sm hover:bg-ink-50">
              {s.done ? <CheckCircle2 aria-hidden="true" size={16} className="shrink-0 text-brand-600" /> : <Circle aria-hidden="true" size={16} className="shrink-0 text-ink-400" />}
              <span className={cx("min-w-0 flex-1", s.done ? "text-ink-500 line-through" : "text-ink-900")}>{s.label}</span>
              <span className="sr-only">{s.done ? "Done" : "To do"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
